"""Tests for majlis_judge.football pure rule engine using synthetic tracking data."""

import numpy as np
import pytest

from majlis_judge.football import FootballReferee, extract_torso_color, parse_box_coords


def test_parse_box_coords():
    # Normalized coords
    box = parse_box_coords("0.1, 0.2, 0.3, 0.8", 1000, 500)
    assert box == (100, 100, 300, 400)

    # Pixel coords
    box_px = parse_box_coords("50, 60, 200, 350", 1000, 500)
    assert box_px == (50, 60, 200, 350)


def test_team_clustering_kmeans():
    referee = FootballReferee(
        goal_a_box=(0, 100, 100, 300),
        goal_b_box=(800, 100, 900, 300),
        fps=30.0,
        frame_stride=2,
    )

    # Synthetic torso color samples:
    # Tracks 1 and 2: Blue jerseys (HSV ~ [110, 200, 180])
    # Tracks 3 and 4: Orange jerseys (HSV ~ [15, 220, 200])
    samples = {
        1: [np.array([110, 200, 180]), np.array([112, 195, 175]), np.array([108, 205, 185])],
        2: [np.array([115, 210, 190]), np.array([111, 202, 178])],
        3: [np.array([15, 220, 200]), np.array([14, 215, 195])],
        4: [np.array([16, 225, 205]), np.array([15, 218, 198])],
    }

    team_assignments = referee.assign_teams(samples)
    assert len(team_assignments) == 4
    # Tracks 1 and 2 must share a team, Tracks 3 and 4 must share the other team
    assert team_assignments[1] == team_assignments[2]
    assert team_assignments[3] == team_assignments[4]
    assert team_assignments[1] != team_assignments[3]

    # Test swap_teams
    referee_swap = FootballReferee(
        goal_a_box=(0, 100, 100, 300),
        goal_b_box=(800, 100, 900, 300),
        swap_teams=True,
    )
    swap_assignments = referee_swap.assign_teams(samples)
    assert swap_assignments[1] != team_assignments[1]


def test_possession_tracking_and_mvp():
    referee = FootballReferee(
        goal_a_box=(0, 100, 100, 300),
        goal_b_box=(800, 100, 900, 300),
        fps=10.0,
        frame_stride=1,
    )
    # Assign track 1 to Team A, track 2 to Team B
    referee.player_teams = {1: "Team A", 2: "Team B"}

    # Player 1 is at (100, 200), bbox width=40, height=80 -> threshold = 0.8 * 80 = 64px
    p1 = {"track_id": 1, "bbox": (80, 160, 120, 240)}
    p2 = {"track_id": 2, "bbox": (500, 160, 540, 240)}

    # Frame 0 to 5: ball is at (105, 205) -> distance to p1 center (100, 200) is ~7px (<64px)
    ball_near_p1 = {"center": (105, 205), "bbox": (100, 200, 10, 10)}
    for f in range(6):
        ts = f * 0.1
        referee.step_frame(f, ts, ball_near_p1, [p1, p2])

    # Possession confirmed after 3 frames for p1
    assert referee.active_possessor == 1
    assert referee.player_touches[1] == 1
    assert referee.possession_seconds["Team A"] > 0.0

    # Now move ball near p2 at (505, 205) for 5 frames
    ball_near_p2 = {"center": (505, 205), "bbox": (500, 200, 10, 10)}
    for f in range(6, 12):
        ts = f * 0.1
        referee.step_frame(f, ts, ball_near_p2, [p1, p2])

    assert referee.active_possessor == 2
    assert referee.player_touches[2] == 1
    assert referee.possession_seconds["Team B"] > 0.0

    stats = referee.get_stats(total_frames=12, detected_ball_frames=12)
    assert stats["ballDetectedPercentage"] == 100.0
    assert stats["mvp"] is not None
    assert stats["mvp"]["id"] in ["p_1", "p_2"]


def test_goal_detection_and_cooldown():
    # Goal A: (0, 100, 100, 300) -> Team A scores here
    referee = FootballReferee(
        goal_a_box=(0, 100, 100, 300),
        goal_b_box=(800, 100, 900, 300),
        fps=10.0,
        frame_stride=1,
    )
    referee.player_teams = {10: "Team A"}
    referee.last_possessor_team_a = "Player #10 (Team A)"

    players = [{"track_id": 10, "bbox": (150, 150, 190, 250)}]

    # First, ball is outside goal for 1.2 seconds (12 frames)
    for f in range(12):
        ts = f * 0.1
        ball_outside = {"center": (200, 200), "bbox": (195, 195, 10, 10)}
        referee.step_frame(f, ts, ball_outside, players)

    assert referee.time_outside_goal_a >= 1.0

    # Frame 12, 13: ball enters Goal A (x=50, y=200) -> inside frames: 1, 2
    ev1 = referee.step_frame(12, 1.2, {"center": (50, 200), "bbox": (45, 195, 10, 10)}, players)
    assert ev1 is None
    ev2 = referee.step_frame(13, 1.3, {"center": (50, 200), "bbox": (45, 195, 10, 10)}, players)
    assert ev2 is None

    # Frame 14: inside frame 3 -> GOAL!
    ev3 = referee.step_frame(14, 1.4, {"center": (50, 200), "bbox": (45, 195, 10, 10)}, players)
    assert ev3 is not None
    assert ev3["type"] == "GOAL"
    assert ev3["teamId"] == "team_a"
    assert "Player #10" in ev3["scorer"]
    assert referee.scores["Team A"] == 1

    # Within 4.0s cooldown, ball staying inside does NOT trigger another goal
    ev4 = referee.step_frame(15, 1.5, {"center": (50, 200), "bbox": (45, 195, 10, 10)}, players)
    assert ev4 is None
    assert referee.scores["Team A"] == 1

"""Tests for majlis_judge.balloon pure rule engine using synthetic tracking data."""

import numpy as np
import pytest

from majlis_judge.balloon import (
    BalloonReferee,
    ColorClearanceError,
    perform_color_clearance_check,
)
from majlis_judge.common import ColorTracker


def test_color_clearance_check_clean():
    # Only the balloon in green
    tracker = ColorTracker(hsv_lower=(50, 100, 100), hsv_upper=(70, 255, 255))
    frames = []
    import cv2
    for _ in range(10):
        f = np.zeros((300, 400, 3), dtype=np.uint8)
        cv2.circle(f, (200, 150), 20, (0, 255, 0), -1)
        frames.append(f)

    passed, msg = perform_color_clearance_check(frames, tracker)
    assert passed is True


def test_color_clearance_check_contaminated():
    # Balloon + huge green rectangle in the background (contaminating shirt or wall)
    tracker = ColorTracker(hsv_lower=(50, 100, 100), hsv_upper=(70, 255, 255))
    frames = []
    import cv2
    for _ in range(10):
        f = np.zeros((300, 400, 3), dtype=np.uint8)
        # Balloon
        cv2.circle(f, (100, 100), 15, (0, 255, 0), -1)
        # Contaminating background
        cv2.rectangle(f, (250, 50), (380, 250), (0, 255, 0), -1)
        frames.append(f)

    passed, msg = perform_color_clearance_check(frames, tracker)
    assert passed is False
    assert "matches the balloon colour" in msg


def test_balloon_hit_valid_and_fault():
    # Target line at 0.35 * 400 = 140px
    # Ground line at 0.90 * 400 = 360px
    referee = BalloonReferee(ground_y=0.90, target_y=0.35, fps=20.0, stride=1, team_name="A")
    height = 400

    # Build synthetic trajectory:
    # 1. Starts falling from y=200 down to y=300 (falling: dy > 0)
    # 2. Hit 1 at t=1.0s, turning upwards and reaching apex y=100 (which is <= 140 target_y -> VALID HIT)
    # 3. Falls from y=100 down to y=280 at t=3.0s
    # 4. Hit 2 at t=3.0s, turning upwards but reaching apex y=180 (which is > 140 target_y -> FAULT)
    # 5. Falls down to ground y=365 at t=5.0s -> GROUND CONTACT

    trajectory = []
    t = 0.0
    f_idx = 0

    # Falling phase 1: 200 -> 300
    for y in np.linspace(200, 300, 15):
        trajectory.append((f_idx, round(t, 2), {"center": (200, int(y)), "bbox": (180, int(y)-20, 40, 40)}))
        t += 0.05
        f_idx += 1

    # Hit 1 rising: 300 -> 100 (apex)
    for y in np.linspace(290, 100, 20):
        trajectory.append((f_idx, round(t, 2), {"center": (200, int(y)), "bbox": (180, int(y)-20, 40, 40)}))
        t += 0.05
        f_idx += 1

    # Falling phase 2: 100 -> 280
    for y in np.linspace(110, 280, 20):
        trajectory.append((f_idx, round(t, 2), {"center": (200, int(y)), "bbox": (180, int(y)-20, 40, 40)}))
        t += 0.05
        f_idx += 1

    # Hit 2 rising: 280 -> 180 (apex fails to clear 140)
    for y in np.linspace(270, 180, 15):
        trajectory.append((f_idx, round(t, 2), {"center": (200, int(y)), "bbox": (180, int(y)-20, 40, 40)}))
        t += 0.05
        f_idx += 1

    # Falling to ground: 180 -> 365 (ground line is 360)
    for y in np.linspace(190, 365, 20):
        trajectory.append((f_idx, round(t, 2), {"center": (200, int(y)), "bbox": (180, int(y)-20, 40, 40)}))
        t += 0.05
        f_idx += 1

    results = referee.evaluate_trajectory(trajectory, frame_height=height)

    # Must detect:
    # 1 valid hit (apex <= 140)
    # 1 fault (apex > 140)
    # 1 ground contact
    assert results["valid_hits"] == 1
    assert results["faults"] == 1
    assert results["ground_time"] is not None

    types = [ev["type"] for ev in results["events"]]
    assert "HIT_VALID" in types
    assert "FAULT" in types
    assert "GROUND_CONTACT" in types

    # Score = air_seconds + valid_hits - faults
    expected_score = round(results["air_seconds"] + 1 - 1, 1)
    assert abs(results["final_score"] - expected_score) < 0.2

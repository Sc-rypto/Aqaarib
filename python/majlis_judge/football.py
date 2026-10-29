"""Football referee and judging engine for Majlis Judge.
Processes video, tracks players and ball with YOLOv8/ByteTrack, separates teams with KMeans,
tracks ball possession and goal detections, and produces a validated signed report."""

import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import cv2
import numpy as np
from sklearn.cluster import KMeans
from ultralytics import YOLO

from .common import ColorTracker, EvidenceCollector, VideoReader, create_report, sign_report


def parse_box_coords(
    box_str: str, frame_w: int, frame_h: int
) -> Tuple[int, int, int, int]:
    """Parses 'x1,y1,x2,y2' string into absolute pixel coordinates (x1, y1, x2, y2).
    Supports normalized (<= 1.0) and pixel coordinates."""
    parts = [float(p.strip()) for p in box_str.split(",")]
    if len(parts) != 4:
        raise ValueError(f"Box coordinates must have 4 comma-separated values: {box_str}")

    x1, y1, x2, y2 = parts
    # If all values are <= 1.0, treat as normalized coordinates
    if x1 <= 1.0 and y1 <= 1.0 and x2 <= 1.0 and y2 <= 1.0:
        px1 = int(round(x1 * frame_w))
        py1 = int(round(y1 * frame_h))
        px2 = int(round(x2 * frame_w))
        py2 = int(round(y2 * frame_h))
    else:
        px1 = int(round(x1))
        py1 = int(round(y1))
        px2 = int(round(x2))
        py2 = int(round(y2))

    min_x = max(0, min(px1, px2))
    max_x = min(frame_w, max(px1, px2))
    min_y = max(0, min(py1, py2))
    max_y = min(frame_h, max(py1, py2))
    return (min_x, min_y, max_x, max_y)


def extract_torso_color(frame: np.ndarray, bbox: Tuple[int, int, int, int]) -> Optional[np.ndarray]:
    """Extracts average color from the torso region of a detected player bounding box."""
    x1, y1, x2, y2 = bbox
    w = x2 - x1
    h = y2 - y1
    if w < 10 or h < 20:
        return None

    # Upper-middle torso region
    top_y = y1 + int(0.20 * h)
    bot_y = y1 + int(0.55 * h)
    left_x = x1 + int(0.20 * w)
    right_x = x2 - int(0.20 * w)

    h_img, w_img = frame.shape[:2]
    top_y = max(0, min(h_img - 1, top_y))
    bot_y = max(0, min(h_img, bot_y))
    left_x = max(0, min(w_img - 1, left_x))
    right_x = max(0, min(w_img, right_x))

    if bot_y <= top_y or right_x <= left_x:
        return None

    torso = frame[top_y:bot_y, left_x:right_x]
    if torso.size == 0:
        return None

    hsv_torso = cv2.cvtColor(torso, cv2.COLOR_BGR2HSV)
    # Average hue, saturation, value
    mean_val = cv2.mean(hsv_torso)[:3]
    return np.array(mean_val, dtype=np.float32)


class FootballReferee:
    """Pure rule-judging and event evaluation logic for Football matches."""

    def __init__(
        self,
        goal_a_box: Tuple[int, int, int, int],
        goal_b_box: Tuple[int, int, int, int],
        fps: float = 30.0,
        frame_stride: int = 2,
        swap_teams: bool = False,
    ):
        self.goal_a = goal_a_box
        self.goal_b = goal_b_box
        self.fps = fps
        self.stride = frame_stride
        self.dt = self.stride / float(fps if fps > 0 else 30.0)
        self.swap_teams = swap_teams

        # Tracking state
        self.player_teams: Dict[int, str] = {}  # track_id -> "Team A" or "Team B"
        self.candidate_possessors: List[Optional[int]] = []
        self.active_possessor: Optional[int] = None

        self.last_possessor_team_a: Optional[str] = None
        self.last_possessor_team_b: Optional[str] = None
        self.last_overall_possessor: Optional[str] = None

        self.possession_seconds: Dict[str, float] = {"Team A": 0.0, "Team B": 0.0}
        self.player_possession: Dict[int, float] = {}
        self.player_touches: Dict[int, int] = {}

        # Goal detection state
        self.frames_inside_goal_a = 0
        self.frames_inside_goal_b = 0
        self.time_outside_goal_a = 0.0
        self.time_outside_goal_b = 0.0
        self.last_goal_time = -10.0
        self.goal_cooldown_sec = 4.0

        # Scores & Events
        self.scores: Dict[str, int] = {"Team A": 0, "Team B": 0}
        self.events: List[Dict[str, Any]] = []

    def assign_teams(
        self, player_color_samples: Dict[int, List[np.ndarray]]
    ) -> Dict[int, str]:
        """Clusters player torso colors into 2 teams using KMeans."""
        valid_tracks = [tid for tid, samples in player_color_samples.items() if len(samples) >= 2]
        if len(valid_tracks) < 2:
            # Fallback if too few tracks
            for idx, tid in enumerate(player_color_samples.keys()):
                team = "Team B" if (idx % 2 == 1) else "Team A"
                if self.swap_teams:
                    team = "Team A" if team == "Team B" else "Team B"
                self.player_teams[tid] = team
            return self.player_teams

        features = []
        track_sample_indices = []
        for tid in valid_tracks:
            for s in player_color_samples[tid]:
                features.append(s)
                track_sample_indices.append(tid)

        features_arr = np.array(features)
        kmeans = KMeans(n_clusters=2, random_state=42, n_init=10)
        labels = kmeans.fit_predict(features_arr)

        votes: Dict[int, List[int]] = {tid: [0, 0] for tid in valid_tracks}
        for tid, label in zip(track_sample_indices, labels):
            votes[tid][label] += 1

        for tid, v in votes.items():
            cluster_id = 0 if v[0] >= v[1] else 1
            if self.swap_teams:
                cluster_id = 1 - cluster_id
            self.player_teams[tid] = "Team A" if cluster_id == 0 else "Team B"

        # Assign any remaining tracks
        for tid in player_color_samples.keys():
            if tid not in self.player_teams:
                self.player_teams[tid] = "Team A"

        return self.player_teams

    def step_frame(
        self,
        frame_idx: int,
        timestamp_sec: float,
        ball: Optional[Dict[str, Any]],
        players: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """Processes one frame of tracking data.
        Returns a goal event dictionary if a goal occurred in this frame."""
        # 1. Update possession
        nearest_player_id = None
        if ball is not None and players:
            bx, by = ball["center"]
            min_dist = float("inf")
            candidate_id = None

            for p in players:
                px1, py1, px2, py2 = p["bbox"]
                ph = py2 - py1
                pcx = (px1 + px2) / 2.0
                pcy = (py1 + py2) / 2.0
                dist = math.hypot(bx - pcx, by - pcy)

                # Nearest player within 0.8 of player's box height
                if dist <= (0.8 * ph) and dist < min_dist:
                    min_dist = dist
                    candidate_id = p["track_id"]

            nearest_player_id = candidate_id

        self.candidate_possessors.append(nearest_player_id)
        if len(self.candidate_possessors) > 3:
            self.candidate_possessors.pop(0)

        # Confirm possession over 3 consecutive frames
        if (
            len(self.candidate_possessors) == 3
            and self.candidate_possessors[0] is not None
            and self.candidate_possessors[0] == self.candidate_possessors[1] == self.candidate_possessors[2]
        ):
            confirmed_id = self.candidate_possessors[0]
            if confirmed_id != self.active_possessor:
                # New possession / touch
                self.active_possessor = confirmed_id
                self.player_touches[confirmed_id] = self.player_touches.get(confirmed_id, 0) + 1

                player_team = self.player_teams.get(confirmed_id, "Team A")
                player_label = f"Player #{confirmed_id} ({player_team})"
                self.last_overall_possessor = player_label
                if player_team == "Team A":
                    self.last_possessor_team_a = player_label
                else:
                    self.last_possessor_team_b = player_label

        elif len(self.candidate_possessors) == 3 and all(c is None for c in self.candidate_possessors):
            self.active_possessor = None

        # Accumulate possession time
        if self.active_possessor is not None:
            team = self.player_teams.get(self.active_possessor, "Team A")
            self.possession_seconds[team] = self.possession_seconds.get(team, 0.0) + self.dt
            self.player_possession[self.active_possessor] = (
                self.player_possession.get(self.active_possessor, 0.0) + self.dt
            )

        # 2. Update Goal State
        goal_event = None
        if ball is not None:
            bx, by = ball["center"]
            ax1, ay1, ax2, ay2 = self.goal_a
            bx1, by1, bx2, by2 = self.goal_b

            in_goal_a = (ax1 <= bx <= ax2) and (ay1 <= by <= ay2)
            in_goal_b = (bx1 <= bx <= bx2) and (by1 <= by <= by2)

            if in_goal_a:
                self.frames_inside_goal_a += 1
            else:
                self.frames_inside_goal_a = 0
                self.time_outside_goal_a += self.dt

            if in_goal_b:
                self.frames_inside_goal_b += 1
            else:
                self.frames_inside_goal_b = 0
                self.time_outside_goal_b += self.dt

            cooldown_active = (timestamp_sec - self.last_goal_time) < self.goal_cooldown_sec

            # Goal A: Team A scores into Goal A
            if (
                in_goal_a
                and self.frames_inside_goal_a >= 3
                and self.time_outside_goal_a >= 1.0
                and not cooldown_active
            ):
                self.scores["Team A"] += 1
                self.last_goal_time = timestamp_sec
                self.time_outside_goal_a = 0.0
                self.frames_inside_goal_a = 0

                scorer_name = self.last_possessor_team_a or "Team A Player"
                reason = f"GOAL! Team A scored into Goal A (last possessor: {scorer_name}). Ball inside goal for 3 frames."
                goal_event = {
                    "type": "GOAL",
                    "teamId": "team_a",
                    "teamName": "Team A",
                    "scorer": scorer_name,
                    "reason": reason,
                    "timestampSec": round(float(timestamp_sec), 2),
                }
                self.events.append(goal_event)

            # Goal B: Team B scores into Goal B
            elif (
                in_goal_b
                and self.frames_inside_goal_b >= 3
                and self.time_outside_goal_b >= 1.0
                and not cooldown_active
            ):
                self.scores["Team B"] += 1
                self.last_goal_time = timestamp_sec
                self.time_outside_goal_b = 0.0
                self.frames_inside_goal_b = 0

                scorer_name = self.last_possessor_team_b or "Team B Player"
                reason = f"GOAL! Team B scored into Goal B (last possessor: {scorer_name}). Ball inside goal for 3 frames."
                goal_event = {
                    "type": "GOAL",
                    "teamId": "team_b",
                    "teamName": "Team B",
                    "scorer": scorer_name,
                    "reason": reason,
                    "timestampSec": round(float(timestamp_sec), 2),
                }
                self.events.append(goal_event)

        return goal_event

    def get_stats(self, total_frames: int, detected_ball_frames: int) -> Dict[str, Any]:
        """Calculates final possession stats, ball detection rate, and selects the match MVP."""
        total_poss = self.possession_seconds["Team A"] + self.possession_seconds["Team B"]
        if total_poss > 0:
            pct_a = round((self.possession_seconds["Team A"] / total_poss) * 100.0, 1)
            pct_b = round((self.possession_seconds["Team B"] / total_poss) * 100.0, 1)
        else:
            pct_a = 50.0
            pct_b = 50.0

        ball_pct = round(
            (detected_ball_frames / float(max(1, total_frames))) * 100.0, 1
        )

        # Determine MVP: most possession seconds, tie broken by touches
        mvp = None
        if self.player_possession:
            best_pid = None
            best_sec = -1.0
            best_touches = -1

            for pid, sec in self.player_possession.items():
                touches = self.player_touches.get(pid, 0)
                if sec > best_sec or (abs(sec - best_sec) < 1e-4 and touches > best_touches):
                    best_sec = sec
                    best_touches = touches
                    best_pid = pid

            if best_pid is not None:
                p_team = self.player_teams.get(best_pid, "Team A")
                mvp = {
                    "id": f"p_{best_pid}",
                    "name": f"Player #{best_pid}",
                    "team": p_team,
                    "possessionSeconds": round(float(best_sec), 1),
                    "touches": best_touches,
                    "reason": f"Player #{best_pid} ({p_team}) led the match with {best_sec:.1f}s of confirmed possession and {best_touches} touches.",
                }

        # Formatted seconds per player
        sec_per_player = {
            f"Player #{pid} ({self.player_teams.get(pid, 'Team A')})": round(sec, 1)
            for pid, sec in sorted(self.player_possession.items(), key=lambda x: x[1], reverse=True)
        }

        return {
            "possessionPercentages": {"Team A": pct_a, "Team B": pct_b},
            "secondsPerTeam": {
                "Team A": round(self.possession_seconds["Team A"], 1),
                "Team B": round(self.possession_seconds["Team B"], 1),
            },
            "secondsPerPlayer": sec_per_player,
            "ballDetectedPercentage": ball_pct,
            "mvp": mvp,
        }


def judge_football(
    video_path: Union[str, Path],
    goal_a_str: str,
    goal_b_str: str,
    key: str,
    swap_teams: bool = False,
    ball_hsv: Optional[str] = None,
    stride: int = 2,
    yolo_model_path: str = "yolov8n.pt",
) -> Dict[str, Any]:
    """Runs end-to-end judging for a football match video."""
    video = VideoReader(video_path, max_width=960, stride=stride)
    w = video.target_width
    h = video.target_height

    goal_a = parse_box_coords(goal_a_str, w, h)
    goal_b = parse_box_coords(goal_b_str, w, h)

    evidence = EvidenceCollector(max_items=12, max_width=640, quality=70)
    model = YOLO(yolo_model_path)

    # First pass: run tracking on frames
    raw_frames: List[Tuple[int, float, np.ndarray]] = []
    player_tracks_per_frame: List[List[Dict[str, Any]]] = []
    ball_detections_yolo: List[Tuple[int, float, Optional[Dict[str, Any]]]] = []
    player_color_samples: Dict[int, List[np.ndarray]] = {}

    for frame_idx, timestamp_sec, frame in video.read_frames():
        raw_frames.append((frame_idx, timestamp_sec, frame))

        # Run ByteTrack with classes 0 (person) and 32 (sports ball)
        results = model.track(
            source=frame,
            persist=True,
            tracker="bytetrack.yaml",
            classes=[0, 32],
            conf=0.18,
            verbose=False,
        )

        players: List[Dict[str, Any]] = []
        ball: Optional[Dict[str, Any]] = None

        if results and len(results) > 0 and results[0].boxes is not None:
            boxes = results[0].boxes
            cls_ids = boxes.cls.cpu().numpy() if boxes.cls is not None else []
            track_ids = boxes.id.cpu().numpy() if boxes.id is not None else [None] * len(cls_ids)
            xyxy = boxes.xyxy.cpu().numpy() if boxes.xyxy is not None else []
            confs = boxes.conf.cpu().numpy() if boxes.conf is not None else []

            best_ball_conf = -1.0
            for i in range(len(cls_ids)):
                cid = int(cls_ids[i])
                bx = [int(v) for v in xyxy[i]]
                tid = int(track_ids[i]) if track_ids[i] is not None else None
                conf = float(confs[i]) if i < len(confs) else 0.5

                if cid == 0:  # Person
                    if tid is not None:
                        players.append({"track_id": tid, "bbox": (bx[0], bx[1], bx[2], bx[3])})
                        c_sample = extract_torso_color(frame, (bx[0], bx[1], bx[2], bx[3]))
                        if c_sample is not None:
                            player_color_samples.setdefault(tid, []).append(c_sample)

                elif cid == 32:  # Sports ball
                    if conf > best_ball_conf:
                        best_ball_conf = conf
                        bcx = (bx[0] + bx[2]) // 2
                        bcy = (bx[1] + bx[3]) // 2
                        ball = {
                            "center": (bcx, bcy),
                            "bbox": (bx[0], bx[1], bx[2] - bx[0], bx[3] - bx[1]),
                            "area": float((bx[2] - bx[0]) * (bx[3] - bx[1])),
                            "conf": conf,
                            "interpolated": False,
                        }

        player_tracks_per_frame.append(players)
        ball_detections_yolo.append((frame_idx, timestamp_sec, ball))

    total_processed = len(raw_frames)
    yolo_ball_count = sum(1 for _, _, b in ball_detections_yolo if b is not None)
    ball_detected_pct = (yolo_ball_count / float(max(1, total_processed))) * 100.0

    color_tracker_used = False
    final_ball_trajectory = ball_detections_yolo

    # Fallback to ColorTracker if ball found in under 40% of frames
    if ball_detected_pct < 40.0:
        color_tracker_used = True
        if ball_hsv:
            h_vals = [int(v.strip()) for v in ball_hsv.split(",")]
            lower_hsv = (h_vals[0], h_vals[1], h_vals[2])
            upper_hsv = (h_vals[3], h_vals[4], h_vals[5])
        else:
            # High-visibility bright yellow/orange default range
            lower_hsv = (10, 100, 100)
            upper_hsv = (38, 255, 255)

        c_tracker = ColorTracker(hsv_lower=lower_hsv, hsv_upper=upper_hsv, min_contour_area=25.0)
        c_trajectory: List[Tuple[int, float, Optional[Dict[str, Any]]]] = []
        for frame_idx, timestamp_sec, frame in raw_frames:
            det = c_tracker.detect(frame)
            c_trajectory.append((frame_idx, timestamp_sec, det))

        final_ball_trajectory = c_trajectory

    # Interpolate gaps up to 10 frames
    interpolated_ball = ColorTracker.interpolate_gaps(final_ball_trajectory, max_gap=10)

    # Initialize referee and assign teams
    referee = FootballReferee(
        goal_a_box=goal_a,
        goal_b_box=goal_b,
        fps=video.fps,
        frame_stride=stride,
        swap_teams=swap_teams,
    )
    player_teams = referee.assign_teams(player_color_samples)

    # Save a sample evidence image showing team classifications
    sample_frame_saved = False
    for frame_idx, timestamp_sec, frame in raw_frames:
        players = player_tracks_per_frame[raw_frames.index((frame_idx, timestamp_sec, frame))]
        if len(players) >= 2:
            annotated_boxes = []
            for p in players:
                tid = p["track_id"]
                team = player_teams.get(tid, "Team A")
                color = (255, 120, 30) if team == "Team A" else (50, 180, 240)
                px1, py1, px2, py2 = p["bbox"]
                annotated_boxes.append((px1, py1, px2 - px1, py2 - py1, f"#{tid} {team}", color))

            evidence.add(
                frame,
                title="Team Assignment Verification",
                reason="Players clustered into Team A and Team B based on jersey color",
                timestamp_sec=timestamp_sec,
                bboxes=annotated_boxes,
            )
            sample_frame_saved = True
            break

    # Main judging pass
    detected_ball_count = 0
    for idx, (frame_idx, timestamp_sec, frame) in enumerate(raw_frames):
        ball = interpolated_ball[idx][2]
        if ball is not None:
            detected_ball_count += 1
        players = player_tracks_per_frame[idx]

        goal_ev = referee.step_frame(frame_idx, timestamp_sec, ball, players)
        if goal_ev is not None:
            # Capture evidence for goal
            goal_boxes = [
                (
                    goal_a[0] / float(w),
                    goal_a[1] / float(h),
                    goal_a[2] / float(w),
                    goal_a[3] / float(h),
                    "Goal A (Team A scores)",
                    (0, 255, 0) if goal_ev["teamId"] == "team_a" else (128, 128, 128),
                ),
                (
                    goal_b[0] / float(w),
                    goal_b[1] / float(h),
                    goal_b[2] / float(w),
                    goal_b[3] / float(h),
                    "Goal B (Team B scores)",
                    (0, 255, 0) if goal_ev["teamId"] == "team_b" else (128, 128, 128),
                ),
            ]
            ball_points = []
            if ball is not None:
                bcx, bcy = ball["center"]
                ball_points.append((bcx, bcy, "Ball", (0, 255, 255)))

            evidence.add(
                frame,
                title=f"Goal for {goal_ev['teamName']}",
                reason=goal_ev["reason"],
                timestamp_sec=timestamp_sec,
                boxes_normalized=goal_boxes,
                points=ball_points,
            )

    stats = referee.get_stats(total_processed, detected_ball_count)

    # Format players, scores, strikes for the report
    players_report = [
        {"id": "team_a", "name": "Team A"},
        {"id": "team_b", "name": "Team B"},
    ]
    scores_report = {
        "team_a": referee.scores["Team A"],
        "team_b": referee.scores["Team B"],
    }
    strikes_report = {
        "team_a": 0,
        "team_b": 0,
    }

    winner = None
    if referee.scores["Team A"] > referee.scores["Team B"]:
        winner = {"id": "team_a", "name": "Team A", "score": referee.scores["Team A"]}
    elif referee.scores["Team B"] > referee.scores["Team A"]:
        winner = {"id": "team_b", "name": "Team B", "score": referee.scores["Team B"]}

    # Quality Summary
    quality_warnings = []
    final_ball_pct = stats["ballDetectedPercentage"]
    if final_ball_pct < 40.0:
        quality_warnings.append(
            f"Ball detected in only {final_ball_pct:.1f}% of frames (below 40% threshold)."
        )
    if color_tracker_used:
        quality_warnings.append(
            "YOLO ball detection was low (<40%); switched to ColorTracker fallback."
        )
    if len(player_teams) < 2:
        quality_warnings.append("Fewer than 2 distinct player tracks identified.")

    quality_status = "Good" if not quality_warnings else "Warning"
    quality_summary = {
        "status": quality_status,
        "ballDetectionRate": f"{final_ball_pct:.1f}%",
        "colorTrackerFallback": color_tracker_used,
        "trackedPlayersCount": len(player_teams),
        "warnings": quality_warnings,
    }

    meta = {
        "stats": stats,
        "qualitySummary": quality_summary,
        "gameType": "football",
    }

    report = create_report(
        game_name="Football Match",
        duration_sec=video.duration_sec,
        players=players_report,
        scores=scores_report,
        strikes=strikes_report,
        events=referee.events,
        evidence=evidence.get_items(),
        winner=winner,
        meta=meta,
    )

    signed = sign_report(report, key)
    video.release()
    return signed

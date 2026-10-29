"""Balloon referee and judging engine for Majlis Judge.
Color clearance pre-check, trajectory tracking, inflection-based hit detection,
apex validation above target line, ground line termination, and signed report generation."""

from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Tuple, Union

import cv2
import numpy as np

from .common import ColorTracker, EvidenceCollector, VideoReader, create_report, sign_report


def clean_referee_reason(text: str) -> str:
    """Sanitizes text to adhere to Kinship project referee tone: no emojis and no dash punctuation."""
    text = text.replace("—", " ").replace("–", " ").replace(" - ", " ").replace("-", " ")
    text = re.sub(r"[\U00010000-\U0010ffff]", "", text)
    text = re.sub(r"[\u2600-\u26ff]", "", text)
    return re.sub(r"\s+", " ", text).strip()


class ColorClearanceError(Exception):
    """Raised when background or player clothing contaminates the balloon color range."""
    pass


def perform_color_clearance_check(
    frames: List[np.ndarray],
    tracker: ColorTracker,
    max_contamination_ratio: float = 0.01,
) -> Tuple[bool, str]:
    """Inspects opening frames to verify no large background or clothing regions match the balloon color.
    Returns (True, '') if clear, or (False, error_message) if contaminated."""
    if not frames:
        return False, "No frames available for color clearance check"

    contamination_hits = 0
    sample_count = min(len(frames), 25)

    for i in range(sample_count):
        frame = frames[i]
        h, w = frame.shape[:2]
        total_pixels = w * h

        mask = tracker.get_mask(frame)
        total_mask_px = cv2.countNonZero(mask)
        if total_mask_px == 0:
            continue

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue

        # If any single colored region is gigantic (> 8% of frame), it's definitely clothing/wall
        largest = max(contours, key=cv2.contourArea)
        largest_area = float(cv2.contourArea(largest))
        if largest_area > (0.08 * total_pixels):
            contamination_hits += 1
            continue

        # Find the most plausible balloon contour (reasonable size)
        candidate_contours = [c for c in contours if tracker.min_contour_area <= cv2.contourArea(c) <= (0.06 * total_pixels)]
        if not candidate_contours:
            # Mask has pixels but no reasonable balloon contour
            if total_mask_px > 500:
                contamination_hits += 1
            continue

        # Pick candidate with best circularity or largest within reasonable bounds
        balloon_contour = max(candidate_contours, key=cv2.contourArea)
        balloon_area = float(cv2.contourArea(balloon_contour))

        balloon_mask = np.zeros((h, w), dtype=np.uint8)
        cv2.drawContours(balloon_mask, [balloon_contour], -1, 255, -1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
        dilated_balloon_mask = cv2.dilate(balloon_mask, kernel, iterations=1)

        outside_mask = cv2.bitwise_and(mask, cv2.bitwise_not(dilated_balloon_mask))
        contaminating_px = cv2.countNonZero(outside_mask)

        # Contamination condition: matching pixels outside balloon exceed 1% of frame or exceed balloon area
        if (contaminating_px / float(total_pixels)) > max_contamination_ratio or (
            contaminating_px > 1.2 * balloon_area
        ):
            contamination_hits += 1

    if contamination_hits >= max(2, sample_count // 3):
        msg = "Something else in the picture matches the balloon colour. Change the balloon or the clothing."
        return False, msg

    return True, "Color clearance passed"


class BalloonReferee:
    """Pure rule-judging and trajectory analysis logic for Balloon Keep-Up."""

    def __init__(
        self,
        ground_y: float = 0.90,
        target_y: float = 0.35,
        fps: float = 30.0,
        stride: int = 2,
        team_name: str = "Team A",
    ):
        self.ground_y = float(ground_y)
        self.target_y = float(target_y)
        self.fps = fps
        self.stride = stride
        self.dt = self.stride / float(fps if fps > 0 else 30.0)
        self.team_name = team_name

    def evaluate_trajectory(
        self,
        trajectory: List[Tuple[int, float, Optional[Dict[str, Any]]]],
        frame_height: int,
    ) -> Dict[str, Any]:
        """Evaluates balloon trajectory to extract hits, faults, ground contact, and score."""
        target_px = self.target_y * frame_height
        ground_px = self.ground_y * frame_height

        # Filter valid points
        points: List[Dict[str, Any]] = []
        for frame_idx, ts, det in trajectory:
            if det is not None:
                cx, cy = det["center"]
                points.append({
                    "frame_idx": frame_idx,
                    "ts": ts,
                    "cx": cx,
                    "cy": cy,
                    "bbox": det["bbox"],
                    "interpolated": det.get("interpolated", False),
                })

        if not points:
            return {
                "events": [],
                "valid_hits": 0,
                "faults": 0,
                "air_seconds": 0.0,
                "final_score": 0.0,
                "ground_time": None,
                "termination_reason": "No balloon detected in video.",
            }

        start_time = points[0]["ts"]
        end_time = points[-1]["ts"]
        ground_contact_time = None
        termination_reason = "Completed full clip duration without hitting floor."

        # Check for ground contact: reaching ground line or disappearing near it > 1.0s
        effective_points = []
        disappear_near_ground_start = None

        for p in points:
            cy = p["cy"]
            ts = p["ts"]

            # Direct ground contact
            if cy >= ground_px:
                ground_contact_time = ts
                end_time = ts
                termination_reason = f"Balloon hit the ground line (y={cy/frame_height:.2f} >= {self.ground_y:.2f})."
                effective_points.append(p)
                break

            effective_points.append(p)

        # Check if balloon disappeared near ground
        if ground_contact_time is None and points:
            last_p = points[-1]
            last_cy = last_p["cy"]
            near_ground_thresh = (self.ground_y - 0.12) * frame_height

            # If last point was near ground and clip continued for > 1.0s after
            clip_duration = trajectory[-1][1]
            if last_cy >= near_ground_thresh and (clip_duration - last_p["ts"]) >= 1.0:
                ground_contact_time = last_p["ts"]
                end_time = last_p["ts"]
                termination_reason = f"Balloon disappeared near ground line at {last_p['ts']:.1f}s for > 1.0s."

        air_seconds = max(0.0, end_time - start_time)

        # Smooth Y coordinates to reduce noise for velocity inflection detection
        y_vals = [p["cy"] for p in effective_points]
        if len(y_vals) >= 5:
            # Simple 3-point moving average
            smoothed_y = []
            for idx in range(len(y_vals)):
                win = y_vals[max(0, idx - 1): min(len(y_vals), idx + 2)]
                smoothed_y.append(sum(win) / float(len(win)))
        else:
            smoothed_y = y_vals

        # Detect hits: balloon turning from falling (dy > 0) to rising (dy < 0)
        # separated by at least 0.25 seconds
        raw_hits: List[int] = []
        last_hit_ts = -10.0

        for i in range(1, len(smoothed_y) - 1):
            ts = effective_points[i]["ts"]
            dy_before = smoothed_y[i] - smoothed_y[i - 1]
            dy_after = smoothed_y[i + 1] - smoothed_y[i]

            # In screen coords: dy > 0 is falling down, dy < 0 is rising up
            # Turning point: dy_before >= 0 and dy_after < 0
            if dy_before >= -0.5 and dy_after < -0.5:
                if (ts - last_hit_ts) >= 0.25:
                    raw_hits.append(i)
                    last_hit_ts = ts

        # Evaluate each hit: find highest point (min y) before next hit or descent
        events: List[Dict[str, Any]] = []
        valid_hits_count = 0
        faults_count = 0

        for h_idx, pt_idx in enumerate(raw_hits):
            hit_pt = effective_points[pt_idx]
            hit_ts = hit_pt["ts"]

            # Next boundary is either next hit index or end of trajectory
            next_boundary = raw_hits[h_idx + 1] if h_idx + 1 < len(raw_hits) else len(effective_points)
            post_hit_slice = smoothed_y[pt_idx:next_boundary]

            apex_y = min(post_hit_slice) if post_hit_slice else hit_pt["cy"]
            apex_idx = pt_idx + post_hit_slice.index(apex_y) if post_hit_slice else pt_idx
            apex_ts = effective_points[apex_idx]["ts"]

            # Check if apex reached above target line (apex_y <= target_px)
            is_valid = (apex_y <= target_px)
            if is_valid:
                valid_hits_count += 1
                reason = (
                    f"Valid hit! Balloon reached apex at y={apex_y/frame_height:.2f}, "
                    f"clearing target line ({self.target_y:.2f})."
                )
                events.append({
                    "type": "HIT_VALID",
                    "hitIndex": len(events) + 1,
                    "timestampSec": round(float(hit_ts), 2),
                    "apexTimestampSec": round(float(apex_ts), 2),
                    "apexYNorm": round(float(apex_y / frame_height), 2),
                    "targetYNorm": self.target_y,
                    "reason": reason,
                    "frameIdx": hit_pt["frame_idx"],
                    "pt": hit_pt,
                })
            else:
                faults_count += 1
                reason = (
                    f"Fault! Hit reached apex at y={apex_y/frame_height:.2f}, "
                    f"failing to clear target line ({self.target_y:.2f})."
                )
                events.append({
                    "type": "FAULT",
                    "hitIndex": len(events) + 1,
                    "timestampSec": round(float(hit_ts), 2),
                    "apexTimestampSec": round(float(apex_ts), 2),
                    "apexYNorm": round(float(apex_y / frame_height), 2),
                    "targetYNorm": self.target_y,
                    "reason": reason,
                    "frameIdx": hit_pt["frame_idx"],
                    "pt": hit_pt,
                })

        # Add ground contact event if applicable
        if ground_contact_time is not None:
            events.append({
                "type": "GROUND_CONTACT",
                "timestampSec": round(float(ground_contact_time), 2),
                "groundYNorm": self.ground_y,
                "reason": termination_reason,
                "frameIdx": effective_points[-1]["frame_idx"],
                "pt": effective_points[-1],
            })

        # Final score: seconds in the air + 1 per valid hit - 1 per fault
        final_score = round(max(0.0, air_seconds + valid_hits_count - faults_count), 1)

        return {
            "events": events,
            "valid_hits": valid_hits_count,
            "faults": faults_count,
            "air_seconds": round(air_seconds, 1),
            "final_score": final_score,
            "ground_time": ground_contact_time,
            "termination_reason": termination_reason,
            "effective_points": effective_points,
        }


def judge_balloon(
    video_path: Union[str, Path],
    team: str,
    hsv_lower_str: str,
    hsv_upper_str: str,
    key: str,
    ground_y: float = 0.90,
    target_y: float = 0.35,
    stride: int = 2,
) -> Dict[str, Any]:
    """Runs end-to-end judging for a Balloon Keep-Up video."""
    video = VideoReader(video_path, max_width=960, stride=stride)
    w = video.target_width
    h = video.target_height

    lower_vals = [int(v.strip()) for v in hsv_lower_str.split(",")]
    upper_vals = [int(v.strip()) for v in hsv_upper_str.split(",")]
    if len(lower_vals) != 3 or len(upper_vals) != 3:
        raise ValueError("HSV bounds must each have 3 comma-separated integers (H,S,V)")

    tracker = ColorTracker(
        hsv_lower=(lower_vals[0], lower_vals[1], lower_vals[2]),
        hsv_upper=(upper_vals[0], upper_vals[1], upper_vals[2]),
        min_contour_area=30.0,
    )
    evidence = EvidenceCollector(max_items=12, max_width=640, quality=70)

    # 1. Read opening frames and perform Color Clearance Check
    raw_frames: List[Tuple[int, float, np.ndarray]] = []
    opening_frames: List[np.ndarray] = []

    for frame_idx, timestamp_sec, frame in video.read_frames():
        raw_frames.append((frame_idx, timestamp_sec, frame))
        if len(opening_frames) < 30:
            opening_frames.append(frame)

    passed_clearance, clearance_msg = perform_color_clearance_check(opening_frames, tracker)
    if not passed_clearance:
        video.release()
        raise ColorClearanceError(clearance_msg)

    # 2. Track balloon across all frames
    raw_trajectory: List[Tuple[int, float, Optional[Dict[str, Any]]]] = []
    for frame_idx, timestamp_sec, frame in raw_frames:
        det = tracker.detect(frame)
        raw_trajectory.append((frame_idx, timestamp_sec, det))

    # 3. Interpolate gaps up to 10 frames
    interpolated_trajectory = ColorTracker.interpolate_gaps(raw_trajectory, max_gap=10)

    # 4. Evaluate balloon rules
    referee = BalloonReferee(
        ground_y=ground_y,
        target_y=target_y,
        fps=video.fps,
        stride=stride,
        team_name=team,
    )
    results = referee.evaluate_trajectory(interpolated_trajectory, h)

    # 5. Collect evidence frames for events
    frame_map = {f_idx: (ts, fr) for f_idx, ts, fr in raw_frames}
    guidelines = [
        (target_y, "Target Line", (0, 220, 255)),
        (ground_y, "Ground Line", (0, 0, 255)),
    ]

    for ev in results["events"]:
        f_idx = ev.get("frameIdx")
        if f_idx in frame_map:
            ts, fr = frame_map[f_idx]
            pt = ev.get("pt")
            pt_list = []
            if pt:
                color = (0, 255, 0) if ev["type"] == "HIT_VALID" else (0, 165, 255)
                if ev["type"] == "GROUND_CONTACT":
                    color = (0, 0, 255)
                pt_list.append((pt["cx"], pt["cy"], ev["type"], color))

            evidence.add(
                fr,
                title=f"{ev['type'].replace('_', ' ').title()}",
                reason=ev["reason"],
                timestamp_sec=ts,
                horizontal_lines=guidelines,
                points=pt_list,
            )

    # Clean events for report output
    cleaned_events = []
    for ev in results["events"]:
        entry = {
            "type": ev["type"],
            "reason": ev["reason"],
            "timestampSec": ev["timestampSec"],
        }
        if "targetYNorm" in ev:
            entry["targetYNorm"] = ev["targetYNorm"]
        if "apexYNorm" in ev:
            entry["apexYNorm"] = ev["apexYNorm"]
        cleaned_events.append(entry)

    # Format team, score, strikes
    team_clean = team.strip().upper() if team else "A"
    team_id = f"team_{team_clean.lower()}"
    team_name = f"Team {team_clean}"

    players_report = [{"id": team_id, "name": team_name}]
    scores_report = {team_id: results["final_score"]}
    strikes_report = {team_id: results["faults"]}

    winner = {
        "id": team_id,
        "name": team_name,
        "score": results["final_score"],
    }

    # Quality Summary
    detected_frames = sum(1 for _, _, d in interpolated_trajectory if d is not None)
    ball_pct = round((detected_frames / float(max(1, len(interpolated_trajectory)))) * 100.0, 1)

    quality_warnings = []
    if ball_pct < 60.0:
        quality_warnings.append(
            f"Balloon detected in {ball_pct:.1f}% of frames; tracking may have had occlusions."
        )
    if results["air_seconds"] < 5.0:
        quality_warnings.append(
            f"Short air duration ({results['air_seconds']:.1f}s)."
        )

    quality_status = "Good" if not quality_warnings else "Warning"
    quality_summary = {
        "status": quality_status,
        "balloonTrackingRate": f"{ball_pct:.1f}%",
        "airSeconds": results["air_seconds"],
        "validHits": results["valid_hits"],
        "faults": results["faults"],
        "finalScore": results["final_score"],
        "warnings": quality_warnings,
    }

    meta = {
        "stats": {
            "airSeconds": results["air_seconds"],
            "validHits": results["valid_hits"],
            "faults": results["faults"],
            "finalScore": results["final_score"],
            "groundTime": results["ground_time"],
            "terminationReason": results["termination_reason"],
        },
        "qualitySummary": quality_summary,
        "gameType": "balloon",
    }

    report = create_report(
        game_name="Balloon Keep-Up",
        duration_sec=video.duration_sec,
        players=players_report,
        scores=scores_report,
        strikes=strikes_report,
        events=cleaned_events,
        evidence=evidence.get_items(),
        winner=winner,
        meta=meta,
    )

    signed = sign_report(report, key)
    video.release()
    return signed

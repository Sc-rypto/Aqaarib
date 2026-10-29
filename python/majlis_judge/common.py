"""Common utilities for Majlis Judge: video reader, evidence collector,
ColorTracker, report builder, HMAC-SHA256 signer and verification."""

import base64
import hashlib
import hmac
import json
from pathlib import Path
import time
from typing import Any, Dict, Generator, List, Optional, Tuple, Union

import cv2
import numpy as np


class VideoReader:
    """Reads video files, resizes frames up to a maximum width preserving aspect ratio,
    and supports a configurable frame stride."""

    def __init__(self, video_path: Union[str, Path], max_width: int = 960, stride: int = 2):
        self.video_path = str(video_path)
        self.max_width = int(max_width)
        self.stride = max(1, int(stride))

        self.cap = cv2.VideoCapture(self.video_path)
        if not self.cap.isOpened():
            raise ValueError(f"Could not open video file: {self.video_path}")

        self.fps = self.cap.get(cv2.CAP_PROP_FPS)
        if self.fps <= 0 or np.isnan(self.fps):
            self.fps = 30.0

        self.total_frames = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.orig_width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.orig_height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.duration_sec = self.total_frames / self.fps if self.total_frames > 0 else 0.0

        if self.orig_width > self.max_width and self.orig_width > 0:
            self.scale = self.max_width / float(self.orig_width)
            self.target_width = self.max_width
            self.target_height = int(round(self.orig_height * self.scale))
        else:
            self.scale = 1.0
            self.target_width = self.orig_width
            self.target_height = self.orig_height

    def read_frames(self) -> Generator[Tuple[int, float, np.ndarray], None, None]:
        """Yields (frame_idx, timestamp_sec, frame) for each processed stride frame."""
        self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        frame_idx = 0
        while True:
            ret, frame = self.cap.read()
            if not ret or frame is None:
                break

            if frame_idx % self.stride == 0:
                if self.scale != 1.0:
                    resized = cv2.resize(frame, (self.target_width, self.target_height), interpolation=cv2.INTER_AREA)
                else:
                    resized = frame.copy()
                timestamp_sec = frame_idx / self.fps
                yield frame_idx, timestamp_sec, resized

            frame_idx += 1

    def release(self) -> None:
        if self.cap is not None and self.cap.isOpened():
            self.cap.release()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.release()


class ColorTracker:
    """HSV color tracker with Gaussian blur, morphological filtering, largest contour detection,
    centroid calculation, and linear gap filling up to max_gap_frames."""

    def __init__(
        self,
        hsv_lower: Optional[Tuple[int, int, int]] = None,
        hsv_upper: Optional[Tuple[int, int, int]] = None,
        lower_hsv: Optional[Tuple[int, int, int]] = None,
        upper_hsv: Optional[Tuple[int, int, int]] = None,
        blur_ksize: int = 7,
        morph_kernel_size: int = 5,
        min_contour_area: float = 35.0,
        max_gap_frames: int = 10,
    ):
        low = hsv_lower if hsv_lower is not None else lower_hsv
        upp = hsv_upper if hsv_upper is not None else upper_hsv
        if low is None or upp is None:
            raise ValueError("HSV lower and upper bounds must be provided")

        self.hsv_lower = np.array(low, dtype=np.uint8)
        self.hsv_upper = np.array(upp, dtype=np.uint8)
        self.blur_ksize = blur_ksize if blur_ksize % 2 == 1 else blur_ksize + 1
        self.morph_kernel_size = morph_kernel_size
        self.min_contour_area = float(min_contour_area)
        self.max_gap_frames = int(max_gap_frames)

        self._morph_kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (self.morph_kernel_size, self.morph_kernel_size)
        )

    def get_mask(self, frame: np.ndarray) -> np.ndarray:
        """Generates the filtered binary mask for the given frame."""
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        blurred = cv2.GaussianBlur(hsv, (self.blur_ksize, self.blur_ksize), 0)

        # Handle hue wrap-around (e.g. lower hue > upper hue for red wrap around 180)
        if self.hsv_lower[0] > self.hsv_upper[0]:
            lower1 = np.array([self.hsv_lower[0], self.hsv_lower[1], self.hsv_lower[2]], dtype=np.uint8)
            upper1 = np.array([180, self.hsv_upper[1], self.hsv_upper[2]], dtype=np.uint8)
            lower2 = np.array([0, self.hsv_lower[1], self.hsv_lower[2]], dtype=np.uint8)
            upper2 = np.array([self.hsv_upper[0], self.hsv_upper[1], self.hsv_upper[2]], dtype=np.uint8)

            mask1 = cv2.inRange(blurred, lower1, upper1)
            mask2 = cv2.inRange(blurred, lower2, upper2)
            mask = cv2.bitwise_or(mask1, mask2)
        else:
            mask = cv2.inRange(blurred, self.hsv_lower, self.hsv_upper)

        # Noise removal via opening followed by closing
        mask = cv2.erode(mask, self._morph_kernel, iterations=1)
        mask = cv2.dilate(mask, self._morph_kernel, iterations=2)
        return mask

    def detect(self, frame: np.ndarray) -> Optional[Dict[str, Any]]:
        """Detects the largest contour in the color range, returns centroid, bbox, and area."""
        mask = self.get_mask(frame)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None

        largest = max(contours, key=cv2.contourArea)
        area = float(cv2.contourArea(largest))
        if area < self.min_contour_area:
            return None

        M = cv2.moments(largest)
        if M["m00"] == 0:
            return None

        cx = int(round(M["m10"] / M["m00"]))
        cy = int(round(M["m01"] / M["m00"]))
        x, y, w, h = cv2.boundingRect(largest)

        return {
            "center": (cx, cy),
            "bbox": (x, y, w, h),
            "area": area,
            "interpolated": False,
        }

    @staticmethod
    def interpolate_gaps(
        trajectory: List[Tuple[int, float, Optional[Dict[str, Any]]]],
        max_gap: int = 10,
    ) -> List[Tuple[int, float, Optional[Dict[str, Any]]]]:
        """Linearly interpolates missing detections when gaps are <= max_gap frames."""
        result = [item for item in trajectory]
        n = len(result)
        i = 0

        while i < n:
            if result[i][2] is None:
                # Find start of gap
                gap_start = i - 1
                if gap_start < 0:
                    i += 1
                    continue

                # Find end of gap
                gap_end = i
                while gap_end < n and result[gap_end][2] is None:
                    gap_end += 1

                if gap_end < n:
                    gap_len = gap_end - i
                    if gap_len <= max_gap:
                        det_start = result[gap_start][2]
                        det_end = result[gap_end][2]
                        if det_start is not None and det_end is not None:
                            (sx, sy) = det_start["center"]
                            (ex, ey) = det_end["center"]
                            (sbx, sby, sbw, sbh) = det_start["bbox"]
                            (ebx, eby, ebw, ebh) = det_end["bbox"]
                            s_area = det_start.get("area", 100.0)
                            e_area = det_end.get("area", 100.0)

                            for k in range(gap_len):
                                frac = (k + 1) / float(gap_len + 1)
                                ix = int(round(sx + frac * (ex - sx)))
                                iy = int(round(sy + frac * (ey - sy)))
                                ibx = int(round(sbx + frac * (ebx - sbx)))
                                iby = int(round(sby + frac * (eby - sby)))
                                ibw = int(round(sbw + frac * (ebw - sbw)))
                                ibh = int(round(sbh + frac * (ebh - sbh)))
                                iarea = s_area + frac * (e_area - s_area)

                                frame_idx = result[i + k][0]
                                ts = result[i + k][1]
                                result[i + k] = (
                                    frame_idx,
                                    ts,
                                    {
                                        "center": (ix, iy),
                                        "bbox": (ibx, iby, ibw, ibh),
                                        "area": iarea,
                                        "interpolated": True,
                                    },
                                )
                i = gap_end
            else:
                i += 1

        return result


class EvidenceCollector:
    """Collects up to max_items annotated frames, scales them to max width 640,
    compresses as JPEG at quality 70, and formats them as base64 Data URIs."""

    def __init__(self, max_items: int = 12, max_width: int = 640, quality: int = 70):
        self.max_items = max_items
        self.max_width = max_width
        self.quality = quality
        self.items: List[Dict[str, Any]] = []

    def add(
        self,
        frame: np.ndarray,
        title: str,
        reason: str,
        timestamp_sec: float,
        bboxes: Optional[List[Tuple[int, int, int, int, str, Tuple[int, int, int]]]] = None,
        boxes_normalized: Optional[List[Tuple[float, float, float, float, str, Tuple[int, int, int]]]] = None,
        horizontal_lines: Optional[List[Tuple[float, str, Tuple[int, int, int]]]] = None,
        points: Optional[List[Tuple[int, int, str, Tuple[int, int, int]]]] = None,
    ) -> bool:
        """Annotates frame and saves as an evidence item if under max_items capacity.
        Returns True if added, False if capacity reached."""
        if len(self.items) >= self.max_items:
            return False

        annotated = frame.copy()
        h, w = annotated.shape[:2]

        # Draw horizontal guidelines (e.g. ground-y, target-y in normalized coordinates)
        if horizontal_lines:
            for y_norm, label, color in horizontal_lines:
                y_px = int(round(y_norm * h))
                cv2.line(annotated, (0, y_px), (w, y_px), color, 2, cv2.LINE_AA)
                cv2.putText(
                    annotated,
                    f"{label} ({y_norm:.2f})",
                    (10, max(20, y_px - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    color,
                    2,
                    cv2.LINE_AA,
                )

        # Draw normalized boxes (e.g. goal zones: x1, y1, x2, y2)
        if boxes_normalized:
            for nx1, ny1, nx2, ny2, label, color in boxes_normalized:
                px1, py1 = int(round(nx1 * w)), int(round(ny1 * h))
                px2, py2 = int(round(nx2 * w)), int(round(ny2 * h))
                cv2.rectangle(annotated, (px1, py1), (px2, py2), color, 2)
                cv2.putText(
                    annotated,
                    label,
                    (px1 + 5, py1 + 22),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    color,
                    2,
                    cv2.LINE_AA,
                )

        # Draw pixel bboxes
        if bboxes:
            for bx, by, bw, bh, label, color in bboxes:
                cv2.rectangle(annotated, (bx, by), (bx + bw, by + bh), color, 2)
                if label:
                    cv2.putText(
                        annotated,
                        label,
                        (bx, max(18, by - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.5,
                        color,
                        2,
                        cv2.LINE_AA,
                    )

        # Draw points
        if points:
            for px, py, label, color in points:
                cv2.circle(annotated, (px, py), 6, color, -1)
                if label:
                    cv2.putText(
                        annotated,
                        label,
                        (px + 8, py - 4),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.5,
                        color,
                        2,
                        cv2.LINE_AA,
                    )

        # Add caption banner at bottom
        banner_height = 42
        overlay = annotated.copy()
        cv2.rectangle(overlay, (0, h - banner_height), (w, h), (18, 22, 28), -1)
        cv2.addWeighted(overlay, 0.75, annotated, 0.25, 0, annotated)

        caption_text = f"[{timestamp_sec:.1f}s] {title}: {reason}"
        if len(caption_text) > 75:
            caption_text = caption_text[:72] + "..."
        cv2.putText(
            annotated,
            caption_text,
            (12, h - 14),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.52,
            (240, 244, 248),
            1,
            cv2.LINE_AA,
        )

        # Resize to max width 640
        if w > self.max_width:
            scale = self.max_width / float(w)
            new_w = self.max_width
            new_h = int(round(h * scale))
            resized = cv2.resize(annotated, (new_w, new_h), interpolation=cv2.INTER_AREA)
        else:
            resized = annotated

        # Encode as JPEG quality 70
        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), self.quality]
        success, enc = cv2.imencode(".jpg", resized, encode_params)
        if not success:
            return False

        b64 = base64.b64encode(enc.tobytes()).decode("ascii")
        data_uri = f"data:image/jpeg;base64,{b64}"

        evidence_entry = {
            "id": f"ev_{len(self.items) + 1}",
            "title": title,
            "reason": reason,
            "timestampSec": round(float(timestamp_sec), 2),
            "imageUri": data_uri,
        }
        self.items.append(evidence_entry)
        return True

    def get_items(self) -> List[Dict[str, Any]]:
        return list(self.items)


def create_report(
    game_name: str,
    duration_sec: float,
    players: List[Dict[str, str]],
    scores: Dict[str, Union[int, float]],
    strikes: Dict[str, int],
    events: List[Dict[str, Any]],
    evidence: List[Dict[str, Any]],
    winner: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
    session_timestamp: Optional[Union[int, str]] = None,
) -> Dict[str, Any]:
    """Builds a standardized game result object adhering to the /dev/stubs/report.js contract."""
    if winner is None and players:
        # Determine top scorer
        top_score = -float("inf")
        top_player = None
        for p in players:
            score = scores.get(p["id"], 0)
            if score > top_score:
                top_score = score
                top_player = {"id": p["id"], "name": p["name"], "score": score}
        winner = top_player

    report = {
        "gameName": str(game_name),
        "sessionTimestamp": session_timestamp if session_timestamp is not None else int(time.time() * 1000),
        "durationSec": round(float(max(0.0, duration_sec)), 1),
        "players": players,
        "scores": scores,
        "strikes": strikes,
        "events": events,
        "evidence": evidence,
        "winner": winner,
        "meta": {
            "generatedBy": "Aqaarib Match Judge",
            "visionModel": "Ultralytics YOLOv8n + ByteTrack / ColorTracker",
            **(meta or {}),
        },
    }
    return report


def validate_report(report: Any) -> Tuple[bool, List[str]]:
    """Validates a report object against the frozen specification from dev/stubs/report.js."""
    errors: List[str] = []

    if not isinstance(report, dict):
        return False, ["Report must be a JSON object"]

    game_name = report.get("gameName")
    if not isinstance(game_name, str) or not game_name.strip():
        errors.append("gameName must be a non-empty string")

    session_ts = report.get("sessionTimestamp")
    if not isinstance(session_ts, (int, float, str)):
        errors.append("sessionTimestamp must be a number or string")

    duration = report.get("durationSec")
    if not isinstance(duration, (int, float)) or duration < 0:
        errors.append("durationSec must be a non-negative number")

    players = report.get("players")
    if not isinstance(players, list) or len(players) == 0:
        errors.append("players must be a non-empty array of player objects")
    else:
        for idx, p in enumerate(players):
            if not isinstance(p, dict) or not p.get("id") or not p.get("name"):
                errors.append(f"players[{idx}] must contain valid id and name")

    scores = report.get("scores")
    if not isinstance(scores, dict):
        errors.append("scores must be an object")
    elif isinstance(players, list):
        for p in players:
            if isinstance(p, dict) and "id" in p:
                pid = p["id"]
                if pid not in scores or not isinstance(scores[pid], (int, float)):
                    errors.append(f"scores must contain a numeric entry for player {pid}")

    strikes = report.get("strikes")
    if not isinstance(strikes, dict):
        errors.append("strikes must be an object mapping player IDs to numbers")

    events = report.get("events")
    if not isinstance(events, list):
        errors.append("events must be an array")
    else:
        for idx, ev in enumerate(events):
            if not isinstance(ev, dict) or not isinstance(ev.get("reason"), str) or not ev.get("reason").strip():
                errors.append(f"events[{idx}] must contain a plain string reason")

    evidence = report.get("evidence")
    if not isinstance(evidence, list):
        errors.append("evidence must be an array")

    return (len(errors) == 0, errors)


def sign_report(result_dict: Dict[str, Any], key: str) -> Dict[str, Any]:
    """Signs report payload using HMAC-SHA256 with canonical sorted JSON,
    returning exactly { 'payload': ..., 'hmac': '...' }."""
    if not key or not str(key).strip():
        raise ValueError("A non-empty HMAC signing key is required")

    canonical_json = json.dumps(result_dict, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    mac = hmac.new(
        key.encode("utf-8"),
        canonical_json.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return {
        "payload": result_dict,
        "hmac": mac,
    }


def verify_report(report_data: Union[Dict[str, Any], str, Path], key: str) -> Tuple[bool, str]:
    """Verifies HMAC-SHA256 signature and schema validity of a signed report dictionary or file.
    Supports payload as either an inner JSON dict or a serialized JSON string."""
    if isinstance(report_data, (str, Path)):
        path = Path(report_data)
        if not path.is_file():
            return False, f"Report file does not exist: {path}"
        try:
            with open(path, "r", encoding="utf-8") as f:
                report_data = json.load(f)
        except Exception as e:
            return False, f"Could not parse report JSON: {e}"

    if not isinstance(report_data, dict):
        return False, "Signed report must be a JSON object"

    raw_payload = report_data.get("payload")
    provided_hmac = report_data.get("hmac")

    if raw_payload is None:
        return False, "Missing 'payload' in signed report"

    if not provided_hmac or not isinstance(provided_hmac, str):
        return False, "Missing or invalid 'hmac' string in signed report"

    if not key or not str(key).strip():
        return False, "Signing key must not be empty"

    key_bytes = key.encode("utf-8")

    # If payload is a serialized JSON string (like fixtures), hash directly
    if isinstance(raw_payload, str):
        payload_bytes = raw_payload.encode("utf-8")
        try:
            payload_obj = json.loads(raw_payload)
        except Exception:
            payload_obj = None
    elif isinstance(raw_payload, dict):
        payload_bytes = json.dumps(raw_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        payload_obj = raw_payload
    else:
        return False, "Payload must be a JSON object or string"

    expected_hmac = hmac.new(key_bytes, payload_bytes, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected_hmac, provided_hmac):
        return False, "The report signature is invalid. The file was changed or the key was incorrect."

    # Validate schema if contract matches
    if isinstance(payload_obj, dict) and "gameName" in payload_obj:
        is_valid, errors = validate_report(payload_obj)
        if not is_valid:
            return False, f"Payload schema error: {'; '.join(errors)}"

    return True, "Report signature and schema verified successfully"


def tamper_report(input_path: Union[str, Path], output_path: Optional[Union[str, Path]] = None) -> Path:
    """Creates a tampered copy of a signed report with an edited score but the original HMAC."""
    in_p = Path(input_path)
    if not in_p.is_file():
        raise FileNotFoundError(f"Input report not found: {in_p}")

    with open(in_p, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, dict) or "payload" not in data or "hmac" not in data:
        raise ValueError("Input file is not a valid signed report format { payload, hmac }")

    raw_payload = data["payload"]
    if isinstance(raw_payload, str):
        payload_obj = json.loads(raw_payload)
        scores = payload_obj.get("scores", {})
        if isinstance(scores, dict):
            if "players" in scores and isinstance(scores["players"], dict):
                first_k = next(iter(scores["players"]))
                scores["players"][first_k] = scores["players"][first_k] + 10
            elif "teams" in scores and isinstance(scores["teams"], dict):
                first_k = next(iter(scores["teams"]))
                scores["teams"][first_k] = scores["teams"][first_k] + 10
            elif scores:
                first_k = next(iter(scores))
                scores[first_k] = scores[first_k] + 10
            else:
                scores["p1"] = 10
        payload_obj["scores"] = scores
        data["payload"] = json.dumps(payload_obj)
    elif isinstance(raw_payload, dict):
        scores = raw_payload.get("scores", {})
        if not scores:
            scores["player_1"] = 100
        else:
            first_key = next(iter(scores))
            scores[first_key] = scores[first_key] + 10
        raw_payload["scores"] = scores
        data["payload"] = raw_payload

    if output_path is None:
        out_p = in_p.parent / f"{in_p.stem}_tampered{in_p.suffix}"
    else:
        out_p = Path(output_path)

    with open(out_p, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    return out_p

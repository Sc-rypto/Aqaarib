"""Tests for majlis_judge.common: ColorTracker, EvidenceCollector, signer, and contract."""

import json
import numpy as np
import pytest

from majlis_judge.common import (
    ColorTracker,
    EvidenceCollector,
    create_report,
    sign_report,
    tamper_report,
    validate_report,
    verify_report,
)


def test_color_tracker_detection():
    # Bright green circle on black background
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    import cv2
    # BGR for pure bright green: (0, 255, 0) -> HSV: (60, 255, 255)
    cv2.circle(img, (100, 100), 20, (0, 255, 0), -1)

    tracker = ColorTracker(hsv_lower=(50, 100, 100), hsv_upper=(70, 255, 255), min_contour_area=20.0)
    det = tracker.detect(img)

    assert det is not None
    cx, cy = det["center"]
    assert abs(cx - 100) <= 2
    assert abs(cy - 100) <= 2
    assert det["area"] > 500


def test_color_tracker_hue_wrap():
    # Pure red wrap-around: BGR (0, 0, 255) has hue ~0 or 179
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    import cv2
    cv2.circle(img, (120, 80), 15, (0, 0, 255), -1)

    # Hue wraps from 170 to 10
    tracker = ColorTracker(hsv_lower=(170, 120, 120), hsv_upper=(10, 255, 255), min_contour_area=20.0)
    det = tracker.detect(img)

    assert det is not None
    cx, cy = det["center"]
    assert abs(cx - 120) <= 2
    assert abs(cy - 80) <= 2


def test_gap_interpolation():
    # Gap of 4 frames between frame 2 and frame 7
    trajectory = [
        (0, 0.0, {"center": (10, 20), "bbox": (5, 15, 10, 10), "area": 100.0}),
        (1, 0.1, {"center": (20, 30), "bbox": (15, 25, 10, 10), "area": 100.0}),
        (2, 0.2, {"center": (30, 40), "bbox": (25, 35, 10, 10), "area": 100.0}),
        (3, 0.3, None),
        (4, 0.4, None),
        (5, 0.5, None),
        (6, 0.6, None),
        (7, 0.7, {"center": (80, 90), "bbox": (75, 85, 10, 10), "area": 100.0}),
        (8, 0.8, {"center": (90, 100), "bbox": (85, 95, 10, 10), "area": 100.0}),
    ]

    interpolated = ColorTracker.interpolate_gaps(trajectory, max_gap=10)
    assert len(interpolated) == 9

    # Frame 4 should be linearly interpolated
    f4 = interpolated[4]
    assert f4[2] is not None
    assert f4[2]["interpolated"] is True
    # At index 4 (k=1 out of gap_len=4, frac=2/5 = 0.4 between 30 and 80 -> 50)
    cx, cy = f4[2]["center"]
    assert abs(cx - 50) <= 2
    assert abs(cy - 60) <= 2


def test_gap_exceeds_max_not_interpolated():
    # Gap of 12 frames
    trajectory = [(0, 0.0, {"center": (10, 10), "bbox": (5, 5, 10, 10), "area": 100.0})]
    for idx in range(1, 13):
        trajectory.append((idx, idx * 0.1, None))
    trajectory.append((13, 1.3, {"center": (140, 140), "bbox": (135, 135, 10, 10), "area": 100.0}))

    interpolated = ColorTracker.interpolate_gaps(trajectory, max_gap=10)
    assert interpolated[5][2] is None
    assert interpolated[10][2] is None


def test_evidence_collector():
    collector = EvidenceCollector(max_items=3, max_width=320, quality=70)
    frame = np.zeros((480, 640, 3), dtype=np.uint8)

    # Add 4 items, should cap at 3
    for i in range(4):
        added = collector.add(frame, title=f"Event {i}", reason=f"Test reason {i}", timestamp_sec=float(i))
        if i < 3:
            assert added is True
        else:
            assert added is False

    items = collector.get_items()
    assert len(items) == 3
    assert items[0]["id"] == "ev_1"
    assert items[0]["imageUri"].startswith("data:image/jpeg;base64,")


def test_sign_and_verify_report(tmp_path):
    report = create_report(
        game_name="Football Match",
        duration_sec=45.2,
        players=[{"id": "team_a", "name": "Team A"}, {"id": "team_b", "name": "Team B"}],
        scores={"team_a": 3, "team_b": 1},
        strikes={"team_a": 0, "team_b": 0},
        events=[{"type": "GOAL", "reason": "Team A scored in Goal A"}],
        evidence=[],
    )

    key = "secret_referee_key_2026"
    signed = sign_report(report, key)
    assert "payload" in signed
    assert "hmac" in signed
    assert isinstance(signed["hmac"], str)

    # Verification should succeed
    is_valid, msg = verify_report(signed, key)
    assert is_valid is True

    # Verification with wrong key should fail
    is_valid_wrong, msg_wrong = verify_report(signed, "wrong_key")
    assert is_valid_wrong is False
    assert "mismatch" in msg_wrong.lower()

    # Tampering should fail
    tampered = dict(signed)
    tampered_payload = dict(report)
    tampered_payload["scores"] = {"team_a": 99, "team_b": 1}
    tampered["payload"] = tampered_payload
    is_valid_tamp, msg_tamp = verify_report(tampered, key)
    assert is_valid_tamp is False


def test_tamper_report_file(tmp_path):
    report = create_report(
        game_name="Balloon Keep-Up",
        duration_sec=30.0,
        players=[{"id": "team_a", "name": "Team A"}],
        scores={"team_a": 15},
        strikes={"team_a": 2},
        events=[{"type": "FAULT", "reason": "Did not clear line"}],
        evidence=[],
    )
    key = "demo_key"
    signed = sign_report(report, key)

    orig_file = tmp_path / "original_report.json"
    with open(orig_file, "w") as f:
        json.dump(signed, f)

    tampered_file = tamper_report(orig_file)
    assert tampered_file.exists()

    # Original passes
    ok, _ = verify_report(orig_file, key)
    assert ok is True

    # Tampered fails verification
    fail, msg = verify_report(tampered_file, key)
    assert fail is False

"""Command Line Interface for Majlis Judge.
Commands:
  pick     - Interactive coordinate, box, and HSV picker on the first frame.
  football - Process a football clip, track players/ball, judge goals & possession, output signed report.
  balloon  - Process a balloon clip, verify color clearance, track hits & faults, output signed report.
  verify   - Verify cryptographic HMAC-SHA256 signature and schema of a report.
  tamper   - Create a tampered copy of a report with modified score and original HMAC.
"""

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Optional

import cv2
import numpy as np

from .balloon import ColorClearanceError, judge_balloon
from .common import VideoReader, sign_report, tamper_report, verify_report
from .football import judge_football


def resolve_key(cli_key: Optional[str]) -> str:
    """Retrieves signing key from CLI argument or MAJLIS_KEY environment variable."""
    key = cli_key or os.environ.get("MAJLIS_KEY")
    if not key or not key.strip():
        print(
            "❌ Error: No signing key provided. Pass --key <KEY> or set the MAJLIS_KEY environment variable.",
            file=sys.stderr,
        )
        sys.exit(1)
    return key.strip()


def print_quality_banner(quality_summary: dict, game_title: str) -> None:
    """Prints a clear quality summary and highlights any warnings."""
    status = quality_summary.get("status", "Good")
    icon = "✅" if status == "Good" else "⚠️"
    print("\n" + "=" * 60)
    print(f" {icon} {game_title.upper()} - QUALITY SUMMARY [{status.upper()}]")
    print("=" * 60)

    for k, v in quality_summary.items():
        if k == "warnings":
            continue
        print(f" • {k}: {v}")

    warnings = quality_summary.get("warnings", [])
    if warnings:
        print("\n ⚠️ Warnings detected:")
        for w in warnings:
            print(f"   - {w}")
    print("=" * 60 + "\n")


def cmd_pick(args: argparse.Namespace) -> None:
    """Interactive coordinate, bounding box, and HSV picker on first frame."""
    video_path = args.video
    try:
        reader = VideoReader(video_path, max_width=960, stride=1)
        frames_gen = reader.read_frames()
        _, _, frame = next(frames_gen)
        reader.release()
    except Exception as e:
        print(f"❌ Error loading video: {e}", file=sys.stderr)
        sys.exit(1)

    h, w = frame.shape[:2]
    hsv_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    print("\n" + "=" * 65)
    print(" 🎯 MAJLIS JUDGE - PIXEL & HSV PICKER")
    print("=" * 65)
    print(f" Frame Dimensions: {w}x{h} (w x h)")
    print(" Instructions:")
    print("  - Left click to inspect pixel coordinate, normalized position, and HSV.")
    print("  - Click & drag to inspect rectangle box coordinates.")
    print("  - Press 'q' or 'ESC' on the window to exit.")
    print("=" * 65 + "\n")

    drag_start = None
    display_frame = frame.copy()

    def mouse_callback(event, x, y, flags, param):
        nonlocal drag_start, display_frame
        if event == cv2.EVENT_LBUTTONDOWN:
            drag_start = (x, y)
            if 0 <= y < h and 0 <= x < w:
                h_val, s_val, v_val = hsv_frame[y, x]
                b_val, g_val, r_val = frame[y, x]
                print(
                    f"📍 Pixel ({x}, {y}) | Norm: ({x/w:.3f}, {y/h:.3f}) | "
                    f"HSV: ({h_val}, {s_val}, {v_val}) | BGR: ({b_val}, {g_val}, {r_val})"
                )
        elif event == cv2.EVENT_LBUTTONUP:
            if drag_start:
                x1, y1 = drag_start
                x2, y2 = x, y
                min_x, max_x = min(x1, x2), max(x1, x2)
                min_y, max_y = min(y1, y2), max(y1, y2)
                print(
                    f"📐 Box Pixels: {min_x},{min_y},{max_x},{max_y} | "
                    f"Normalized: {min_x/w:.3f},{min_y/h:.3f},{max_x/w:.3f},{max_y/h:.3f}"
                )
                drag_start = None

    try:
        cv2.namedWindow("Majlis Frame Picker", cv2.WINDOW_AUTOSIZE)
        cv2.setMouseCallback("Majlis Frame Picker", mouse_callback)

        while True:
            cv2.imshow("Majlis Frame Picker", display_frame)
            key = cv2.waitKey(20) & 0xFF
            if key == 27 or key == ord("q"):
                break
            if cv2.getWindowProperty("Majlis Frame Picker", cv2.WND_PROP_VISIBLE) < 1:
                break
        cv2.destroyAllWindows()
    except Exception as e:
        print(f"⚠️ GUI display not available in this environment ({e}).")
        print("First frame loaded successfully. Top-left pixel HSV:", hsv_frame[0, 0])


def cmd_football(args: argparse.Namespace) -> None:
    """Executes football referee on input video."""
    key = resolve_key(args.key)
    out_path = Path(args.out)

    print(f"\n⚽ Running Football Referee on: {args.video}...")
    try:
        signed_report = judge_football(
            video_path=args.video,
            goal_a_str=args.goal_a,
            goal_b_str=args.goal_b,
            key=key,
            swap_teams=args.swap_teams,
            ball_hsv=args.ball_hsv,
            stride=args.stride,
        )
    except Exception as e:
        print(f"❌ Error during football judging: {e}", file=sys.stderr)
        sys.exit(1)

    payload = signed_report["payload"]
    quality_summary = payload.get("meta", {}).get("qualitySummary", {})
    print_quality_banner(quality_summary, "Football Match")

    scores = payload.get("scores", {})
    stats = payload.get("meta", {}).get("stats", {})
    mvp = stats.get("mvp")

    print(f" Final Score: Team A [{scores.get('team_a', 0)}] - [{scores.get('team_b', 0)}] Team B")
    if mvp:
        print(f" Match MVP: {mvp['name']} ({mvp['reason']})")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(signed_report, f, indent=2)

    print(f"\n✅ Signed report written to: {out_path}")
    print(f"🔐 HMAC-SHA256 Signature: {signed_report['hmac']}")


def cmd_balloon(args: argparse.Namespace) -> None:
    """Executes balloon referee on input video."""
    key = resolve_key(args.key)
    out_path = Path(args.out)

    print(f"\n🎈 Running Balloon Referee on: {args.video} for Team {args.team}...")
    try:
        signed_report = judge_balloon(
            video_path=args.video,
            team=args.team,
            hsv_lower_str=args.hsv_lower,
            hsv_upper_str=args.hsv_upper,
            key=key,
            ground_y=args.ground_y,
            target_y=args.target_y,
            stride=args.stride,
        )
    except ColorClearanceError as cce:
        print("\n" + "=" * 60)
        print(" ❌ COLOUR CLEARANCE FAILURE")
        print("=" * 60)
        print(f" {cce}")
        print("=" * 60 + "\n")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error during balloon judging: {e}", file=sys.stderr)
        sys.exit(1)

    payload = signed_report["payload"]
    quality_summary = payload.get("meta", {}).get("qualitySummary", {})
    print_quality_banner(quality_summary, "Balloon Keep-Up")

    scores = payload.get("scores", {})
    strikes = payload.get("strikes", {})
    stats = payload.get("meta", {}).get("stats", {})
    team_id = f"team_{args.team.lower()}"

    print(f" Air Duration: {stats.get('airSeconds', 0):.1f}s")
    print(f" Valid Hits: {stats.get('validHits', 0)} | Faults: {strikes.get(team_id, 0)}")
    print(f" Final Score: {scores.get(team_id, 0)} pts")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(signed_report, f, indent=2)

    print(f"\n✅ Signed report written to: {out_path}")
    print(f"🔐 HMAC-SHA256 Signature: {signed_report['hmac']}")


def cmd_verify(args: argparse.Namespace) -> None:
    """Verifies HMAC signature and contract compliance of a report."""
    key = resolve_key(args.key)
    report_path = Path(args.report)

    is_valid, msg = verify_report(report_path, key)
    if is_valid:
        print("\n" + "=" * 60)
        print(" ✅ REPORT VERIFICATION PASSED")
        print("=" * 60)
        print(" Cryptographic HMAC-SHA256 signature is authentic.")
        print(" Payload strictly complies with the frozen contract specification.")
        print(f" File: {report_path}")
        print("=" * 60 + "\n")
        sys.exit(0)
    else:
        print("\n" + "=" * 60, file=sys.stderr)
        print(" ❌ REPORT VERIFICATION FAILED", file=sys.stderr)
        print("=" * 60, file=sys.stderr)
        print(f" {msg}", file=sys.stderr)
        print(f" File: {report_path}", file=sys.stderr)
        print("=" * 60 + "\n", file=sys.stderr)
        sys.exit(1)


def cmd_tamper(args: argparse.Namespace) -> None:
    """Generates a tampered copy of a report with modified score and original HMAC."""
    report_path = Path(args.report)
    out_path = Path(args.out) if args.out else None

    try:
        tampered_path = tamper_report(report_path, out_path)
        print("\n" + "=" * 60)
        print(" ⚠️ TAMPERED REPORT CREATED (LIVE DEMO)")
        print("=" * 60)
        print(f" Source: {report_path}")
        print(f" Tampered output: {tampered_path}")
        print(" Score was modified (+10 pts) while retaining the original HMAC signature.")
        print(f" Run verify to test anti-cheat detection:")
        print(f"   python cli.py verify {tampered_path} --key <YOUR_KEY>")
        print("=" * 60 + "\n")
    except Exception as e:
        print(f"❌ Error creating tampered report: {e}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="majlis-judge",
        description="Majlis Judge - Video referee and rule enforcement engine for family games.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # 1. pick
    parser_pick = subparsers.add_parser("pick", help="Inspect coordinates and HSV values in video")
    parser_pick.add_argument("video", help="Path to video file")

    # 2. football
    parser_football = subparsers.add_parser("football", help="Judge a football match clip")
    parser_football.add_argument("video", help="Path to video file")
    parser_football.add_argument("--goal-a", required=True, help="Goal box for Team A (x1,y1,x2,y2)")
    parser_football.add_argument("--goal-b", required=True, help="Goal box for Team B (x1,y1,x2,y2)")
    parser_football.add_argument("--key", default=None, help="HMAC signing key (or MAJLIS_KEY env var)")
    parser_football.add_argument("--out", default="report.json", help="Path to output signed report JSON")
    parser_football.add_argument("--swap-teams", action="store_true", help="Swap Team A and Team B assignments")
    parser_football.add_argument("--ball-hsv", default=None, help="Fallback HSV bounds: h_low,s_low,v_low,h_hi,s_hi,v_hi")
    parser_football.add_argument("--stride", type=int, default=2, help="Frame stride for processing")

    # 3. balloon
    parser_balloon = subparsers.add_parser("balloon", help="Judge a balloon keep-up clip")
    parser_balloon.add_argument("video", help="Path to video file")
    parser_balloon.add_argument("--team", default="A", help="Team identifier (e.g. A, B)")
    parser_balloon.add_argument("--hsv-lower", required=True, help="Lower HSV bound: h,s,v")
    parser_balloon.add_argument("--hsv-upper", required=True, help="Upper HSV bound: h,s,v")
    parser_balloon.add_argument("--ground-y", type=float, default=0.90, help="Ground line normalized Y (default 0.90)")
    parser_balloon.add_argument("--target-y", type=float, default=0.35, help="Target line normalized Y (default 0.35)")
    parser_balloon.add_argument("--key", default=None, help="HMAC signing key (or MAJLIS_KEY env var)")
    parser_balloon.add_argument("--out", default="report.json", help="Path to output signed report JSON")
    parser_balloon.add_argument("--stride", type=int, default=2, help="Frame stride for processing")

    # 4. verify
    parser_verify = subparsers.add_parser("verify", help="Verify signed report integrity and schema")
    parser_verify.add_argument("report", help="Path to report JSON")
    parser_verify.add_argument("--key", default=None, help="HMAC signing key (or MAJLIS_KEY env var)")

    # 5. tamper
    parser_tamper = subparsers.add_parser("tamper", help="Create tampered report copy with unmodified HMAC")
    parser_tamper.add_argument("report", help="Path to report JSON")
    parser_tamper.add_argument("--out", default=None, help="Path for tampered output JSON")

    args = parser.parse_args()

    if args.command == "pick":
        cmd_pick(args)
    elif args.command == "football":
        cmd_football(args)
    elif args.command == "balloon":
        cmd_balloon(args)
    elif args.command == "verify":
        cmd_verify(args)
    elif args.command == "tamper":
        cmd_tamper(args)


if __name__ == "__main__":
    main()

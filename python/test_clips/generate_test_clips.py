"""Generates synthetic football and balloon match clips for verification and automated tests."""

from pathlib import Path
import cv2
import numpy as np


def generate_balloon_clip(output_path: Path, width: int = 640, height: int = 480, fps: int = 30) -> None:
    """Generates a synthetic balloon keep-up clip:
    - Target line at y=0.35 * 480 = 168
    - Ground line at y=0.90 * 480 = 432
    - Hit 1 at ~1.5s: rises to apex y=120 (Valid hit, clears target line)
    - Hit 2 at ~4.0s: rises to apex y=220 (Fault, fails to clear target line)
    - Ground contact at ~6.5s: touches y=435 (terminates round)
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))

    total_frames = 240  # 8 seconds at 30 fps
    balloon_radius = 24
    # Bright neon green balloon: BGR (20, 235, 30) -> HSV [57, 233, 235]
    balloon_color = (20, 235, 30)
    bg_color = (235, 230, 225)  # Warm papercraft neutral alabaster

    # Generate smooth Y trajectory
    y_traj = []
    # 0 to 45 (1.5s): falling 200 -> 380
    for y in np.linspace(200, 380, 45):
        y_traj.append(y)
    # 45 to 80 (1.16s): Hit 1 upwards 380 -> 120 (apex above target line 168)
    for y in np.linspace(380, 120, 35):
        y_traj.append(y)
    # 80 to 125 (1.5s): falling 120 -> 390
    for y in np.linspace(120, 390, 45):
        y_traj.append(y)
    # 125 to 155 (1.0s): Hit 2 upwards 390 -> 220 (apex below target line 168)
    for y in np.linspace(390, 220, 30):
        y_traj.append(y)
    # 155 to 195 (1.33s): falling 220 -> 435 (ground line 432)
    for y in np.linspace(220, 435, 40):
        y_traj.append(y)
    # 195 to 240: rests on ground 435
    for _ in range(total_frames - len(y_traj)):
        y_traj.append(435)

    bx = width // 2

    for f_idx in range(total_frames):
        frame = np.full((height, width, 3), bg_color, dtype=np.uint8)
        by = int(round(y_traj[f_idx]))

        # Gentle sway in X
        cur_x = int(round(bx + 35 * np.sin(f_idx * 0.08)))

        # Draw balloon (slight oval with knot)
        cv2.ellipse(frame, (cur_x, by), (balloon_radius, int(balloon_radius * 1.15)), 0, 0, 360, balloon_color, -1)
        # Knot
        cv2.circle(frame, (cur_x, by + int(balloon_radius * 1.15)), 4, (15, 180, 25), -1)

        out.write(frame)

    out.release()
    print(f"Generated synthetic balloon clip: {output_path} ({total_frames} frames)")


def generate_football_clip(output_path: Path, width: int = 640, height: int = 480, fps: int = 30) -> None:
    """Generates a synthetic football match clip with pitch, players, ball, and Goal A score:
    - Pitch: green field with white lines
    - Goal A: x in [0, 90], y in [140, 340]
    - Goal B: x in [550, 640], y in [140, 340]
    - Team A: Royal Blue shirts (BGR 210, 60, 20)
    - Team B: Red shirts (BGR 20, 40, 210)
    - Ball: Bright yellow-orange (BGR 0, 215, 255)
    - Dribble by Player #1 (Team A) for 2s, then kick into Goal A!
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))

    total_frames = 210  # 7 seconds at 30 fps
    pitch_color = (45, 130, 45)
    line_color = (240, 240, 240)

    team_a_color = (210, 60, 20)   # Royal Blue BGR
    team_b_color = (20, 40, 210)   # Red BGR
    ball_color = (0, 215, 255)     # Bright Yellow-Orange BGR

    def draw_player(img, cx, cy, shirt_color, label):
        # Head
        cv2.circle(img, (cx, cy - 35), 10, (180, 195, 215), -1)
        # Torso (Shirt)
        cv2.rectangle(img, (cx - 14, cy - 25), (cx + 14, cy + 5), shirt_color, -1)
        # Shorts
        cv2.rectangle(img, (cx - 12, cy + 5), (cx + 12, cy + 18), (30, 30, 30), -1)
        # Legs
        cv2.line(img, (cx - 6, cy + 18), (cx - 6, cy + 38), (180, 195, 215), 4)
        cv2.line(img, (cx + 6, cy + 18), (cx + 6, cy + 38), (180, 195, 215), 4)

    for f_idx in range(total_frames):
        frame = np.full((height, width, 3), pitch_color, dtype=np.uint8)

        # Draw pitch markings
        cv2.rectangle(frame, (20, 20), (width - 20, height - 20), line_color, 2)
        cv2.line(frame, (width // 2, 20), (width // 2, height - 20), line_color, 2)
        cv2.circle(frame, (width // 2, height // 2), 50, line_color, 2)

        # Goal A (left) and Goal B (right)
        cv2.rectangle(frame, (0, 140), (80, 340), (255, 255, 255), 2)
        cv2.rectangle(frame, (width - 80, 140), (width, 340), (255, 255, 255), 2)

        # Players:
        # Player 1 (Team A): dribbles near center then moves towards left goal
        p1_x = int(320 - min(f_idx * 1.5, 160))
        p1_y = 240
        draw_player(frame, p1_x, p1_y, team_a_color, "A1")

        # Player 2 (Team A): supporter
        draw_player(frame, 240, 160, team_a_color, "A2")

        # Player 3 (Team B): defender
        draw_player(frame, 150, 230, team_b_color, "B1")

        # Player 4 (Team B): goalkeeper / defender
        draw_player(frame, 90, 240, team_b_color, "B2")

        # Ball trajectory:
        # 0 to 60 frames (2s): ball is at p1 feet (near 320, 260 moving with p1)
        # 60 to 120 frames (2s): kicked towards Goal A (x goes from 230 down to 45 inside Goal A)
        # 120 to 210 frames (3s): ball rests inside Goal A at (45, 240)
        if f_idx < 60:
            bx = p1_x - 15
            by = p1_y + 15
        elif f_idx < 110:
            frac = (f_idx - 60) / 50.0
            bx = int(round((p1_x - 15) * (1 - frac) + 45 * frac))
            by = int(round((p1_y + 15) * (1 - frac) + 240 * frac))
        else:
            bx = 45
            by = 240

        # Draw ball with sports ball shading
        cv2.circle(frame, (bx, by), 9, ball_color, -1)
        cv2.circle(frame, (bx, by), 9, (20, 20, 20), 1)
        cv2.circle(frame, (bx, by), 3, (255, 255, 255), -1)

        out.write(frame)

    out.release()
    print(f"Generated synthetic football clip: {output_path} ({total_frames} frames)")


if __name__ == "__main__":
    clips_dir = Path(__file__).resolve().parent
    generate_balloon_clip(clips_dir / "balloon_sample.mp4")
    generate_football_clip(clips_dir / "football_sample.mp4")

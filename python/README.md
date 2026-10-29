# Majlis Judge - Video Referee & Rule Enforcement Engine

**Person C Deliverable | ADU Hackathon 2026**

Majlis Judge is a lightweight, edge-compatible video referee designed to process recorded game footage, enforce formal family game rules, and generate cryptographically signed HMAC-SHA256 reports that can be verified by the Aqaarib Kinship web app.

---

## ⚡ Supported Games

1. **Football (`football`)**
   - Object tracking with **YOLOv8n + ByteTrack** (COCO class 0 `person` and class 32 `sports ball`).
   - Jersey color extraction via torso sampling and 2-cluster **KMeans** to partition players into Team A and Team B.
   - Ball interpolation across brief occlusions ($\le 10$ frames) and automatic fallback to **ColorTracker** when ball visibility drops below 40%.
   - **Possession judging**: nearest player within $0.8 \times \text{bbox height}$, confirmed across 3 consecutive frames.
   - **Goal judging**: ball inside goal box for 3 consecutive frames after $\ge 1.0$s outside, with a 4.0s cooldown.
   - Match statistics: possession percentages, seconds per player, and MVP selection with tie-breakers.

2. **Balloon Keep-Up (`balloon`)**
   - **Color clearance check**: inspects opening frames and halts with a plain warning if background or clothing matches the balloon color.
   - **Inflection-based hit detection**: registers a hit when balloon vertical motion transitions from falling ($dy > 0$) to rising ($dy < 0$), debounced to $\ge 0.25$s.
   - **Apex evaluation**: validates whether the balloon clears the target height line (`--target-y`); faults penalized if missed.
   - **Ground contact termination**: ends the round immediately when balloon hits the floor line (`--ground-y`) or disappears near it for $> 1.0$s.
   - **Scoring**: $\text{air seconds} + 1 \times \text{valid hits} - 1 \times \text{faults}$.

---

## 🚀 Setup & Installation

Majlis Judge runs on Python 3.10, 3.11, or 3.12 on both **macOS** and **Windows** (CPU-only friendly for 1–2 minute clips).

### macOS / Linux (bash / zsh)

```bash
# Navigate to the python directory
cd python

# Create and activate a Python 3.10-3.12 virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install required dependencies
pip install -r requirements.txt
```

### Windows (PowerShell)

```powershell
# Navigate to the python directory
cd python

# Create and activate a virtual environment
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install required dependencies
pip install -r requirements.txt
```

---

## 🎮 Command Usage

All commands can be invoked via `python cli.py` (or `python -m majlis_judge.cli`).

### 1. Interactive Frame & HSV Picker (`pick`)

Opens the first frame of any video clip. Left-click to inspect pixel coordinates and HSV color bounds; click and drag to view rectangle corner coordinates.

```bash
# macOS / Linux
python cli.py pick test_clips/balloon_sample.mp4

# Windows
python cli.py pick test_clips\balloon_sample.mp4
```

---

### 2. Football Match Referee (`football`)

Judges a match video given goal coordinates for Team A and Team B. Automatically detects players, separates teams, tracks possession, awards goals, and outputs a signed report.

```bash
# macOS / Linux (Pixel coordinates or normalized coordinates 0.0-1.0)
python cli.py football test_clips/football_sample.mp4 \
  --goal-a 0,140,80,340 \
  --goal-b 560,140,640,340 \
  --key "my_secret_key" \
  --out football_report.json

# Windows (PowerShell)
python cli.py football test_clips\football_sample.mp4 `
  --goal-a 0,140,80,340 `
  --goal-b 560,140,640,340 `
  --key "my_secret_key" `
  --out football_report.json
```

**Optional flags:**
- `--swap-teams`: Flips Team A and Team B labels if KMeans inverted jersey cluster assignments.
- `--ball-hsv H_low,S_low,V_low,H_hi,S_hi,V_hi`: Custom HSV bounds for ColorTracker fallback.
- `--stride N`: Process every $N$-th frame (default `2` for fast CPU execution).

---

### 3. Balloon Keep-Up Referee (`balloon`)

Verifies color clearance, tracks balloon trajectory, scores hits/faults, and terminates on ground contact.

```bash
# macOS / Linux
python cli.py balloon test_clips/balloon_sample.mp4 \
  --team A \
  --hsv-lower 45,100,100 \
  --hsv-upper 75,255,255 \
  --ground-y 0.90 \
  --target-y 0.35 \
  --key "my_secret_key" \
  --out balloon_report.json

# Windows (PowerShell)
python cli.py balloon test_clips\balloon_sample.mp4 `
  --team A `
  --hsv-lower 45,100,100 `
  --hsv-upper 75,255,255 `
  --ground-y 0.90 `
  --target-y 0.35 `
  --key "my_secret_key" `
  --out balloon_report.json
```

---

### 4. Cryptographic Report Verification (`verify`)

Verifies that the HMAC-SHA256 signature matches the payload and that the report satisfies the frozen contract schema.

```bash
# macOS / Linux
python cli.py verify balloon_report.json --key "my_secret_key"

# Windows
python cli.py verify balloon_report.json --key "my_secret_key"
```

---

### 5. Anti-Cheat Tamper Demonstration (`tamper`)

Creates an edited copy with modified scores but retains the original HMAC signature to demonstrate verification failure.

```bash
# macOS / Linux
python cli.py tamper balloon_report.json --out balloon_tampered.json
python cli.py verify balloon_tampered.json --key "my_secret_key"
# (Output will show: ❌ REPORT VERIFICATION FAILED: HMAC signature mismatch)

# Windows
python cli.py tamper balloon_report.json --out balloon_tampered.json
python cli.py verify balloon_tampered.json --key "my_secret_key"
```

---

### 🔑 Environment Variable Support (`MAJLIS_KEY`)

Instead of passing `--key` in every command, you can set the `MAJLIS_KEY` environment variable:

```bash
# macOS / Linux
export MAJLIS_KEY="my_secret_key"
python cli.py verify balloon_report.json

# Windows (PowerShell)
$env:MAJLIS_KEY="my_secret_key"
python cli.py verify balloon_report.json
```

---

## 🧪 Running Tests & Synthetic Clips

### Run Unit Tests
```bash
# Runs all 14 unit tests across common, football, and balloon engines
pytest tests
```

### Generate Synthetic Test Clips
```bash
# Generates balloon_sample.mp4 and football_sample.mp4 for testing
python test_clips/generate_test_clips.py
```

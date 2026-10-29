# Test Fixtures & Signed Match Reports

This directory contains verified sample test fixtures for the Family AI Game Day match verification system.

## Available Fixtures

1. **`balloon_signed_report.json`**
   - Game: Balloon Keep-Up (`balloon`)
   - Secret Key: `referee-secret-2026`
   - Verification Status: Valid Authentic Signature
   - Includes full rulings, player volleys, and photographic evidence snapshots.

2. **`football_signed_report.json`**
   - Game: Football Penalty Shootout (`football`)
   - Secret Key: `referee-secret-2026`
   - Verification Status: Valid Authentic Signature
   - Includes goal line crosses, goalkeeper saves, and photographic evidence snapshots.

3. **`tampered_signed_report.json`**
   - Verification Status: Tampered / Refused
   - The payload string was modified after signature generation to prove that the referee system refuses altered match reports with a clear explanation: *"The report signature is invalid. The file was changed or the key was incorrect."*

## Generating New Signed Fixtures

Use the offline Python judge in `/python/judge.py`:

```bash
# Create a signed balloon match report
python3 python/judge.py create --game balloon --key YOUR_SECRET_KEY --output fixtures/balloon_signed_report.json

# Verify any report file from terminal
python3 python/judge.py verify fixtures/balloon_signed_report.json --key YOUR_SECRET_KEY
```

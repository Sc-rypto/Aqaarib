#!/usr/bin/env python3
"""CLI wrapper entry point for Majlis Judge."""

import sys
from pathlib import Path

# Add directory to sys.path so majlis_judge can be imported whether called from python/ or project root
current_dir = Path(__file__).resolve().parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))

from majlis_judge.cli import main

if __name__ == "__main__":
    main()

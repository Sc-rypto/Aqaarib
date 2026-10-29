#!/usr/bin/env python3
"""Compatibility wrapper pointing to Majlis Judge CLI."""

import sys
from pathlib import Path

current_dir = Path(__file__).resolve().parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))

from majlis_judge.cli import main

if __name__ == "__main__":
    main()

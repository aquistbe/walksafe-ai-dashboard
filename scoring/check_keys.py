#!/usr/bin/env python3
"""Diagnose API key setup without printing the keys themselves.

Reports, for each required key, whether it is present in the shell
environment and in scoring/.env, how long it is, and which value the
scorer would actually use.

    python check_keys.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE / ".env"
REQUIRED = ["GEMINI_API_KEY", "GOOGLE_MAPS_API_KEY"]


def mask(v: str) -> str:
    if not v:
        return "(empty)"
    if len(v) <= 8:
        return repr(v)
    return f"{v[:4]}...{v[-2:]}"


def looks_like_placeholder(val: str) -> bool:
    v = (val or "").strip()
    return not v or v.strip(".") == "" or len(v) < 20


def parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    for i, line in enumerate(text.splitlines(), 1):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if "=" not in s:
            print(f"    ! line {i} has no '=': {s[:50]!r}")
            continue
        k, _, v = s.partition("=")
        k = k.strip()
        v = v.strip()
        # Smart quotes are the classic GUI-editor failure.
        for bad, name in (("“", "left curly quote"), ("”", "right curly quote"),
                          ("‘", "left curly apostrophe"), ("’", "right curly apostrophe")):
            if bad in v:
                print(f"    ! line {i} contains a {name} — retype it in a plain text editor")
        v = v.strip("'\"")
        out[k] = v
    return out


def main() -> int:
    print()
    print("=" * 60)
    print("API KEY DIAGNOSTIC")
    print("=" * 60)

    print(f"\n.env file: {ENV_FILE}")
    if ENV_FILE.exists():
        print(f"  exists, {ENV_FILE.stat().st_size} bytes")
    else:
        print("  DOES NOT EXIST")
    file_vals = parse_env_file(ENV_FILE)

    all_ok = True

    for name in REQUIRED:
        shell_val = os.environ.get(name, "")
        file_val = file_vals.get(name, "")

        print(f"\n{name}")
        print(f"  shell env : {mask(shell_val):<14} len={len(shell_val)}")
        print(f"  .env file : {mask(file_val):<14} len={len(file_val)}")

        # Same resolution order the scorer uses.
        if not looks_like_placeholder(shell_val):
            effective, source = shell_val, "shell environment"
        elif not looks_like_placeholder(file_val):
            effective, source = file_val, ".env file"
        else:
            effective, source = "", None

        if source:
            print(f"  -> WILL USE {mask(effective)} from {source}")
            if not effective.startswith("AIza"):
                print("     note: Google API keys normally start with 'AIza'")
        else:
            all_ok = False
            print("  -> NO USABLE KEY FOUND")
            if shell_val and looks_like_placeholder(shell_val):
                print(f"     shell value is a placeholder; run:  unset {name}")
            if not file_val:
                print(f"     .env has no value for {name}")

    print()
    print("=" * 60)
    if all_ok:
        print("OK - both keys resolve. Try:")
        print("  python score_intersections.py --limit 5")
    else:
        print("NOT READY. Easiest fix - edit scoring/.env and put your keys there:")
        print()
        print("  GEMINI_API_KEY=AIza...")
        print("  GOOGLE_MAPS_API_KEY=AIza...")
        print()
        print("No quotes, no spaces around '='. Then clear any stale shell values:")
        print(f"  unset {' '.join(REQUIRED)}")
    print("=" * 60)
    print()
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "src"))

from crypto_research.evaluation import rank_existing


def main() -> int:
    path = REPO_ROOT / "reports" / "strategy_evaluation.json"
    if not path.exists():
        print("Run `python -m crypto_research.cli backtest` first.", file=sys.stderr)
        return 2
    print(json.dumps(rank_existing(path), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

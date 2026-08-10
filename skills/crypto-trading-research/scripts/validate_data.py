#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "src"))

from crypto_research.config import load_settings
from crypto_research.validation import validate_cached_bundle


def main() -> int:
    settings = load_settings(REPO_ROOT)
    provider = settings.provider
    exchange_slug = "binance-spot" if provider == "binance" else "kraken-spot"
    report = validate_cached_bundle(settings.data_dir, exchange_slug, settings.universe, settings.timeframes)
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["overall_status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())

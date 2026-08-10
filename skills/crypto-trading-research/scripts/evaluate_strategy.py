#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "src"))

from crypto_research.config import load_settings
from crypto_research.evaluation import evaluate_candidate
from crypto_research.market_data import read_ohlcv_cache
from crypto_research.strategies import strategy_by_name
from crypto_research.validation import require_valid, validate_ohlcv


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strategy", required=True)
    parser.add_argument("--symbol", required=True, choices=["BTC/USDT", "ETH/USDT", "SOL/USDT"])
    parser.add_argument("--timeframe", required=True, choices=["15m", "1h", "4h", "1d"])
    args = parser.parse_args()
    settings = load_settings(REPO_ROOT)
    exchange_slug = "binance-spot" if settings.provider == "binance" else "kraken-spot"
    frame, _ = read_ohlcv_cache(settings.data_dir, exchange_slug, args.symbol, args.timeframe)
    require_valid(validate_ohlcv(frame, args.symbol, args.timeframe))
    fx = json.loads((settings.data_dir / "market" / "fx_eurusdt.json").read_text(encoding="utf-8"))
    result = evaluate_candidate(
        frame, strategy_by_name(args.strategy), symbol=args.symbol, timeframe=args.timeframe,
        settings=settings, usdt_per_eur=float(fx["usdt_per_eur"]),
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

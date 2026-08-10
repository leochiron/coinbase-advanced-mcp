from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .analysis import analyze_current_market
from .config import Settings, load_settings
from .evaluation import evaluate_all
from .market_data import fetch_and_cache_bundle
from .models import TradingCosts
from .portfolio import PaperPortfolio
from .validation import validate_cached_bundle


def _exchange_slug(provider: str) -> str:
    return "binance-spot" if provider == "binance" else "kraken-spot"


def _print(payload: Any) -> None:
    print(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False))


def _fetch(settings: Settings, provider: str) -> dict[str, Any]:
    return fetch_and_cache_bundle(
        settings.data_dir, provider, settings.universe, settings.timeframes, settings.bars_by_timeframe
    )


def _portfolio(settings: Settings) -> PaperPortfolio:
    root = settings.data_dir / "paper-portfolio"
    return PaperPortfolio(root / "portfolio.json", root / "ledger.jsonl", settings.risk)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="crypto-research",
        description="Public-data crypto research and paper-decision system. Live trading is not implemented.",
    )
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    sub = parser.add_subparsers(dest="command", required=True)

    fetch = sub.add_parser("fetch", help="Fetch and cache public/read-only market data")
    fetch.add_argument("--provider", choices=["binance", "kraken"], default=None)

    validate = sub.add_parser("validate", help="Validate every cached OHLCV dataset")
    validate.add_argument("--provider", choices=["binance", "kraken"], default=None)

    backtest = sub.add_parser("backtest", help="Run baselines, OOS tests, robustness, and ranking")
    backtest.add_argument("--provider", choices=["binance", "kraken"], default=None)

    analyze = sub.add_parser("analyze", help="Analyze current BTC, ETH, and SOL conditions")
    analyze.add_argument("--provider", choices=["binance", "kraken"], default=None)

    run_all = sub.add_parser("run-all", help="Fetch, validate, backtest, and produce the current decision")
    run_all.add_argument("--provider", choices=["binance", "kraken"], default=None)
    run_all.add_argument("--no-fallback", action="store_true", help="Do not try the alternate public provider")

    paper = sub.add_parser("paper", help="Inspect or create paper-only proposals")
    paper_sub = paper.add_subparsers(dest="paper_command", required=True)
    paper_sub.add_parser("show")
    init = paper_sub.add_parser("init")
    init.add_argument("--capital-eur", type=float, default=1000.0)
    propose = paper_sub.add_parser("propose-long")
    propose.add_argument("--symbol", required=True, choices=["BTC/USDT", "ETH/USDT", "SOL/USDT"])
    propose.add_argument("--entry", type=float, required=True)
    propose.add_argument("--stop", type=float, required=True)
    propose.add_argument("--usdt-per-eur", type=float, required=True)
    propose.add_argument("--strategy", required=True)
    simulated_open = paper_sub.add_parser("simulate-open-long")
    simulated_open.add_argument("--symbol", required=True, choices=["BTC/USDT", "ETH/USDT", "SOL/USDT"])
    simulated_open.add_argument("--entry", type=float, required=True)
    simulated_open.add_argument("--stop", type=float, required=True)
    simulated_open.add_argument("--usdt-per-eur", type=float, required=True)
    simulated_open.add_argument("--strategy", required=True)
    simulated_open.add_argument("--timestamp", required=True)
    simulated_close = paper_sub.add_parser("simulate-close-long")
    simulated_close.add_argument("--position-id", required=True)
    simulated_close.add_argument("--exit", type=float, required=True)
    simulated_close.add_argument("--usdt-per-eur", type=float, required=True)
    simulated_close.add_argument("--timestamp", required=True)
    simulated_close.add_argument("--reason", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = load_settings(args.project_root)
    provider = getattr(args, "provider", None) or settings.provider

    try:
        if args.command == "fetch":
            _print(_fetch(settings, provider))
            return 0
        if args.command == "validate":
            report = validate_cached_bundle(settings.data_dir, _exchange_slug(provider), settings.universe, settings.timeframes)
            _print(report)
            return 0 if report["overall_status"] == "PASS" else 2
        if args.command == "backtest":
            report = evaluate_all(settings, _exchange_slug(provider))
            _print({
                "generated_at": report["generated_at"],
                "eligible_count": report["eligible_count"],
                "top_10": report["leaderboard"][:10],
            })
            return 0
        if args.command == "analyze":
            report = analyze_current_market(settings, _exchange_slug(provider))
            _print({"analysis_timestamp": report["analysis_timestamp"], "decision": report["decision"], "proposal": report["proposal"], "no_trade": report["no_trade"]})
            return 0
        if args.command == "run-all":
            selected = provider
            fetch_report = _fetch(settings, selected)
            expected_datasets = len(settings.universe) * len(settings.timeframes)
            if (fetch_report["errors"] or len(fetch_report["datasets"]) != expected_datasets) and not args.no_fallback:
                alternate = "kraken" if selected == "binance" else "binance"
                fallback = _fetch(settings, alternate)
                if not fallback["errors"] and len(fallback["datasets"]) == expected_datasets:
                    selected = alternate
                    fetch_report = fallback
            if fetch_report["errors"] or len(fetch_report["datasets"]) != expected_datasets:
                raise RuntimeError(f"Market-data retrieval incomplete: {fetch_report['errors']}")
            validation = validate_cached_bundle(settings.data_dir, _exchange_slug(selected), settings.universe, settings.timeframes)
            if validation["overall_status"] != "PASS":
                raise RuntimeError("Data validation failed; analysis stopped. See data/quality/latest_validation.json")
            evaluation = evaluate_all(settings, _exchange_slug(selected))
            analysis = analyze_current_market(settings, _exchange_slug(selected))
            _print({
                "provider": selected,
                "data_status": validation["overall_status"],
                "eligible_strategies": evaluation["eligible_count"],
                "decision": analysis["decision"],
                "analysis_timestamp": analysis["analysis_timestamp"],
                "market_report": str(settings.reports_dir / "MARKET_ANALYSIS.md"),
                "leaderboard": str(settings.reports_dir / "STRATEGY_LEADERBOARD.md"),
            })
            return 0
        if args.command == "paper":
            ledger = _portfolio(settings)
            if args.paper_command == "show":
                _print(ledger.load())
            elif args.paper_command == "init":
                _print(ledger.initialize(args.capital_eur))
            elif args.paper_command == "propose-long":
                _print(ledger.propose_long(
                    symbol=args.symbol, entry_usdt=args.entry, stop_usdt=args.stop,
                    usdt_per_eur=args.usdt_per_eur, strategy=args.strategy, costs=settings.costs,
                ))
            elif args.paper_command == "simulate-open-long":
                _print(ledger.simulate_open_long(
                    symbol=args.symbol, reference_price_usdt=args.entry, stop_usdt=args.stop,
                    usdt_per_eur=args.usdt_per_eur, strategy=args.strategy,
                    timestamp=args.timestamp, costs=settings.costs,
                ))
            elif args.paper_command == "simulate-close-long":
                _print(ledger.simulate_close_long(
                    position_id=args.position_id, reference_price_usdt=args.exit,
                    usdt_per_eur=args.usdt_per_eur, timestamp=args.timestamp,
                    reason=args.reason, costs=settings.costs,
                ))
            return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

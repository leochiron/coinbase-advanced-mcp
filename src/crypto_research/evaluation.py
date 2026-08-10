from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

import pandas as pd

from .backtest import (
    monte_carlo_trade_sequences,
    performance_by_entry_regime,
    run_chronological_splits,
    walk_forward_validation,
)
from .config import Settings
from .io_utils import append_jsonl, atomic_write_json, atomic_write_text, iso_utc
from .market_data import read_ohlcv_cache
from .strategies import STRATEGIES, StrategyDefinition, strategy_catalog
from .validation import require_valid, validate_ohlcv


def _metric_pass(result: dict[str, Any]) -> bool:
    return result["expectancy"] > 0 and result["profit_factor"] > 1.0 and result["trades"] > 0


def _score_candidate(
    test: dict[str, Any], robustness: dict[str, Any], preliminary_pass: bool
) -> tuple[float, list[str]]:
    penalties: list[str] = []
    parameter_ratio = robustness["parameter_sensitivity"]["pass_ratio"]
    walk_ratio = robustness["walk_forward"]["pass_ratio"]
    high_cost = robustness["cost_sensitivity"]["high"]
    delayed = robustness["delayed_entry"]
    monte = robustness["monte_carlo"]
    score = 0.0
    score += 15 * parameter_ratio
    score += 5 * walk_ratio
    score += 5 if _metric_pass(high_cost) else 0
    score += 3 if _metric_pass(delayed) else 0
    score += 2 if monte.get("return_p05") is not None and monte["return_p05"] >= 0 else 0
    score += min(max(test["profit_factor"] - 1, 0) / 1.0, 1) * 12
    score += 8 if test["expectancy"] > 0 else 0
    score += min(max(test["sharpe_ratio"], 0) / 2, 1) * 10
    score += max(0, 1 - test["max_drawdown"] / 0.10) * 15
    score += min(max(test["total_return"], 0) / 0.20, 1) * 5
    score += min(test["trades"] / 30, 1) * 10
    if test["trades"] < 8:
        score -= 15
        penalties.append("very_low_oos_trade_count")
    if parameter_ratio < 0.60:
        score -= 12
        penalties.append("parameter_sensitivity")
    if test["max_drawdown"] > 0.10:
        score -= 20
        penalties.append("excessive_drawdown")
    if not _metric_pass(high_cost):
        score -= 8
        penalties.append("cost_fragility")
    if test["market_exposure"] > 0.70:
        score -= 5
        penalties.append("excessive_market_exposure")
    if not preliminary_pass:
        score = min(score, 49.0)
    return round(max(0.0, min(100.0, score)), 2), penalties


def evaluate_candidate(
    frame: pd.DataFrame,
    strategy: StrategyDefinition,
    *,
    symbol: str,
    timeframe: str,
    settings: Settings,
    usdt_per_eur: float,
) -> dict[str, Any]:
    base = run_chronological_splits(
        frame, strategy, symbol=symbol, timeframe=timeframe,
        initial_capital_eur=settings.initial_capital_eur, usdt_per_eur=usdt_per_eur,
        costs=settings.costs, policy=settings.risk,
    )
    sensitivity_results: list[dict[str, Any]] = []
    for variant in strategy.sensitivity_variants:
        result = run_chronological_splits(
            frame, strategy, symbol=symbol, timeframe=timeframe,
            initial_capital_eur=settings.initial_capital_eur, usdt_per_eur=usdt_per_eur,
            costs=settings.costs, policy=settings.risk, params=variant,
        )["test"]
        sensitivity_results.append({"parameters": variant, "metrics": result.to_dict(), "pass": result.expectancy > 0 and result.profit_factor > 1})
    parameter_pass_ratio = (
        sum(item["pass"] for item in sensitivity_results) / len(sensitivity_results)
        if sensitivity_results else 0.0
    )
    high = run_chronological_splits(
        frame, strategy, symbol=symbol, timeframe=timeframe,
        initial_capital_eur=settings.initial_capital_eur, usdt_per_eur=usdt_per_eur,
        costs=settings.high_costs, policy=settings.risk,
    )["test"]
    severe = run_chronological_splits(
        frame, strategy, symbol=symbol, timeframe=timeframe,
        initial_capital_eur=settings.initial_capital_eur, usdt_per_eur=usdt_per_eur,
        costs=settings.severe_costs, policy=settings.risk,
    )["test"]
    delayed = run_chronological_splits(
        frame, strategy, symbol=symbol, timeframe=timeframe,
        initial_capital_eur=settings.initial_capital_eur, usdt_per_eur=usdt_per_eur,
        costs=settings.costs, policy=settings.risk, delayed_entry_bars=1,
    )["test"]
    walk_forward = walk_forward_validation(
        frame, strategy, symbol=symbol, timeframe=timeframe,
        initial_capital_eur=settings.initial_capital_eur, usdt_per_eur=usdt_per_eur,
        costs=settings.costs, policy=settings.risk,
    )
    test = base["test"]
    robustness = {
        "parameter_sensitivity": {"pass_ratio": parameter_pass_ratio, "variants": sensitivity_results},
        "cost_sensitivity": {"base": test.to_dict(), "high": high.to_dict(), "severe": severe.to_dict()},
        "delayed_entry": delayed.to_dict(),
        "monte_carlo": monte_carlo_trade_sequences(test.trade_log, settings.initial_capital_eur),
        "walk_forward": walk_forward,
        "market_regimes": performance_by_entry_regime(test.trade_log),
    }
    gate = settings.acceptance
    checks = {
        "positive_oos_expectancy": test.expectancy > gate["minimum_oos_expectancy_eur"],
        "oos_profit_factor": test.profit_factor > gate["minimum_oos_profit_factor"],
        "adequate_oos_trades": test.trades >= int(gate["minimum_oos_trades"]),
        "acceptable_oos_drawdown": test.max_drawdown <= gate["maximum_oos_drawdown"],
        "parameter_robustness": parameter_pass_ratio >= gate["minimum_parameter_pass_ratio"],
        "walk_forward_robustness": walk_forward["pass_ratio"] >= gate["minimum_walk_forward_pass_ratio"],
        "high_cost_survival": high.profit_factor >= gate["minimum_high_cost_profit_factor"] and high.expectancy > 0,
        "validation_positive": base["validation"].expectancy > 0 and base["validation"].profit_factor > 1.0,
    }
    preliminary_pass = all(checks.values())
    score, penalties = _score_candidate(test.to_dict(), robustness, preliminary_pass)
    return {
        "strategy": strategy.name,
        "strategy_version": strategy.version,
        "style": strategy.style,
        "symbol": symbol,
        "timeframe": timeframe,
        "parameters": strategy.default_params,
        "splits": {name: result.to_dict() for name, result in base.items()},
        "robustness": robustness,
        "gate_checks": checks,
        "preliminary_pass": preliminary_pass,
        "eligible": False,
        "score": score,
        "penalties": penalties,
        "rejection_reasons": [name for name, passed in checks.items() if not passed],
    }


def _apply_asset_robustness(candidates: list[dict[str, Any]]) -> None:
    for strategy in STRATEGIES:
        family = [item for item in candidates if item["strategy"] == strategy.name]
        passing_assets = sorted({item["symbol"] for item in family if item["preliminary_pass"]})
        passing_timeframes = sorted({item["timeframe"] for item in family if item["preliminary_pass"]})
        family_robust = len(passing_assets) >= 2
        for item in family:
            item["asset_robustness"] = {
                "passing_assets": passing_assets,
                "passing_timeframes": passing_timeframes,
                "minimum_assets_required": 2,
                "pass": family_robust,
            }
            item["eligible"] = bool(item["preliminary_pass"] and family_robust)
            if not family_robust:
                item["score"] = round(max(0.0, item["score"] - 10), 2)
                item["penalties"].append("single_asset_dependency")
                item["rejection_reasons"].append("asset_robustness")
            if len(passing_timeframes) < 2:
                item["score"] = round(max(0.0, item["score"] - 5), 2)
                item["penalties"].append("single_timeframe_dependency")


def _leaderboard_rows(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in sorted(candidates, key=lambda candidate: candidate["score"], reverse=True):
        test = item["splits"]["test"]
        rows.append({
            "rank": len(rows) + 1,
            "strategy": item["strategy"],
            "symbol": item["symbol"],
            "timeframe": item["timeframe"],
            "score": item["score"],
            "eligible": item["eligible"],
            "oos_return_pct": round(test["total_return"] * 100, 3),
            "oos_sharpe": round(test["sharpe_ratio"], 3),
            "oos_max_drawdown_pct": round(test["max_drawdown"] * 100, 3),
            "oos_profit_factor": round(test["profit_factor"], 3),
            "oos_expectancy_eur": round(test["expectancy"], 4),
            "oos_trades": test["trades"],
            "parameter_pass_ratio": round(item["robustness"]["parameter_sensitivity"]["pass_ratio"], 3),
            "walk_forward_pass_ratio": round(item["robustness"]["walk_forward"]["pass_ratio"], 3),
            "rejection_reasons": ",".join(sorted(set(item["rejection_reasons"]))),
        })
    return rows


def _leaderboard_markdown(rows: list[dict[str, Any]], generated_at: str) -> str:
    lines = [
        "# Strategy Leaderboard",
        "",
        f"Generated: {generated_at}",
        "",
        "All returns are out-of-sample, after base transaction costs. Eligibility also requires validation, sensitivity, walk-forward, high-cost, and at-least-two-assets gates.",
        "",
        "| Rank | Strategy | Asset | TF | Score | Eligible | OOS return | PF | Sharpe | MDD | Trades |",
        "|---:|---|---|---:|---:|:---:|---:|---:|---:|---:|---:|",
    ]
    for row in rows[:30]:
        lines.append(
            f"| {row['rank']} | {row['strategy']} | {row['symbol']} | {row['timeframe']} | "
            f"{row['score']:.2f} | {'YES' if row['eligible'] else 'NO'} | {row['oos_return_pct']:.2f}% | "
            f"{row['oos_profit_factor']:.2f} | {row['oos_sharpe']:.2f} | "
            f"{row['oos_max_drawdown_pct']:.2f}% | {row['oos_trades']} |"
        )
    lines.extend(["", "Acceptance thresholds were declared in `config/research.json` before results were generated.", ""])
    return "\n".join(lines)


def evaluate_all(settings: Settings, exchange_slug: str = "binance-spot") -> dict[str, Any]:
    fx_path = settings.data_dir / "market" / "fx_eurusdt.json"
    if not fx_path.exists():
        raise FileNotFoundError("Missing EUR/USDT conversion data; fetch market data before backtesting")
    fx = json.loads(fx_path.read_text(encoding="utf-8"))
    usdt_per_eur = float(fx["usdt_per_eur"])
    if usdt_per_eur <= 0:
        raise ValueError("Invalid EUR/USDT conversion")
    generated_at = iso_utc()
    candidates: list[dict[str, Any]] = []
    journal_path = settings.data_dir / "research" / "experiments.jsonl"
    for symbol in settings.universe:
        for timeframe in settings.timeframes:
            frame, metadata = read_ohlcv_cache(settings.data_dir, exchange_slug, symbol, timeframe)
            quality = validate_ohlcv(frame, symbol, timeframe)
            require_valid(quality)
            for strategy in STRATEGIES:
                candidate = evaluate_candidate(
                    frame, strategy, symbol=symbol, timeframe=timeframe,
                    settings=settings, usdt_per_eur=usdt_per_eur,
                )
                candidates.append(candidate)
                append_jsonl(journal_path, {
                    "timestamp": generated_at,
                    "event": "BASELINE_STRATEGY_EXPERIMENT",
                    "hypothesis": strategy.hypothesis,
                    "strategy": strategy.name,
                    "strategy_version": strategy.version,
                    "parameters": strategy.default_params,
                    "data": {
                        "source": metadata["source"], "exchange": metadata["exchange"],
                        "symbol": symbol, "timeframe": timeframe,
                        "first": quality.first_timestamp, "last": quality.latest_closed_candle,
                        "cache_sha256": metadata["csv_sha256"],
                    },
                    "result": candidate["splits"],
                    "decision": "PRELIMINARY_PASS" if candidate["preliminary_pass"] else "REJECT",
                    "rejection_reasons": candidate["rejection_reasons"],
                })
    _apply_asset_robustness(candidates)
    rows = _leaderboard_rows(candidates)
    report = {
        "generated_at": generated_at,
        "mode": "PAPER_ANALYSIS_ONLY",
        "fx": fx,
        "costs": {
            "base": settings.costs.to_dict(),
            "high": settings.high_costs.to_dict(),
            "severe": settings.severe_costs.to_dict(),
        },
        "acceptance_gate": settings.acceptance,
        "strategy_catalog": strategy_catalog(),
        "eligible_count": sum(item["eligible"] for item in candidates),
        "leaderboard": rows,
        "candidates": candidates,
    }
    atomic_write_json(settings.reports_dir / "strategy_evaluation.json", report)
    atomic_write_json(settings.reports_dir / "leaderboard.json", {"generated_at": generated_at, "rows": rows})
    atomic_write_text(settings.reports_dir / "leaderboard.csv", pd.DataFrame(rows).to_csv(index=False, lineterminator="\n"))
    atomic_write_text(settings.reports_dir / "STRATEGY_LEADERBOARD.md", _leaderboard_markdown(rows, generated_at))
    return report


def rank_existing(report_path: Path) -> list[dict[str, Any]]:
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    candidates = payload.get("candidates", [])
    if candidates and not all("asset_robustness" in candidate for candidate in candidates):
        _apply_asset_robustness(candidates)
    return _leaderboard_rows(candidates)

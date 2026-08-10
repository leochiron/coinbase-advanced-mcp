from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .config import Settings
from .indicators import add_indicators
from .io_utils import atomic_write_json, atomic_write_text, iso_utc
from .market_data import read_ohlcv_cache
from .regime import classify_regime
from .risk import calculate_position_size
from .strategies import strategy_by_name
from .validation import require_valid, validate_ohlcv

TOP_DOWN = ("1d", "4h", "1h", "15m")


def _load_snapshot(data_dir: Path, symbol: str) -> dict[str, Any] | None:
    path = data_dir / "market" / "snapshots" / f"{symbol.replace('/', '')}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def _cross_asset(frames: dict[str, pd.DataFrame]) -> dict[str, Any]:
    closes = pd.concat({symbol: frame["close"] for symbol, frame in frames.items()}, axis=1).dropna()
    returns = closes.pct_change().dropna().tail(720)
    correlation = returns.corr().round(4).to_dict()
    assets: dict[str, Any] = {}
    for symbol, frame in frames.items():
        close = frame["close"].dropna()
        return_24h = close.iloc[-1] / close.iloc[-25] - 1 if len(close) >= 25 else np.nan
        return_7d = close.iloc[-1] / close.iloc[-169] - 1 if len(close) >= 169 else np.nan
        realized = returns[symbol].std(ddof=0) * np.sqrt(24 * 365.25) if symbol in returns else np.nan
        assets[symbol] = {
            "return_24h": float(return_24h),
            "return_7d": float(return_7d),
            "annualized_1h_realized_volatility": float(realized),
        }
    strength_order = sorted(assets, key=lambda symbol: assets[symbol]["return_7d"], reverse=True)
    return {
        "correlation_1h_last_720_bars": correlation,
        "relative_strength_order_7d": strength_order,
        "assets": assets,
        "portfolio_note": "BTC, ETH, and SOL exposure is treated as correlated crypto beta; simultaneous signals do not create independent risk budgets.",
    }


def _compatible(strategy_style: str, daily_trend: str, four_hour_trend: str) -> bool:
    if daily_trend in {"strong bearish", "bearish"}:
        return False
    if strategy_style in {"trend", "momentum", "breakout", "trend-pullback"}:
        return four_hour_trend in {"bullish", "strong bullish"}
    return four_hour_trend in {"neutral", "bullish"}


def _match_validated_strategies(
    *,
    symbol: str,
    frames: dict[str, pd.DataFrame],
    regimes: dict[str, dict[str, Any]],
    evaluation: dict[str, Any],
) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    candidates = [
        candidate for candidate in evaluation.get("candidates", [])
        if candidate.get("eligible") and candidate["symbol"] == symbol and candidate["timeframe"] in {"1h", "4h"}
    ]
    for candidate in candidates:
        strategy = strategy_by_name(candidate["strategy"])
        timeframe = candidate["timeframe"]
        compatible = _compatible(strategy.style, regimes["1d"]["trend"], regimes["4h"]["trend"])
        signals = strategy.signals(frames[timeframe][["open", "high", "low", "close", "volume"]])
        current_signal = bool(signals.entry.iloc[-1])
        matches.append({
            "strategy": strategy.name,
            "timeframe": timeframe,
            "score": candidate["score"],
            "regime_compatible": compatible,
            "current_entry_signal": current_signal,
            "signal_candle": frames[timeframe].index[-1].isoformat(),
            "candidate": candidate,
            "stop_atr_multiple": signals.stop_atr_multiple,
            "take_profit_r": signals.take_profit_r,
        })
    return matches


def _make_proposal(
    match: dict[str, Any],
    symbol: str,
    frames: dict[str, pd.DataFrame],
    regimes: dict[str, dict[str, Any]],
    settings: Settings,
    fx: dict[str, Any],
) -> dict[str, Any]:
    timeframe = match["timeframe"]
    enriched = add_indicators(frames[timeframe])
    current_price = float(frames["15m"]["close"].iloc[-1])
    atr_value = float(enriched["atr_14"].iloc[-1])
    stop = current_price - atr_value * match["stop_atr_multiple"]
    risk_distance = current_price - stop
    tp1 = current_price + 2 * risk_distance
    tp2 = current_price + match["take_profit_r"] * risk_distance
    size = calculate_position_size(
        equity_eur=settings.initial_capital_eur,
        entry_usdt=current_price,
        stop_usdt=stop,
        usdt_per_eur=float(fx["usdt_per_eur"]),
        available_cash_eur=settings.initial_capital_eur,
        policy=settings.risk,
        costs=settings.costs,
    )
    score = float(match["score"])
    aligned = regimes["1d"]["trend"] in {"bullish", "strong bullish"} and regimes["4h"]["trend"] in {"bullish", "strong bullish"}
    confidence = "HIGH" if score >= 75 and aligned else "MEDIUM" if score >= 60 else "LOW"
    test = match["candidate"]["splits"]["test"]
    return {
        "status": "WAITING FOR ENTRY",
        "asset": symbol,
        "direction": "LONG",
        "strategy": match["strategy"],
        "confidence": confidence,
        "current_price_usdt": current_price,
        "entry_zone_usdt": [current_price - 0.15 * atr_value, current_price + 0.10 * atr_value],
        "stop_loss_usdt": stop,
        "take_profit_1_usdt": tp1,
        "take_profit_2_usdt": tp2,
        "risk_reward_tp1": 2.0,
        "risk_reward_tp2": match["take_profit_r"],
        "portfolio_equity_eur": settings.initial_capital_eur,
        "risk_percentage": settings.risk.risk_per_trade,
        "maximum_risk_eur": size.risk_amount_eur,
        "position_size_units": size.units,
        "position_value_eur": size.position_value_eur,
        "estimated_loss_at_stop_eur": size.estimated_loss_at_stop_eur,
        "binding_constraint": size.binding_constraint,
        "timeframe": timeframe,
        "market_regime": regimes["4h"],
        "entry_condition": strategy_by_name(match["strategy"]).entry_rule,
        "invalidation_condition": strategy_by_name(match["strategy"]).invalidation_rule,
        "why_this_trade": strategy_by_name(match["strategy"]).hypothesis,
        "why_strategy_fits": "Daily and 4H direction pass the strategy's predeclared regime filter and the latest closed signal candle satisfies the exact entry rule.",
        "historical_out_of_sample_results": test,
        "main_risks": [
            strategy_by_name(match["strategy"]).expected_failure_mode,
            "BTC, ETH, and SOL correlations can rise sharply during stress.",
            "Backtest sample size and non-stationarity limit confidence in future expectancy.",
        ],
        "sizing_allowed": size.allowed,
        "sizing_reasons": size.reasons,
        "mode": "PAPER_ANALYSIS_ONLY",
    }


def analyze_current_market(settings: Settings, exchange_slug: str = "binance-spot") -> dict[str, Any]:
    analysis_timestamp = iso_utc()
    fx_path = settings.data_dir / "market" / "fx_eurusdt.json"
    evaluation_path = settings.reports_dir / "strategy_evaluation.json"
    if not fx_path.exists() or not evaluation_path.exists():
        raise FileNotFoundError("Run market-data fetch and strategy evaluation before current analysis")
    fx = json.loads(fx_path.read_text(encoding="utf-8"))
    evaluation = json.loads(evaluation_path.read_text(encoding="utf-8"))
    asset_reports: dict[str, Any] = {}
    one_hour_frames: dict[str, pd.DataFrame] = {}
    all_matches: list[dict[str, Any]] = []

    for symbol in settings.universe:
        frames: dict[str, pd.DataFrame] = {}
        quality: dict[str, Any] = {}
        regimes: dict[str, dict[str, Any]] = {}
        sources: dict[str, Any] = {}
        for timeframe in settings.timeframes:
            frame, metadata = read_ohlcv_cache(settings.data_dir, exchange_slug, symbol, timeframe)
            result = validate_ohlcv(frame, symbol, timeframe)
            require_valid(result)
            frames[timeframe] = frame
            quality[timeframe] = result.to_dict()
            regimes[timeframe] = classify_regime(frame)
            sources[timeframe] = {
                "source": metadata["source"], "exchange": metadata["exchange"],
                "retrieved_at": metadata["retrieved_at"], "cache_sha256": metadata["csv_sha256"],
            }
        one_hour_frames[symbol] = frames["1h"]
        matches = _match_validated_strategies(
            symbol=symbol, frames=frames, regimes=regimes, evaluation=evaluation,
        )
        all_matches.extend({"symbol": symbol, **match, "frames": frames, "regimes": regimes} for match in matches)
        asset_reports[symbol] = {
            "step_1_data_quality": {
                "status": "PASS",
                "exchange": sources["1h"]["exchange"],
                "timeframes": list(TOP_DOWN),
                "latest_closed_candles": {tf: quality[tf]["latest_closed_candle"] for tf in TOP_DOWN},
                "datasets": quality,
                "sources": sources,
            },
            "step_2_daily_structure": regimes["1d"],
            "step_3_4h_structure": regimes["4h"],
            "step_4_1h_setups": regimes["1h"],
            "step_5_15m_entry_refinement": regimes["15m"],
            "step_6_regime": {
                "trend": regimes["4h"]["trend"],
                "volatility": regimes["4h"]["volatility"],
                "momentum": regimes["4h"]["momentum"],
                "structure": regimes["4h"]["structure"],
            },
            "step_7_strategy_matching": matches,
            "microstructure": _load_snapshot(settings.data_dir, symbol),
        }

    cross_asset = _cross_asset(one_hour_frames)
    triggered = [match for match in all_matches if match["regime_compatible"] and match["current_entry_signal"]]
    triggered.sort(key=lambda item: item["score"], reverse=True)
    eligible_count = int(evaluation.get("eligible_count", 0))
    proposal: dict[str, Any] | None = None
    if triggered:
        best = triggered[0]
        proposal = _make_proposal(
            best, best["symbol"], best["frames"], best["regimes"], settings, fx,
        )
        decision = "LONG" if proposal["sizing_allowed"] else "NO TRADE"
    else:
        decision = "NO TRADE"

    reasons: list[str] = []
    if eligible_count == 0:
        reasons.append("No baseline strategy passed the complete out-of-sample, robustness, cost, walk-forward, and cross-asset acceptance gate.")
        reasons.append("The strongest isolated results were either under-sampled or unstable outside their test slice, so positive returns are insufficient evidence.")
    elif not triggered:
        reasons.append("Validated strategies exist, but none has a current closed-candle entry signal that also matches the 1D/4H regime.")
    if any(asset_reports[symbol]["step_6_regime"]["volatility"] in {"elevated", "extreme"} for symbol in settings.universe):
        reasons.append("At least one major asset is in elevated or extreme 4H volatility, increasing gap and correlation risk.")
    correlations = cross_asset["correlation_1h_last_720_bars"]
    pair_values = [
        abs(correlations[a][b])
        for index, a in enumerate(settings.universe)
        for b in settings.universe[index + 1 :]
        if a in correlations and b in correlations[a]
    ]
    if pair_values and max(pair_values) >= 0.70:
        reasons.append("Cross-asset correlation is high enough that simultaneous BTC, ETH, and SOL positions would concentrate crypto-beta risk.")
    if not reasons:
        reasons.append("The best triggered setup did not pass final sizing or evidence checks.")
    while len(reasons) < 3:
        reasons.append("No closed-candle, regime-compatible, risk-valid setup has complete traceable evidence at the analysis timestamp.")

    levels = {
        symbol: {
            "support_4h": report["step_3_4h_structure"]["structure"]["support"],
            "resistance_4h": report["step_3_4h_structure"]["structure"]["resistance"],
            "breakout_above_4h": report["step_3_4h_structure"]["structure"].get("breakout_above"),
            "breakdown_below_4h": report["step_3_4h_structure"]["structure"].get("breakdown_below"),
        }
        for symbol, report in asset_reports.items()
    }
    report = {
        "analysis_timestamp": analysis_timestamp,
        "mode": "PAPER_ANALYSIS_ONLY",
        "fx": fx,
        "assets": asset_reports,
        "cross_asset_analysis": cross_asset,
        "eligible_strategy_count": eligible_count,
        "decision": decision,
        "proposal": proposal if decision == "LONG" else None,
        "no_trade": None if decision == "LONG" else {
            "decision": "NO TRADE",
            "reasons": reasons[:3],
            "levels_to_watch": levels,
            "conditions_for_valid_setup": (
                "A strategy must first pass every fixed validation gate, then emit its exact entry signal on a closed 1H or 4H candle while 1D/4H direction is compatible; sizing must remain within €10 risk, 25% asset exposure, and 50% portfolio exposure."
            ),
        },
    }
    atomic_write_json(settings.reports_dir / "current_market_analysis.json", report)
    atomic_write_text(settings.reports_dir / "MARKET_ANALYSIS.md", render_market_report(report))
    return report


def _fmt(value: Any, digits: int = 2) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, (int, float)):
        return f"{value:,.{digits}f}"
    return str(value)


def render_market_report(report: dict[str, Any]) -> str:
    lines = [
        "# Current Crypto Market Analysis",
        "",
        f"Analysis timestamp: {report['analysis_timestamp']}",
        "",
        "Mode: PAPER / ANALYSIS ONLY. No order was or can be placed by this report.",
        "",
    ]
    for symbol, asset in report["assets"].items():
        lines.extend([f"## {symbol}", ""])
        quality = asset["step_1_data_quality"]
        lines.extend([
            "### Step 1 — Data quality", "",
            f"Status: {quality['status']}; exchange: {quality['exchange']}; timeframes: {', '.join(quality['timeframes'])}.",
            "",
            "Latest closed candles: " + "; ".join(f"{tf} {ts}" for tf, ts in quality["latest_closed_candles"].items()) + ".",
            "",
        ])
        for step, heading in [
            ("step_2_daily_structure", "Step 2 — Daily structure"),
            ("step_3_4h_structure", "Step 3 — 4H structure"),
            ("step_4_1h_setups", "Step 4 — 1H setup context"),
            ("step_5_15m_entry_refinement", "Step 5 — 15M entry refinement"),
        ]:
            snapshot = asset[step]
            ind = snapshot["indicators"]
            structure = snapshot["structure"]
            lines.extend([
                f"### {heading}", "",
                f"Trend {snapshot['trend']}; momentum {snapshot['momentum']}; volatility {snapshot['volatility']}; structure {structure['label']}; volume {snapshot['volume']}.",
                "",
                f"Close {_fmt(snapshot['price'])}; support {_fmt(structure.get('support'))}; resistance {_fmt(structure.get('resistance'))}; EMA20/50/200 {_fmt(ind['ema_20'])}/{_fmt(ind['ema_50'])}/{_fmt(ind['ema_200'])}; RSI {_fmt(ind['rsi_14'])}; MACD histogram {_fmt(ind['macd_hist'])}; ATR {_fmt(ind['atr_14'])}; volume ratio {_fmt(ind['volume_ratio'])}x.",
                "",
            ])
        regime = asset["step_6_regime"]
        lines.extend([
            "### Step 6 — Regime", "",
            f"Trend: {regime['trend']}; volatility: {regime['volatility']}; momentum: {regime['momentum']}; structure: {regime['structure']['label']}.",
            "",
            "### Step 7 — Strategy matching", "",
        ])
        matches = asset["step_7_strategy_matching"]
        if matches:
            for match in matches:
                lines.append(
                    f"- {match['strategy']} ({match['timeframe']}): score {match['score']}; regime compatible {match['regime_compatible']}; current entry signal {match['current_entry_signal']}."
                )
        else:
            lines.append("No eligible strategy for this asset/timeframe survived the predeclared gate.")
        lines.append("")

    cross = report["cross_asset_analysis"]
    lines.extend([
        "## Cross-asset analysis", "",
        "Seven-day relative strength: " + " > ".join(cross["relative_strength_order_7d"]) + ".",
        "",
        cross["portfolio_note"], "",
        "## Trading decision", "",
        f"DECISION: **{report['decision']}**", "",
    ])
    if report["decision"] == "LONG" and report["proposal"]:
        proposal = report["proposal"]
        lines.extend([
            f"STATUS: {proposal['status']}", "",
            f"ASSET: {proposal['asset']}",
            f"DIRECTION: {proposal['direction']}",
            f"STRATEGY: {proposal['strategy']}",
            f"CONFIDENCE: {proposal['confidence']}",
            f"CURRENT PRICE: {_fmt(proposal['current_price_usdt'])} USDT",
            f"ENTRY ZONE: {_fmt(proposal['entry_zone_usdt'][0])}–{_fmt(proposal['entry_zone_usdt'][1])} USDT",
            f"STOP LOSS: {_fmt(proposal['stop_loss_usdt'])} USDT",
            f"TAKE PROFIT 1: {_fmt(proposal['take_profit_1_usdt'])} USDT",
            f"TAKE PROFIT 2: {_fmt(proposal['take_profit_2_usdt'])} USDT",
            f"RISK/REWARD: {proposal['risk_reward_tp1']}:1 / {proposal['risk_reward_tp2']}:1",
            f"PORTFOLIO EQUITY: €{proposal['portfolio_equity_eur']:.2f}",
            f"RISK PERCENTAGE: {proposal['risk_percentage']:.2%}",
            f"MAXIMUM RISK €: €{proposal['maximum_risk_eur']:.2f}",
            f"POSITION SIZE: {proposal['position_size_units']}",
            f"POSITION VALUE: €{proposal['position_value_eur']:.2f}",
            "",
        ])
    else:
        no_trade = report["no_trade"]
        lines.extend(["REASONS:", ""])
        for index, reason in enumerate(no_trade["reasons"], start=1):
            lines.append(f"{index}. {reason}")
        lines.extend(["", "LEVELS TO WATCH:", ""])
        for symbol, levels in no_trade["levels_to_watch"].items():
            lines.append(
                f"- {symbol}: 4H support {_fmt(levels['support_4h'])}; resistance {_fmt(levels['resistance_4h'])}; breakout {_fmt(levels['breakout_above_4h'])}; breakdown {_fmt(levels['breakdown_below_4h'])}."
            )
        lines.extend([
            "",
            "CONDITIONS THAT WOULD CREATE A VALID SETUP:", "",
            no_trade["conditions_for_valid_setup"], "",
        ])
    return "\n".join(lines)

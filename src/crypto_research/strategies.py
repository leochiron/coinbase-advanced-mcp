from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import pandas as pd

from .indicators import adx, atr, bollinger_bands, donchian, ema, macd, rsi


@dataclass(frozen=True)
class SignalSet:
    entry: pd.Series
    exit: pd.Series
    atr: pd.Series
    stop_atr_multiple: float
    take_profit_r: float
    max_holding_bars: int


@dataclass(frozen=True)
class StrategyDefinition:
    name: str
    version: str
    style: str
    hypothesis: str
    reason: str
    expected_failure_mode: str
    entry_rule: str
    exit_rule: str
    stop_rule: str
    invalidation_rule: str
    compatible_regimes: tuple[str, ...]
    default_params: dict[str, Any]
    signal_builder: Callable[[pd.DataFrame, dict[str, Any]], SignalSet]
    sensitivity_variants: tuple[dict[str, Any], ...]

    def signals(self, frame: pd.DataFrame, params: dict[str, Any] | None = None) -> SignalSet:
        effective = {**self.default_params, **(params or {})}
        result = self.signal_builder(frame, effective)
        return SignalSet(
            entry=result.entry.fillna(False).astype(bool),
            exit=result.exit.fillna(False).astype(bool),
            atr=result.atr,
            stop_atr_multiple=result.stop_atr_multiple,
            take_profit_r=result.take_profit_r,
            max_holding_bars=result.max_holding_bars,
        )


def _ema_trend(frame: pd.DataFrame, p: dict[str, Any]) -> SignalSet:
    fast = ema(frame["close"], p["fast"])
    slow = ema(frame["close"], p["slow"])
    long = ema(frame["close"], p["long"])
    volume_ma = frame["volume"].rolling(20, min_periods=20).mean()
    cross_up = (fast > slow) & (fast.shift(1) <= slow.shift(1))
    entry = cross_up & (frame["close"] > long) & (frame["volume"] >= volume_ma * p["volume_ratio"])
    exit_signal = (fast < slow) & (fast.shift(1) >= slow.shift(1))
    return SignalSet(entry, exit_signal, atr(frame), p["stop_atr"], p["target_r"], p["max_hold"])


def _rsi_mean_reversion(frame: pd.DataFrame, p: dict[str, Any]) -> SignalSet:
    rsi_line = rsi(frame["close"], p["rsi_period"])
    trend = ema(frame["close"], 200)
    adx_line, _, _ = adx(frame, 14)
    was_oversold = rsi_line.shift(1) <= p["oversold"]
    entry = was_oversold & (rsi_line > p["oversold"]) & (frame["close"] > trend) & (adx_line < p["max_adx"])
    exit_signal = (rsi_line >= p["exit_rsi"]) | (frame["close"] < trend)
    return SignalSet(entry, exit_signal, atr(frame), p["stop_atr"], p["target_r"], p["max_hold"])


def _donchian_breakout(frame: pd.DataFrame, p: dict[str, Any]) -> SignalSet:
    low_exit, _, high_entry = donchian(frame["high"], frame["low"], p["entry_period"])
    exit_low, _, _ = donchian(frame["high"], frame["low"], p["exit_period"])
    volume_ma = frame["volume"].rolling(20, min_periods=20).mean()
    entry = (frame["close"] > high_entry) & (frame["volume"] > volume_ma * p["volume_ratio"])
    exit_signal = frame["close"] < exit_low
    return SignalSet(entry, exit_signal, atr(frame), p["stop_atr"], p["target_r"], p["max_hold"])


def _macd_momentum(frame: pd.DataFrame, p: dict[str, Any]) -> SignalSet:
    line, signal_line, _ = macd(frame["close"], p["fast"], p["slow"], p["signal"])
    e50 = ema(frame["close"], 50)
    e200 = ema(frame["close"], 200)
    rsi_line = rsi(frame["close"], 14)
    cross_up = (line > signal_line) & (line.shift(1) <= signal_line.shift(1))
    entry = cross_up & (line > 0) & (e50 > e200) & rsi_line.between(p["rsi_min"], p["rsi_max"])
    exit_signal = (line < signal_line) & (line.shift(1) >= signal_line.shift(1))
    return SignalSet(entry, exit_signal, atr(frame), p["stop_atr"], p["target_r"], p["max_hold"])


def _bollinger_mean_reversion(frame: pd.DataFrame, p: dict[str, Any]) -> SignalSet:
    lower, middle, _, _ = bollinger_bands(frame["close"], p["period"], p["stddev"])
    rsi_line = rsi(frame["close"], 14)
    adx_line, _, _ = adx(frame, 14)
    entry = (
        (frame["close"].shift(1) < lower.shift(1))
        & (frame["close"] >= lower)
        & (rsi_line < p["rsi_max"])
        & (adx_line < p["max_adx"])
    )
    exit_signal = (frame["close"] >= middle) | (adx_line > p["trend_adx_exit"])
    return SignalSet(entry, exit_signal, atr(frame), p["stop_atr"], p["target_r"], p["max_hold"])


def _trend_pullback(frame: pd.DataFrame, p: dict[str, Any]) -> SignalSet:
    e_fast = ema(frame["close"], p["fast"])
    e_slow = ema(frame["close"], p["slow"])
    e_long = ema(frame["close"], p["long"])
    rsi_line = rsi(frame["close"], 14)
    volume_ma = frame["volume"].rolling(20, min_periods=20).mean()
    trend_ok = (e_fast > e_slow) & (e_slow > e_long)
    touched = frame["low"] <= e_fast * (1 + p["touch_tolerance"])
    reclaimed = frame["close"] > e_fast
    entry = (
        trend_ok & touched & reclaimed
        & rsi_line.between(p["rsi_min"], p["rsi_max"])
        & (frame["volume"] >= volume_ma * p["volume_ratio"])
    )
    exit_signal = (frame["close"] < e_slow) | (e_fast < e_slow)
    return SignalSet(entry, exit_signal, atr(frame), p["stop_atr"], p["target_r"], p["max_hold"])


STRATEGIES: tuple[StrategyDefinition, ...] = (
    StrategyDefinition(
        name="ema-trend", version="1.0.0", style="trend",
        hypothesis="A bullish EMA20/EMA50 crossover above EMA200 with non-weak volume captures persistent directional repricing.",
        reason="Moving-average alignment identifies sustained price acceptance after a trend transition.",
        expected_failure_mode="Whipsaws during sideways or rapidly reversing markets.",
        entry_rule="At candle close: EMA20 crosses above EMA50, close is above EMA200, and volume is at least its 20-bar average; enter next open.",
        exit_rule="Exit next open after EMA20 crosses below EMA50, or use the fixed stop, target, or time stop.",
        stop_rule="Initial stop 2.0 ATR14 below filled entry.",
        invalidation_rule="EMA20/EMA50 bearish recross or stop breach.",
        compatible_regimes=("bullish", "strong bullish"),
        default_params={"fast": 20, "slow": 50, "long": 200, "volume_ratio": 1.0, "stop_atr": 2.0, "target_r": 3.0, "max_hold": 120},
        signal_builder=_ema_trend,
        sensitivity_variants=({"fast": 18}, {"fast": 22}, {"slow": 45}, {"slow": 55}),
    ),
    StrategyDefinition(
        name="rsi-mean-reversion", version="1.0.0", style="mean-reversion",
        hypothesis="Oversold RSI recoveries in a non-trending long-term bullish regime revert toward equilibrium after short-lived selling pressure.",
        reason="Liquidity-driven overshoots can reverse when the broader trend remains intact.",
        expected_failure_mode="A persistent selloff where oversold readings remain oversold and EMA200 support fails.",
        entry_rule="RSI14 crosses above 30 after being at or below 30, close is above EMA200, and ADX14 is below 25; enter next open.",
        exit_rule="Exit next open at RSI14 >= 52 or close below EMA200, or use stop/target/time stop.",
        stop_rule="Initial stop 1.5 ATR14 below filled entry.",
        invalidation_rule="Close below EMA200 or stop breach.",
        compatible_regimes=("neutral", "bullish"),
        default_params={"rsi_period": 14, "oversold": 30.0, "exit_rsi": 52.0, "max_adx": 25.0, "stop_atr": 1.5, "target_r": 2.0, "max_hold": 48},
        signal_builder=_rsi_mean_reversion,
        sensitivity_variants=({"oversold": 28.0}, {"oversold": 32.0}, {"exit_rsi": 50.0}, {"exit_rsi": 55.0}),
    ),
    StrategyDefinition(
        name="donchian-breakout", version="1.0.0", style="breakout",
        hypothesis="A close beyond the prior 20-bar range with volume confirmation captures volatility expansion and momentum persistence.",
        reason="Range breaks can trigger stops and delayed participation that extend the move.",
        expected_failure_mode="False breakouts in thin or directionless markets.",
        entry_rule="Close exceeds the prior 20-bar high and volume exceeds 1.1x its 20-bar average; enter next open.",
        exit_rule="Exit next open after close breaks the prior 10-bar low, or use stop/target/time stop.",
        stop_rule="Initial stop 2.0 ATR14 below filled entry.",
        invalidation_rule="Close below the prior 10-bar low or stop breach.",
        compatible_regimes=("bullish", "strong bullish", "neutral"),
        default_params={"entry_period": 20, "exit_period": 10, "volume_ratio": 1.1, "stop_atr": 2.0, "target_r": 4.0, "max_hold": 120},
        signal_builder=_donchian_breakout,
        sensitivity_variants=({"entry_period": 18}, {"entry_period": 22}, {"volume_ratio": 1.0}, {"volume_ratio": 1.2}),
    ),
    StrategyDefinition(
        name="macd-momentum", version="1.0.0", style="momentum",
        hypothesis="Positive MACD continuation signals within an established EMA50/EMA200 uptrend capture medium-term momentum.",
        reason="Momentum can persist as participants react at different speeds to the same trend.",
        expected_failure_mode="Late entries after exhausted moves or repeated crosses in a range.",
        entry_rule="MACD12/26 crosses above signal9 while MACD > 0, EMA50 > EMA200, and RSI14 is 45-70; enter next open.",
        exit_rule="Exit next open after MACD crosses below its signal, or use stop/target/time stop.",
        stop_rule="Initial stop 2.0 ATR14 below filled entry.",
        invalidation_rule="Bearish MACD recross or stop breach.",
        compatible_regimes=("bullish", "strong bullish"),
        default_params={"fast": 12, "slow": 26, "signal": 9, "rsi_min": 45.0, "rsi_max": 70.0, "stop_atr": 2.0, "target_r": 3.0, "max_hold": 80},
        signal_builder=_macd_momentum,
        sensitivity_variants=({"fast": 10}, {"fast": 14}, {"slow": 24}, {"slow": 28}),
    ),
    StrategyDefinition(
        name="bollinger-mean-reversion", version="1.0.0", style="mean-reversion",
        hypothesis="A close back inside the lower Bollinger Band during a low-trend regime captures reversion after a statistically unusual downside excursion.",
        reason="Temporary order-flow imbalances often normalize when trend strength is weak.",
        expected_failure_mode="Band walking during a strong downtrend or volatility shock.",
        entry_rule="Previous close is below the lower 20/2 band, current close re-enters it, RSI14 < 40, and ADX14 < 22; enter next open.",
        exit_rule="Exit next open at the middle band or if ADX14 rises above 30, or use stop/target/time stop.",
        stop_rule="Initial stop 1.5 ATR14 below filled entry.",
        invalidation_rule="Trend-strength expansion, stop breach, or failure to revert before time stop.",
        compatible_regimes=("neutral",),
        default_params={"period": 20, "stddev": 2.0, "rsi_max": 40.0, "max_adx": 22.0, "trend_adx_exit": 30.0, "stop_atr": 1.5, "target_r": 2.0, "max_hold": 40},
        signal_builder=_bollinger_mean_reversion,
        sensitivity_variants=({"period": 18}, {"period": 22}, {"stddev": 1.8}, {"stddev": 2.2}),
    ),
    StrategyDefinition(
        name="trend-pullback", version="1.0.0", style="trend-pullback",
        hypothesis="Pullbacks to EMA20 inside EMA20 > EMA50 > EMA200 trends offer better-defined risk than chasing highs.",
        reason="Trend participants often defend a dynamic fair-value area after short-term profit taking.",
        expected_failure_mode="The apparent pullback is the first leg of a genuine trend reversal.",
        entry_rule="EMA20 > EMA50 > EMA200, low touches within 0.25% above EMA20, close reclaims EMA20, RSI14 is 45-62, and volume is at least 0.8x average; enter next open.",
        exit_rule="Exit next open if close falls below EMA50 or EMA20 < EMA50, or use stop/target/time stop.",
        stop_rule="Initial stop 1.8 ATR14 below filled entry.",
        invalidation_rule="Close below EMA50, bearish EMA cross, or stop breach.",
        compatible_regimes=("bullish", "strong bullish"),
        default_params={"fast": 20, "slow": 50, "long": 200, "touch_tolerance": 0.0025, "rsi_min": 45.0, "rsi_max": 62.0, "volume_ratio": 0.8, "stop_atr": 1.8, "target_r": 3.0, "max_hold": 80},
        signal_builder=_trend_pullback,
        sensitivity_variants=({"fast": 18}, {"fast": 22}, {"rsi_max": 60.0}, {"rsi_max": 65.0}),
    ),
)


def strategy_by_name(name: str) -> StrategyDefinition:
    for strategy in STRATEGIES:
        if strategy.name == name:
            return strategy
    raise KeyError(f"Unknown strategy: {name}")


def strategy_catalog() -> list[dict[str, Any]]:
    return [
        {
            "name": s.name,
            "version": s.version,
            "style": s.style,
            "hypothesis": s.hypothesis,
            "reason": s.reason,
            "rules": {"entry": s.entry_rule, "exit": s.exit_rule, "stop": s.stop_rule, "invalidation": s.invalidation_rule},
            "expected_failure_mode": s.expected_failure_mode,
            "compatible_regimes": list(s.compatible_regimes),
            "default_params": s.default_params,
            "test": "Chronological 60/20/20 backtest, costs, parameter sensitivity, delayed entry, walk-forward folds, asset/timeframe robustness, and Monte Carlo trade-sequence resampling.",
        }
        for s in STRATEGIES
    ]

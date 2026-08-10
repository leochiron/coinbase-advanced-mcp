from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .indicators import add_indicators


def _trend_label(row: pd.Series) -> str:
    price = row["close"]
    e20, e50, e200 = row["ema_20"], row["ema_50"], row["ema_200"]
    adx_value = row["adx_14"]
    slope = row["ema_20_slope_5"]
    if any(pd.isna(value) for value in [e20, e50, e200, adx_value, slope]):
        return "neutral"
    if price > e20 > e50 > e200 and adx_value >= 25 and slope > 0:
        return "strong bullish"
    if price > e50 and e20 > e50 and slope > 0:
        return "bullish"
    if price < e20 < e50 < e200 and adx_value >= 25 and slope < 0:
        return "strong bearish"
    if price < e50 and e20 < e50 and slope < 0:
        return "bearish"
    return "neutral"


def _volatility_label(percentile: float) -> str:
    if pd.isna(percentile):
        return "unknown"
    if percentile >= 0.90:
        return "extreme"
    if percentile >= 0.75:
        return "elevated"
    if percentile <= 0.25:
        return "low"
    return "normal"


def _momentum_label(row: pd.Series) -> str:
    values = [row["rsi_14"], row["macd_hist"], row["roc_10"]]
    if any(pd.isna(value) for value in values):
        return "unknown"
    positive = int(row["rsi_14"] > 52) + int(row["macd_hist"] > 0) + int(row["roc_10"] > 0)
    negative = int(row["rsi_14"] < 48) + int(row["macd_hist"] < 0) + int(row["roc_10"] < 0)
    if positive == 3:
        return "strong bullish"
    if positive >= 2:
        return "bullish"
    if negative == 3:
        return "strong bearish"
    if negative >= 2:
        return "bearish"
    return "neutral"


def _market_structure(frame: pd.DataFrame, window: int = 20) -> dict[str, Any]:
    if len(frame) < window * 2:
        return {"label": "insufficient history", "support": None, "resistance": None}
    recent = frame.iloc[-window:]
    previous = frame.iloc[-window * 2 : -window]
    higher_high = recent["high"].max() > previous["high"].max()
    higher_low = recent["low"].min() > previous["low"].min()
    lower_high = recent["high"].max() < previous["high"].max()
    lower_low = recent["low"].min() < previous["low"].min()
    if higher_high and higher_low:
        label = "higher highs and higher lows"
    elif lower_high and lower_low:
        label = "lower highs and lower lows"
    elif higher_high and lower_low:
        label = "expanding range"
    else:
        label = "consolidation / mixed structure"
    support = float(recent["low"].nsmallest(min(3, len(recent))).median())
    resistance = float(recent["high"].nlargest(min(3, len(recent))).median())
    close = float(recent["close"].iloc[-1])
    zone_width = float(recent["close"].iloc[-1] * 0.0025)
    return {
        "label": label,
        "support": support,
        "resistance": resistance,
        "breakout_above": resistance + zone_width,
        "breakdown_below": support - zone_width,
        "range_width_pct": (resistance - support) / close if close else None,
    }


def classify_regime(frame: pd.DataFrame) -> dict[str, Any]:
    enriched = add_indicators(frame)
    clean = enriched.dropna(subset=["ema_200", "rsi_14", "macd_hist", "atr_14"])
    if clean.empty:
        raise ValueError("Insufficient validated history to classify regime")
    row = clean.iloc[-1]
    structure = _market_structure(clean)
    volume_state = (
        "abnormal high" if row["volume_ratio"] >= 2
        else "above average" if row["volume_ratio"] >= 1.2
        else "below average" if row["volume_ratio"] <= 0.8
        else "normal"
    )
    return {
        "timestamp": clean.index[-1].isoformat(),
        "price": float(row["close"]),
        "trend": _trend_label(row),
        "volatility": _volatility_label(float(row["atr_percentile"])),
        "momentum": _momentum_label(row),
        "structure": structure,
        "indicators": {
            "ema_20": float(row["ema_20"]),
            "ema_50": float(row["ema_50"]),
            "ema_200": float(row["ema_200"]),
            "rsi_14": float(row["rsi_14"]),
            "macd": float(row["macd"]),
            "macd_signal": float(row["macd_signal"]),
            "macd_hist": float(row["macd_hist"]),
            "atr_14": float(row["atr_14"]),
            "atr_pct": float(row["atr_pct"]),
            "atr_percentile": float(row["atr_percentile"]),
            "bb_width": float(row["bb_width"]),
            "realized_vol_20": float(row["realized_vol_20"]),
            "volume_ratio": float(row["volume_ratio"]),
            "adx_14": float(row["adx_14"]),
            "roc_10": float(row["roc_10"]),
            "donchian_high_20": float(row["donchian_high_20"]),
            "donchian_low_20": float(row["donchian_low_20"]),
        },
        "volume": volume_state,
    }


def regime_labels(enriched: pd.DataFrame) -> pd.Series:
    labels: list[str] = []
    for _, row in enriched.iterrows():
        trend = _trend_label(row)
        volatility = _volatility_label(row.get("atr_percentile", np.nan))
        labels.append(f"{trend}|{volatility}")
    return pd.Series(labels, index=enriched.index, dtype="object")

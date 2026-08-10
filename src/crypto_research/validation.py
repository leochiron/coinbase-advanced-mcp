from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .constants import TIMEFRAME_SECONDS
from .io_utils import atomic_write_json, iso_utc
from .market_data import read_ohlcv_cache
from .models import ValidationResult

REQUIRED_COLUMNS = {"open", "high", "low", "close", "volume", "close_time"}


def validate_ohlcv(
    frame: pd.DataFrame,
    symbol: str,
    timeframe: str,
    now: datetime | None = None,
    minimum_rows: int = 250,
) -> ValidationResult:
    if timeframe not in TIMEFRAME_SECONDS:
        raise ValueError(f"Unsupported timeframe: {timeframe}")
    current = pd.Timestamp(now or datetime.now(UTC))
    errors: list[str] = []
    warnings: list[str] = []
    missing_columns = REQUIRED_COLUMNS - set(frame.columns)
    if missing_columns:
        errors.append(f"Missing required columns: {sorted(missing_columns)}")
        return ValidationResult(
            status="FAIL", symbol=symbol, timeframe=timeframe, rows=len(frame),
            first_timestamp=None, latest_closed_candle=None, errors=errors,
        )

    first = frame.index.min() if len(frame) else None
    latest_close = pd.to_datetime(frame["close_time"], utc=True).max() if len(frame) else None
    if frame.empty:
        errors.append("Dataset is empty")

    duplicate_count = int(frame.index.duplicated(keep=False).sum())
    if duplicate_count:
        errors.append(f"Duplicate timestamps: {duplicate_count}")

    if not frame.index.is_monotonic_increasing:
        errors.append("Timestamps are not strictly ascending")

    timezone = str(frame.index.tz) if isinstance(frame.index, pd.DatetimeIndex) else "not-datetime"
    if not isinstance(frame.index, pd.DatetimeIndex) or frame.index.tz is None:
        errors.append("Timestamp index is not timezone-aware")
    elif str(frame.index.tz) != "UTC":
        errors.append(f"Timestamp index is not UTC: {frame.index.tz}")

    expected_seconds = TIMEFRAME_SECONDS[timeframe]
    diffs = frame.index.to_series().diff().dt.total_seconds().dropna() if len(frame) else pd.Series(dtype=float)
    inconsistent = int((~np.isclose(diffs, expected_seconds)).sum())
    missing = int(sum(max(round(value / expected_seconds) - 1, 0) for value in diffs if value > expected_seconds))
    if inconsistent:
        errors.append(f"Inconsistent candle intervals: {inconsistent}; inferred missing candles: {missing}")

    numeric = frame[["open", "high", "low", "close", "volume"]].apply(pd.to_numeric, errors="coerce")
    non_finite = ~np.isfinite(numeric.to_numpy()).all(axis=1)
    impossible_mask = (
        non_finite
        | (numeric[["open", "high", "low", "close"]] <= 0).any(axis=1).to_numpy()
        | (numeric["high"] < numeric[["open", "close", "low"]].max(axis=1)).to_numpy()
        | (numeric["low"] > numeric[["open", "close", "high"]].min(axis=1)).to_numpy()
        | (numeric["volume"] < 0).to_numpy()
    )
    impossible = int(impossible_mask.sum())
    if impossible:
        errors.append(f"Impossible or non-finite OHLCV candles: {impossible}")

    zero_volume = int((numeric["volume"] == 0).sum())
    if zero_volume:
        errors.append(f"Zero-volume anomalies: {zero_volume}")

    close_times = pd.to_datetime(frame["close_time"], utc=True)
    incomplete = int((close_times >= current).sum())
    if incomplete:
        errors.append(f"Incomplete candles present: {incomplete}")

    stale = False
    if latest_close is not None:
        age_seconds = (current - latest_close).total_seconds()
        stale = age_seconds > expected_seconds * 2.25
        if stale:
            errors.append(f"Latest closed candle is stale by {age_seconds / expected_seconds:.1f} intervals")

    if len(frame) < minimum_rows:
        errors.append(f"Only {len(frame)} rows; at least {minimum_rows} required for EMA200 analysis")
    elif len(frame) < 1000:
        warnings.append("History is short; backtest trade counts and regime coverage may be weak")

    return ValidationResult(
        status="FAIL" if errors else "PASS",
        symbol=symbol,
        timeframe=timeframe,
        rows=len(frame),
        first_timestamp=iso_utc(first.to_pydatetime()) if first is not None else None,
        latest_closed_candle=iso_utc(latest_close.to_pydatetime()) if latest_close is not None else None,
        missing_candles=missing,
        duplicate_timestamps=duplicate_count,
        inconsistent_intervals=inconsistent,
        impossible_candles=impossible,
        zero_volume_candles=zero_volume,
        incomplete_candles=incomplete,
        stale=stale,
        timezone=timezone,
        errors=errors,
        warnings=warnings,
    )


def validate_cached_bundle(
    data_dir: Path,
    exchange_slug: str,
    universe: tuple[str, ...],
    timeframes: tuple[str, ...],
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for symbol in universe:
        for timeframe in timeframes:
            try:
                frame, metadata = read_ohlcv_cache(data_dir, exchange_slug, symbol, timeframe)
                result = validate_ohlcv(frame, symbol, timeframe)
                payload = result.to_dict()
                payload["source"] = metadata.get("source")
                payload["exchange"] = metadata.get("exchange")
                payload["retrieved_at"] = metadata.get("retrieved_at")
                payload["cache_sha256"] = metadata.get("csv_sha256")
                results.append(payload)
            except Exception as exc:
                results.append({
                    "status": "FAIL", "symbol": symbol, "timeframe": timeframe,
                    "errors": [str(exc)], "rows": 0,
                })
    report = {
        "validated_at": iso_utc(),
        "overall_status": "PASS" if results and all(item["status"] == "PASS" for item in results) else "FAIL",
        "datasets": results,
    }
    atomic_write_json(data_dir / "quality" / "latest_validation.json", report)
    return report


def require_valid(result: ValidationResult) -> None:
    if not result.ok:
        raise ValueError(f"Data quality failed for {result.symbol} {result.timeframe}: {'; '.join(result.errors)}")

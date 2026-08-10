from datetime import UTC, datetime, timedelta

import pandas as pd

from crypto_research.validation import validate_ohlcv


def make_frame(rows: int = 300) -> tuple[pd.DataFrame, datetime]:
    start = datetime(2025, 1, 1, tzinfo=UTC)
    index = pd.date_range(start, periods=rows, freq="h", tz="UTC")
    frame = pd.DataFrame({
        "open": 100.0,
        "high": 102.0,
        "low": 99.0,
        "close": 101.0,
        "volume": 1000.0,
        "close_time": index + pd.Timedelta(hours=1) - pd.Timedelta(milliseconds=1),
    }, index=index)
    now = (index[-1] + pd.Timedelta(hours=1, minutes=1)).to_pydatetime()
    return frame, now


def test_valid_data_passes():
    frame, now = make_frame()
    result = validate_ohlcv(frame, "BTC/USDT", "1h", now=now)
    assert result.ok
    assert result.missing_candles == 0


def test_gap_duplicate_impossible_and_incomplete_fail_closed():
    frame, now = make_frame()
    frame = frame.drop(frame.index[100])
    duplicate = frame.iloc[[20]].copy()
    frame = pd.concat([frame, duplicate]).sort_index()
    frame.iloc[50, frame.columns.get_loc("high")] = 98.0
    frame.iloc[-1, frame.columns.get_loc("close_time")] = pd.Timestamp(now) + pd.Timedelta(hours=1)
    result = validate_ohlcv(frame, "BTC/USDT", "1h", now=now)
    assert not result.ok
    assert result.duplicate_timestamps > 0
    assert result.missing_candles > 0
    assert result.impossible_candles > 0
    assert result.incomplete_candles > 0

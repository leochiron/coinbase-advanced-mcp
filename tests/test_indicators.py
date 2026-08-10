import numpy as np
import pandas as pd

from crypto_research.indicators import atr, bollinger_bands, donchian, ema, macd, rsi


def test_core_indicators_are_deterministic_and_past_only():
    index = pd.date_range("2025-01-01", periods=260, freq="h", tz="UTC")
    close = pd.Series(np.arange(1.0, 261.0), index=index)
    frame = pd.DataFrame({
        "open": close - 0.25,
        "high": close + 1.0,
        "low": close - 1.0,
        "close": close,
        "volume": 100.0,
    })
    assert ema(close, 20).iloc[-1] < close.iloc[-1]
    assert rsi(close, 14).iloc[-1] == 100.0
    assert atr(frame, 14).iloc[-1] > 0
    lower, middle, upper, width = bollinger_bands(close)
    assert lower.iloc[-1] < middle.iloc[-1] < upper.iloc[-1]
    assert width.iloc[-1] > 0
    line, signal, hist = macd(close)
    assert line.iloc[-1] > 0
    assert np.isfinite(signal.iloc[-1])
    assert np.isfinite(hist.iloc[-1])


def test_donchian_channel_excludes_current_candle():
    high = pd.Series([1, 2, 3, 100], dtype=float)
    low = pd.Series([0, 1, 2, 3], dtype=float)
    lower, _, upper = donchian(high, low, period=3)
    assert upper.iloc[-1] == 3
    assert lower.iloc[-1] == 0

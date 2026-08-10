from __future__ import annotations

import numpy as np
import pandas as pd


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False, min_periods=period).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gains = delta.clip(lower=0)
    losses = -delta.clip(upper=0)
    avg_gain = gains.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = losses.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    result = 100 - 100 / (1 + rs)
    result = result.where(avg_loss != 0, 100.0)
    result = result.where(~((avg_gain == 0) & (avg_loss == 0)), 50.0)
    return result


def macd(
    series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[pd.Series, pd.Series, pd.Series]:
    fast_line = ema(series, fast)
    slow_line = ema(series, slow)
    line = fast_line - slow_line
    signal_line = line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return line, signal_line, line - signal_line


def true_range(frame: pd.DataFrame) -> pd.Series:
    previous_close = frame["close"].shift(1)
    return pd.concat(
        [
            frame["high"] - frame["low"],
            (frame["high"] - previous_close).abs(),
            (frame["low"] - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)


def atr(frame: pd.DataFrame, period: int = 14) -> pd.Series:
    return true_range(frame).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def bollinger_bands(
    series: pd.Series, period: int = 20, standard_deviations: float = 2.0
) -> tuple[pd.Series, pd.Series, pd.Series, pd.Series]:
    middle = series.rolling(period, min_periods=period).mean()
    standard = series.rolling(period, min_periods=period).std(ddof=0)
    upper = middle + standard_deviations * standard
    lower = middle - standard_deviations * standard
    width = (upper - lower) / middle.replace(0, np.nan)
    return lower, middle, upper, width


def donchian(
    high: pd.Series, low: pd.Series, period: int = 20
) -> tuple[pd.Series, pd.Series, pd.Series]:
    # Shift by one so a decision at t only compares with completed bars before t.
    upper = high.rolling(period, min_periods=period).max().shift(1)
    lower = low.rolling(period, min_periods=period).min().shift(1)
    return lower, (upper + lower) / 2, upper


def adx(frame: pd.DataFrame, period: int = 14) -> tuple[pd.Series, pd.Series, pd.Series]:
    up_move = frame["high"].diff()
    down_move = -frame["low"].diff()
    plus_dm = pd.Series(np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=frame.index)
    minus_dm = pd.Series(np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=frame.index)
    smoothed_tr = true_range(frame).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    plus_di = 100 * plus_dm.ewm(alpha=1 / period, adjust=False, min_periods=period).mean() / smoothed_tr
    minus_di = 100 * minus_dm.ewm(alpha=1 / period, adjust=False, min_periods=period).mean() / smoothed_tr
    denominator = (plus_di + minus_di).replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / denominator
    adx_line = dx.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    return adx_line, plus_di, minus_di


def rolling_percentile(series: pd.Series, lookback: int = 200) -> pd.Series:
    return series.rolling(lookback, min_periods=max(30, lookback // 4)).apply(
        lambda values: float(np.mean(values <= values[-1])), raw=True
    )


def add_indicators(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()
    result["ema_20"] = ema(result["close"], 20)
    result["ema_50"] = ema(result["close"], 50)
    result["ema_200"] = ema(result["close"], 200)
    result["rsi_14"] = rsi(result["close"], 14)
    result["macd"], result["macd_signal"], result["macd_hist"] = macd(result["close"])
    result["atr_14"] = atr(result, 14)
    result["atr_pct"] = result["atr_14"] / result["close"]
    result["atr_percentile"] = rolling_percentile(result["atr_pct"], 200)
    (
        result["bb_lower"], result["bb_middle"], result["bb_upper"], result["bb_width"]
    ) = bollinger_bands(result["close"], 20, 2.0)
    result["bb_width_percentile"] = rolling_percentile(result["bb_width"], 200)
    result["volume_ma_20"] = result["volume"].rolling(20, min_periods=20).mean()
    result["volume_ratio"] = result["volume"] / result["volume_ma_20"].replace(0, np.nan)
    (
        result["donchian_low_20"], result["donchian_mid_20"], result["donchian_high_20"]
    ) = donchian(result["high"], result["low"], 20)
    result["adx_14"], result["plus_di_14"], result["minus_di_14"] = adx(result, 14)
    result["roc_10"] = result["close"].pct_change(10)
    result["ema_20_slope_5"] = result["ema_20"].pct_change(5)
    log_returns = np.log(result["close"] / result["close"].shift(1))
    result["realized_vol_20"] = log_returns.rolling(20, min_periods=20).std(ddof=0) * np.sqrt(365.25)
    return result

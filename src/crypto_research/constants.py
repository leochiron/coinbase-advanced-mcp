from __future__ import annotations

TIMEFRAME_SECONDS: dict[str, int] = {
    "15m": 15 * 60,
    "1h": 60 * 60,
    "4h": 4 * 60 * 60,
    "1d": 24 * 60 * 60,
}

TIMEFRAME_TO_KRAKEN_MINUTES: dict[str, int] = {
    "15m": 15,
    "1h": 60,
    "4h": 240,
    "1d": 1440,
}

UNIVERSE = ("BTC/USDT", "ETH/USDT", "SOL/USDT")
TIMEFRAMES = ("15m", "1h", "4h", "1d")


def periods_per_year(timeframe: str) -> float:
    return 365.25 * 24 * 60 * 60 / TIMEFRAME_SECONDS[timeframe]


def symbol_slug(symbol: str) -> str:
    return symbol.replace("/", "")

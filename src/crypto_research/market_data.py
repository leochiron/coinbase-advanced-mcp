from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd

from .constants import TIMEFRAME_SECONDS, TIMEFRAME_TO_KRAKEN_MINUTES, symbol_slug
from .io_utils import atomic_write_json, atomic_write_text, iso_utc, sha256_file, utc_now


class MarketDataError(RuntimeError):
    pass


def _fetch_json(url: str, params: dict[str, Any] | None = None, retries: int = 3) -> Any:
    query = urllib.parse.urlencode(params or {})
    target = f"{url}?{query}" if query else url
    timeout = float(os.getenv("CRYPTO_RESEARCH_HTTP_TIMEOUT_SECONDS", "20"))
    request = urllib.request.Request(
        target,
        headers={"Accept": "application/json", "User-Agent": "crypto-research/0.1 analysis-only"},
        method="GET",
    )
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(0.4 * (2**attempt))
    raise MarketDataError(f"Public market-data request failed: {target}: {last_error}")


class PublicMarketDataProvider(ABC):
    exchange: str
    source: str

    @abstractmethod
    def fetch_ohlcv(self, symbol: str, timeframe: str, limit: int) -> tuple[pd.DataFrame, dict[str, Any]]:
        raise NotImplementedError


class BinancePublicProvider(PublicMarketDataProvider):
    exchange = "Binance Spot"
    source = "Binance public REST API"
    _bases = (
        "https://api.binance.com",
        "https://api1.binance.com",
        "https://api2.binance.com",
        "https://api3.binance.com",
    )

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        errors: list[str] = []
        for base in self._bases:
            try:
                return _fetch_json(base + path, params)
            except MarketDataError as exc:
                errors.append(str(exc))
        raise MarketDataError("; ".join(errors))

    def server_time_ms(self) -> int:
        return int(self._get("/api/v3/time")["serverTime"])

    def fetch_ohlcv(self, symbol: str, timeframe: str, limit: int) -> tuple[pd.DataFrame, dict[str, Any]]:
        if timeframe not in TIMEFRAME_SECONDS:
            raise ValueError(f"Unsupported timeframe: {timeframe}")
        requested_at = utc_now()
        server_ms = self.server_time_ms()
        exchange_symbol = symbol_slug(symbol)
        target = limit + 2
        rows: list[list[Any]] = []
        cursor = server_ms
        while len(rows) < target:
            page_size = min(1000, target - len(rows))
            page = self._get(
                "/api/v3/klines",
                {"symbol": exchange_symbol, "interval": timeframe, "limit": page_size, "endTime": cursor},
            )
            if not page:
                break
            rows = page + rows
            oldest_open = int(page[0][0])
            next_cursor = oldest_open - 1
            if next_cursor >= cursor:
                break
            cursor = next_cursor
            if len(page) < page_size:
                break

        if not rows:
            raise MarketDataError(f"No OHLCV returned for {symbol} {timeframe}")

        columns = [
            "open_time_ms", "open", "high", "low", "close", "volume", "close_time_ms",
            "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
        ]
        frame = pd.DataFrame(rows, columns=columns)
        frame = frame.drop_duplicates(subset=["open_time_ms"], keep="last")
        incomplete_count = int((frame["close_time_ms"].astype("int64") >= server_ms).sum())
        frame = frame[frame["close_time_ms"].astype("int64") < server_ms]
        excess_history_trimmed = max(0, len(frame) - limit)
        frame = frame.tail(limit).copy()
        frame["timestamp"] = pd.to_datetime(frame["open_time_ms"].astype("int64"), unit="ms", utc=True)
        frame["close_time"] = pd.to_datetime(frame["close_time_ms"].astype("int64"), unit="ms", utc=True)
        numeric = ["open", "high", "low", "close", "volume", "quote_volume", "taker_buy_base", "taker_buy_quote"]
        frame[numeric] = frame[numeric].astype(float)
        frame["trades"] = frame["trades"].astype(int)
        frame = frame.set_index("timestamp").sort_index()
        frame = frame[["open", "high", "low", "close", "volume", "close_time", "quote_volume", "trades", "taker_buy_base"]]
        metadata = {
            "source": self.source,
            "exchange": self.exchange,
            "symbol": symbol,
            "exchange_symbol": exchange_symbol,
            "timeframe": timeframe,
            "retrieved_at": iso_utc(requested_at),
            "exchange_server_time": iso_utc(datetime.fromtimestamp(server_ms / 1000, tz=UTC)),
            "latest_closed_candle": iso_utc(frame["close_time"].iloc[-1].to_pydatetime()),
            "rows": len(frame),
            "endpoint": "/api/v3/klines",
            "access": "public-read-only",
            "incomplete_candles_removed": incomplete_count,
            "excess_history_rows_trimmed": excess_history_trimmed,
        }
        return frame, metadata

    def fetch_microstructure(self, symbol: str) -> dict[str, Any]:
        exchange_symbol = symbol_slug(symbol)
        retrieved_at = iso_utc()
        book = self._get("/api/v3/ticker/bookTicker", {"symbol": exchange_symbol})
        depth = self._get("/api/v3/depth", {"symbol": exchange_symbol, "limit": 100})
        bid = float(book["bidPrice"])
        ask = float(book["askPrice"])
        mid = (bid + ask) / 2

        def quote_depth(levels: list[list[str]], side: str, bps: float) -> float:
            if side == "bid":
                selected = ((float(p), float(q)) for p, q in levels if float(p) >= mid * (1 - bps / 10_000))
            else:
                selected = ((float(p), float(q)) for p, q in levels if float(p) <= mid * (1 + bps / 10_000))
            return sum(price * qty for price, qty in selected)

        payload: dict[str, Any] = {
            "source": self.source,
            "exchange": self.exchange,
            "symbol": symbol,
            "retrieved_at": retrieved_at,
            "bid": bid,
            "ask": ask,
            "mid": mid,
            "spread_bps": (ask - bid) / mid * 10_000 if mid else None,
            "bid_depth_10bps_usdt": quote_depth(depth["bids"], "bid", 10),
            "ask_depth_10bps_usdt": quote_depth(depth["asks"], "ask", 10),
            "bid_depth_50bps_usdt": quote_depth(depth["bids"], "bid", 50),
            "ask_depth_50bps_usdt": quote_depth(depth["asks"], "ask", 50),
            "access": "public-read-only",
        }
        try:
            premium = _fetch_json("https://fapi.binance.com/fapi/v1/premiumIndex", {"symbol": exchange_symbol})
            oi = _fetch_json("https://fapi.binance.com/fapi/v1/openInterest", {"symbol": exchange_symbol})
            payload["derivatives"] = {
                "source": "Binance USD-M Futures public REST API",
                "funding_rate": float(premium["lastFundingRate"]),
                "next_funding_time": iso_utc(datetime.fromtimestamp(int(premium["nextFundingTime"]) / 1000, tz=UTC)),
                "mark_price": float(premium["markPrice"]),
                "open_interest_base_units": float(oi["openInterest"]),
                "timestamp": iso_utc(datetime.fromtimestamp(int(oi["time"]) / 1000, tz=UTC)),
            }
        except (MarketDataError, KeyError, TypeError, ValueError) as exc:
            payload["derivatives_unavailable"] = str(exc)
        return payload

    def fetch_eur_usdt(self) -> dict[str, Any]:
        result = self._get("/api/v3/ticker/price", {"symbol": "EURUSDT"})
        return {
            "source": self.source,
            "exchange": self.exchange,
            "symbol": "EUR/USDT",
            "retrieved_at": iso_utc(),
            "usdt_per_eur": float(result["price"]),
            "methodology": "Divide USDT values by EUR/USDT spot price to obtain EUR values.",
            "access": "public-read-only",
        }


class KrakenPublicProvider(PublicMarketDataProvider):
    exchange = "Kraken Spot"
    source = "Kraken public REST API"
    _base = "https://api.kraken.com/0/public"
    _pairs = {"BTC/USDT": "XBTUSDT", "ETH/USDT": "ETHUSDT", "SOL/USDT": "SOLUSDT"}

    def fetch_ohlcv(self, symbol: str, timeframe: str, limit: int) -> tuple[pd.DataFrame, dict[str, Any]]:
        if symbol not in self._pairs or timeframe not in TIMEFRAME_TO_KRAKEN_MINUTES:
            raise ValueError(f"Unsupported Kraken pair/timeframe: {symbol} {timeframe}")
        now = utc_now()
        seconds = TIMEFRAME_SECONDS[timeframe]
        since = int(now.timestamp()) - min(limit + 5, 720) * seconds
        payload = _fetch_json(
            self._base + "/OHLC",
            {"pair": self._pairs[symbol], "interval": TIMEFRAME_TO_KRAKEN_MINUTES[timeframe], "since": since},
        )
        if payload.get("error"):
            raise MarketDataError(f"Kraken error: {payload['error']}")
        result = payload["result"]
        key = next(k for k in result if k != "last")
        rows = result[key]
        columns = ["open_time_s", "open", "high", "low", "close", "vwap", "volume", "trades"]
        frame = pd.DataFrame(rows, columns=columns)
        frame["timestamp"] = pd.to_datetime(frame["open_time_s"].astype("int64"), unit="s", utc=True)
        frame["close_time"] = frame["timestamp"] + pd.to_timedelta(seconds, unit="s") - pd.to_timedelta(1, unit="ms")
        frame = frame[frame["close_time"] < pd.Timestamp(now)].tail(limit).copy()
        for col in ["open", "high", "low", "close", "volume", "vwap"]:
            frame[col] = frame[col].astype(float)
        frame["trades"] = frame["trades"].astype(int)
        frame["quote_volume"] = frame["volume"] * frame["vwap"]
        frame = frame.set_index("timestamp")
        frame = frame[["open", "high", "low", "close", "volume", "close_time", "quote_volume", "trades"]]
        metadata = {
            "source": self.source,
            "exchange": self.exchange,
            "symbol": symbol,
            "exchange_symbol": self._pairs[symbol],
            "timeframe": timeframe,
            "retrieved_at": iso_utc(now),
            "exchange_server_time": iso_utc(now),
            "latest_closed_candle": iso_utc(frame["close_time"].iloc[-1].to_pydatetime()),
            "rows": len(frame),
            "endpoint": "/0/public/OHLC",
            "access": "public-read-only",
            "provider_history_limit": 720,
        }
        return frame, metadata

    def fetch_eur_usdt(self) -> dict[str, Any]:
        payload = _fetch_json(self._base + "/Ticker", {"pair": "EURUSDT"})
        if payload.get("error"):
            raise MarketDataError(f"Kraken EUR/USDT error: {payload['error']}")
        key = next(iter(payload["result"]))
        price = float(payload["result"][key]["c"][0])
        return {
            "source": self.source,
            "exchange": self.exchange,
            "symbol": "EUR/USDT",
            "retrieved_at": iso_utc(),
            "usdt_per_eur": price,
            "methodology": "Divide USDT values by EUR/USDT spot price to obtain EUR values.",
            "access": "public-read-only",
        }


def provider_by_name(name: str) -> PublicMarketDataProvider:
    normalized = name.strip().lower()
    if normalized == "binance":
        return BinancePublicProvider()
    if normalized == "kraken":
        return KrakenPublicProvider()
    raise ValueError(f"Unknown public provider: {name}")


def cache_paths(data_dir: Path, exchange_slug: str, symbol: str, timeframe: str) -> tuple[Path, Path]:
    root = data_dir / "market" / exchange_slug / symbol_slug(symbol)
    return root / f"{timeframe}.csv", root / f"{timeframe}.metadata.json"


def save_ohlcv_cache(
    data_dir: Path,
    provider: PublicMarketDataProvider,
    symbol: str,
    timeframe: str,
    frame: pd.DataFrame,
    metadata: dict[str, Any],
) -> tuple[Path, Path]:
    exchange_slug = provider.exchange.lower().replace(" ", "-")
    csv_path, metadata_path = cache_paths(data_dir, exchange_slug, symbol, timeframe)
    stored = frame.reset_index().copy()
    stored["source"] = metadata["source"]
    stored["exchange"] = metadata["exchange"]
    stored["symbol"] = symbol
    stored["timeframe"] = timeframe
    stored["retrieved_at"] = metadata["retrieved_at"]
    atomic_write_text(csv_path, stored.to_csv(index=False, lineterminator="\n"))
    metadata = {**metadata, "csv_sha256": sha256_file(csv_path), "cache_path": str(csv_path)}
    atomic_write_json(metadata_path, metadata)
    return csv_path, metadata_path


def read_ohlcv_cache(data_dir: Path, exchange_slug: str, symbol: str, timeframe: str) -> tuple[pd.DataFrame, dict[str, Any]]:
    csv_path, metadata_path = cache_paths(data_dir, exchange_slug, symbol, timeframe)
    if not csv_path.exists() or not metadata_path.exists():
        raise FileNotFoundError(f"Missing cached data for {symbol} {timeframe}: {csv_path}")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if sha256_file(csv_path) != metadata.get("csv_sha256"):
        raise MarketDataError(f"Cache hash mismatch: {csv_path}")
    frame = pd.read_csv(csv_path, parse_dates=["timestamp", "close_time"])
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True)
    frame["close_time"] = pd.to_datetime(frame["close_time"], utc=True)
    frame = frame.set_index("timestamp").sort_index()
    return frame, metadata


def fetch_and_cache_bundle(
    data_dir: Path,
    provider_name: str,
    universe: tuple[str, ...],
    timeframes: tuple[str, ...],
    bars_by_timeframe: dict[str, int],
) -> dict[str, Any]:
    provider = provider_by_name(provider_name)
    summary: dict[str, Any] = {"provider": provider_name, "retrieved_at": iso_utc(), "datasets": [], "errors": []}
    for symbol in universe:
        for timeframe in timeframes:
            try:
                frame, metadata = provider.fetch_ohlcv(symbol, timeframe, bars_by_timeframe[timeframe])
                csv_path, metadata_path = save_ohlcv_cache(data_dir, provider, symbol, timeframe, frame, metadata)
                summary["datasets"].append({
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "rows": len(frame),
                    "latest_closed_candle": metadata["latest_closed_candle"],
                    "csv": str(csv_path),
                    "metadata": str(metadata_path),
                })
            except Exception as exc:
                summary["errors"].append({"symbol": symbol, "timeframe": timeframe, "error": str(exc)})

    if isinstance(provider, BinancePublicProvider):
        snapshots: list[dict[str, Any]] = []
        for symbol in universe:
            try:
                snapshot = provider.fetch_microstructure(symbol)
                snapshots.append(snapshot)
                atomic_write_json(data_dir / "market" / "snapshots" / f"{symbol_slug(symbol)}.json", snapshot)
            except Exception as exc:
                summary["errors"].append({"symbol": symbol, "dataset": "microstructure", "error": str(exc)})
        summary["microstructure"] = snapshots
        try:
            fx = provider.fetch_eur_usdt()
            atomic_write_json(data_dir / "market" / "fx_eurusdt.json", fx)
            summary["fx"] = fx
        except Exception as exc:
            summary["errors"].append({"dataset": "EUR/USDT", "error": str(exc)})
    elif isinstance(provider, KrakenPublicProvider):
        try:
            fx = provider.fetch_eur_usdt()
            atomic_write_json(data_dir / "market" / "fx_eurusdt.json", fx)
            summary["fx"] = fx
        except Exception as exc:
            summary["errors"].append({"dataset": "EUR/USDT", "error": str(exc)})
    atomic_write_json(data_dir / "market" / "latest_fetch_summary.json", summary)
    return summary

# Data Sources

## Primary: Binance public APIs

- Spot OHLCV: `GET https://api.binance.com/api/v3/klines`
- Exchange clock: `GET /api/v3/time`
- Best bid/ask: `GET /api/v3/ticker/bookTicker`
- Order-book depth: `GET /api/v3/depth`
- EUR/USDT conversion: `GET /api/v3/ticker/price?symbol=EURUSDT`
- Optional funding/mark: `GET https://fapi.binance.com/fapi/v1/premiumIndex`
- Optional open interest: `GET https://fapi.binance.com/fapi/v1/openInterest`

All routes are unauthenticated and read-only. The system removes any candle whose exchange close time is not earlier than exchange server time.

## Fallback: Kraken public APIs

- OHLCV: `GET https://api.kraken.com/0/public/OHLC`
- EUR/USDT conversion: `GET /0/public/Ticker?pair=EURUSDT`

Kraken returns a shorter recent history (documented as 720 bars in cache metadata), so sample-size and regime coverage may be weaker. A run uses one venue consistently; it does not silently splice providers.

## Universe and timeframes

- BTC/USDT, ETH/USDT, SOL/USDT
- 15m, 1h, 4h, 1d

## Provenance and cache

Every CSV row repeats source, exchange, symbol, timeframe, and retrieval time. The companion metadata records endpoint, exchange server time, latest closed candle, access class, row count, path, and SHA-256. Hash mismatches fail before analysis.

No candle is interpolated or synthesized. A missing candle, duplicate, impossible OHLC relationship, negative price/volume, zero-volume anomaly, stale series, non-UTC timestamp, or incomplete candle fails validation.

## Currency conversion

The paper ledger is in EUR. Current USDT amounts are divided by a time-stamped EUR/USDT spot price. Backtests use that rate as a constant conversion for position accounting. This omits historical FX variation and is disclosed in reports; percentage returns are unaffected by a constant unit conversion.

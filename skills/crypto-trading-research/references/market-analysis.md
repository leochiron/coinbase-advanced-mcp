# Market Analysis

## Data evidence

Use only cached datasets whose current validation result is `PASS`. Record the provider, exchange, symbol, timeframe, retrieval time, latest closed candle, and SHA-256. Never treat the current open candle as closed.

## Required top-down order

1. `1d`: macro directional structure.
2. `4h`: swing trend, volatility, and important levels.
3. `1h`: setup context for validated strategies.
4. `15m`: entry refinement only.

## Required indicators

Calculate EMA20, EMA50, EMA200, RSI14, MACD12/26/9, ATR14, Bollinger 20/2 bands, volume MA20, Donchian 20 channels, ADX14, rate of change, and realized volatility. Interpret correlated indicators as one body of evidence, not independent votes.

## Regime and structure

Classify trend as strong bullish, bullish, neutral, bearish, or strong bearish. Classify volatility as low, normal, elevated, or extreme using ATR percentile. State momentum, volume relative to average, higher-high/higher-low or lower-high/lower-low structure, support, resistance, breakout, and breakdown levels.

Use public order-book spread/depth, funding, and open interest only when retrieved successfully and time-stamped. Their absence is not permission to fabricate context.

## Cross-asset review

Compare 24-hour and seven-day relative strength, realized volatility, setup quality, and rolling return correlation. Treat strongly correlated BTC, ETH, and SOL signals as one crypto-beta risk cluster when applying portfolio exposure.

## Output order

For each asset report data quality, daily structure, 4H structure, 1H context, 15M refinement, regime, then strategy matching. The strategy must be eligible before its current signal is examined.

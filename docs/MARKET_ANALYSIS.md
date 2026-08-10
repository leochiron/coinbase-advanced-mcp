# Current Market Analysis Procedure

Run `python -m crypto_research.cli analyze` only after public data validates and baseline evaluation exists.

For BTC/USDT, ETH/USDT, and SOL/USDT, the generated report follows this order:

1. Data quality: exchange, source, latest closed candles, timeframes, hashes, status.
2. Daily structure: trend, structure, support/resistance, EMA position, RSI, MACD, ATR/volatility, volume.
3. 4H structure: swing direction, momentum, levels, range/breakout, volume.
4. 1H context: eligible setup context.
5. 15M refinement: entry timing only.
6. Regime: trend, volatility, momentum, structure.
7. Strategy match: only historically eligible strategies, followed by the current exact signal.

The cross-asset section compares relative strength, volatility, and 1H return correlation. The final result is `LONG`, `SHORT`, or `NO TRADE`; the initial spot/no-leverage system cannot propose a short. A lower timeframe cannot override a bearish higher-timeframe contradiction.

The current output is `reports/MARKET_ANALYSIS.md`, with full machine evidence in `reports/current_market_analysis.json`.

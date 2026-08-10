# Backtesting and Validation

## Execution model

Signals are generated from completed candle `t` and can fill only at candle `t+1` open. Entry and exit prices are moved adversely for half-spread plus slippage, and fees are charged on both sides. Stops and targets use later high/low information only after entry; if both are touched in one bar, the stop wins.

Position size is stop-risk based and capped at 25% notional. A 10% strategy-equity drawdown prevents new entries while existing risk is managed.

## Splits

Data is divided chronologically into 60% train, 20% validation, and 20% untouched test with indicator warm-up history. No shuffling occurs. Reports keep each segment separate.

## Robustness

Every asset/timeframe/strategy candidate receives:

- four nearby parameter variants;
- base, high, and severe costs;
- a one-bar additional entry delay;
- three chronological walk-forward OOS folds;
- 1,000 seeded Monte Carlo trade-sequence resamples;
- entry-regime attribution;
- asset and timeframe dependency checks.

## Metrics

Total return, CAGR/annualized return, Sharpe, Sortino, maximum drawdown, profit factor, win rate, average winner/loser, expectancy, trades, market exposure, average holding hours, and fees are reported. Annualization uses the actual timeframe and 365.25-day crypto calendar.

## Acceptance gate

The frozen thresholds are in `config/research.json` and detailed in `skills/crypto-trading-research/references/strategy-validation.md`. Results cannot relax them. A candidate that passes locally is still ineligible unless its strategy family passes on at least two assets.

Run:

```powershell
python -m crypto_research.cli backtest
python skills/crypto-trading-research/scripts/rank_strategies.py
```

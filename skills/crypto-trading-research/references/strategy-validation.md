# Strategy Validation

## Hypothesis contract

State the hypothesis, market behavior, exact entry/exit/stop/invalidation rules, expected failure mode, parameters, and test before reading results.

## Bias controls

- Split chronologically: 60% train, 20% validation, 20% untouched test.
- Never shuffle a time series.
- Generate a signal from a closed candle and fill at the next candle open.
- If stop and target both touch in one OHLC bar, assume the stop occurred first.
- Use prior-window Donchian levels and past/current indicator inputs only.
- Charge fees, spread, and slippage on entry and exit.

## Robustness suite

Run nearby parameter variants, higher and severe transaction costs, one-bar delayed entry, three chronological walk-forward OOS folds, 1,000 deterministic Monte Carlo trade-sequence resamples, all three assets, all four configured timeframes, and entry-regime attribution.

## Frozen acceptance gate

A candidate passes only when every condition is true:

- OOS expectancy > €0 after base costs.
- OOS profit factor > 1.05.
- At least eight OOS trades.
- OOS maximum drawdown ≤ 10%.
- At least 60% of nearby parameter variants have positive expectancy and PF > 1.
- At least 50% of walk-forward folds have positive expectancy and PF > 1.
- High-cost OOS expectancy remains positive and profit factor ≥ 1.
- Chronological validation expectancy is positive and PF > 1.
- The strategy obtains a preliminary pass on at least two of BTC, ETH, and SOL.

Do not change these thresholds after seeing results. A passing individual asset/timeframe remains ineligible when the strategy family lacks two-asset robustness.

## Ranking priorities

Weight robustness, OOS quality, drawdown, risk-adjusted return, profit factor, expectancy, and absolute return in that order. Penalize low trade count, parameter collapse, cost fragility, excessive exposure, and single-asset/timeframe dependence.

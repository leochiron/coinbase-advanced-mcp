# Research Workflow

## Safety gate

Confirm the project remains `PAPER_ANALYSIS_ONLY`. Public, unauthenticated market-data reads are allowed. Real orders, cancellations, exchange credentials, signing, transfers, withdrawals, wallet access, and live-mode switches are prohibited.

## End-to-end procedure

1. Inspect `config/research.json` and record the unchanged acceptance thresholds and cost scenarios.
2. Fetch public market data. Preserve source, exchange, symbol, timeframe, candle timestamps, retrieval time, and cache hash.
3. Validate every dataset. Stop the affected analysis for a gap, duplicate, inconsistent interval, impossible candle, zero volume, non-UTC timestamp, stale series, or incomplete candle.
4. Analyze 1D → 4H → 1H → 15M. The lower timeframe may refine entry timing but cannot override a higher-timeframe contradiction.
5. Classify trend, volatility, momentum, volume, and structure before inspecting strategy signals.
6. Define a falsifiable hypothesis, behavioral reason, exact rules, expected failure mode, and planned test.
7. Run chronological train/validation/test evaluation, never shuffled. Execute signals at the next bar open.
8. Charge fee, half-spread, and adverse slippage on both sides.
9. Run parameter, cost, delay, walk-forward, Monte Carlo, asset, timeframe, and regime checks.
10. Rank by robustness and OOS quality before return. Apply the frozen gate.
11. Match only eligible strategies to current conditions.
12. Apply risk policy, size from stop distance, and produce either a paper proposal or `NO TRADE`.
13. Log the experiment and leave the paper portfolio unchanged unless an explicit simulated fill is separately requested.

## Commands

```powershell
python -m crypto_research.cli run-all
python -m pytest
python skills/crypto-trading-research/scripts/validate_data.py
python skills/crypto-trading-research/scripts/evaluate_strategy.py --strategy ema-trend --symbol BTC/USDT --timeframe 1h
python skills/crypto-trading-research/scripts/rank_strategies.py
```

## Failure behavior

- Data failure: stop, report the exact dataset and defect.
- Provider failure: try the alternate configured public provider; do not combine unaligned venues silently.
- Insufficient sample: reject or label the candidate; do not lower trade-count requirements.
- Strategy disagreement: prefer `NO TRADE`.
- Risk or drawdown breach: mark `RISK_HALT` and require human review.

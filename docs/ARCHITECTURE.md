# Python Research Subsystem Architecture

This document describes only the Python research subsystem added in v2. The
existing TypeScript Coinbase MCP, its authenticated tools, and its guarded
execution workflow remain documented in `README.md`, `docs/AI_PROJECT_CONTEXT.md`,
and `docs/V2_INTEGRATION.md`.

## Components

```text
Public GET-only providers
        |
market_data.py -> CSV + provenance + SHA-256
        |
validation.py (fail closed)
        |
indicators.py -> regime.py
        |
strategies.py -> backtest.py
        |
evaluation.py (splits, robustness, gate, rank)
        |
analysis.py (top-down match and decision)
        |
risk.py -> portfolio.py (paper only)
```

`config.py` loads the frozen costs, risk policy, universe, timeframes, and acceptance thresholds. `cli.py` orchestrates phases without exposing exchange execution.

## Storage

- Immutable-at-analysis input: cached market CSV plus metadata hash.
- Quality evidence: `data/quality/`.
- Append-only experiments: `data/research/experiments.jsonl`.
- Detailed results and reader reports: `reports/`.
- Paper state: `data/paper-portfolio/portfolio.json` plus append-only `ledger.jsonl`.
- TypeScript `data/audit.sqlite`: owned by the Coinbase MCP and deliberately
  isolated from Python research and paper events.

## Key controls

- Provider clients implement only public reads.
- Every stored row carries source, exchange, symbol, timeframe, and retrieval timestamp; metadata adds latest close and SHA-256.
- Validation rejects gaps, duplicates, bad intervals, impossible candles, zero volume, timezone defects, staleness, and open candles.
- Indicators use rolling/expanding past and current values only.
- Signals fill at the next open; ambiguous stop/target bars resolve against the strategy.
- Cost, sensitivity, delay, walk-forward, Monte Carlo, regime, asset, and timeframe results are retained.
- Eligibility gates strategy matching. Risk sizing gates proposals. Proposals cannot mutate positions.

---
name: crypto-trading-research
description: Run auditable cryptocurrency market research, public OHLCV retrieval, data-quality checks, multi-timeframe regime analysis, rule-based strategy backtests, robustness validation, risk sizing, paper-portfolio accounting, and LONG/SHORT/NO TRADE decisions. Use for BTC/ETH/SOL research, strategy hypotheses, backtests, current-market analysis, risk review, or paper-trading proposals in this repository. Never use it for live execution, wallets, private keys, withdrawals, or real order placement.
---

# Crypto Trading Research

Treat this skill as the canonical trading-research workflow for this repository. Operate in `PAPER_ANALYSIS_ONLY` mode. Never add, request, load, or use exchange credentials, wallet secrets, withdrawal permissions, or live order routes.

## Canonical workflow

Follow every stage in order and stop the affected analysis when a gate fails:

```text
Market data
    ↓
Data validation
    ↓
Market regime detection
    ↓
Technical analysis
    ↓
Market structure analysis
    ↓
Strategy hypothesis
    ↓
Backtest
    ↓
Out-of-sample validation
    ↓
Robustness testing
    ↓
Risk validation
    ↓
Position sizing
    ↓
Trading proposal
    ↓
Paper portfolio
```

Read [research-workflow.md](references/research-workflow.md) before running the end-to-end workflow. Read the following reference when its stage is reached:

- [market-analysis.md](references/market-analysis.md) for data, regimes, structure, and top-down analysis.
- [strategy-validation.md](references/strategy-validation.md) for hypotheses, splits, backtests, robustness, ranking, and the fixed gate.
- [risk-policy.md](references/risk-policy.md) before sizing or making any decision.
- [portfolio-policy.md](references/portfolio-policy.md) before touching paper-portfolio state.

## Execution sequence

From the repository root:

```powershell
python -m crypto_research.cli fetch
python skills/crypto-trading-research/scripts/validate_data.py
python -m crypto_research.cli backtest
python -m crypto_research.cli analyze
```

Use `python -m crypto_research.cli run-all` for the same sequence with provider fallback. A validation failure must stop analysis; never fill, interpolate, or invent a candle to make a test run.

## Decision discipline

Require the strategy to predate the signal. Only match the current market to strategies marked `eligible` in `reports/strategy_evaluation.json`. Require compatible 1D/4H direction, a closed-candle signal, acceptable costs, and risk-compliant sizing.

Return only `LONG`, `SHORT`, or `NO TRADE`. Because initial research forbids leverage and the implemented portfolio is spot-long/paper-only, do not propose a short position. Prefer `NO TRADE` whenever evidence is incomplete, contradictory, stale, insufficiently robust, or outside the risk policy.

Do not assign numeric confidence probabilities. Use `LOW`, `MEDIUM`, or `HIGH` from measured robustness, out-of-sample evidence, regime compatibility, and multi-timeframe alignment.

## Reproducibility and audit

Preserve:

- market CSV and metadata hashes under `data/market/`;
- validation output under `data/quality/`;
- every accepted and rejected experiment in `data/research/experiments.jsonl`;
- leaderboard and detailed evidence under `reports/`;
- paper state and append-only events under `data/paper-portfolio/`.

Never delete negative experiments. Never modify acceptance thresholds after viewing results to make a strategy pass. Never treat a proposal as an open position.

## Bundled scripts

- `scripts/validate_data.py`: validate every cached dataset and fail nonzero on any quality problem.
- `scripts/evaluate_strategy.py`: evaluate one named strategy/asset/timeframe with the same fixed gate inputs.
- `scripts/rank_strategies.py`: render the ranking from the detailed evaluation artifact.

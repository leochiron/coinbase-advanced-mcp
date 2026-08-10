# Paper Portfolio Policy

Use only `data/paper-portfolio/portfolio.json` and the append-only `ledger.jsonl`. Confirm `mode` equals `PAPER_ANALYSIS_ONLY` before any operation.

The state must show cash, positions, average entry, marks, unrealized P&L, realized P&L, fees, equity, peak equity, drawdown, status, and the EUR/USDT conversion source/time.

A proposal is not a fill. `propose-long` records `PROPOSAL_ONLY` and must leave positions unchanged. Do not claim a position exists unless a separate, explicitly simulated fill event supplies a reproducible timestamp, reference price, fee, spread, slippage, and strategy rule.

Use `paper simulate-open-long` and `paper simulate-close-long` only for such explicit simulations. Both append full cost and fill evidence and have no connector or exchange route.

Mark open positions with validated current public prices. Calculate:

```text
unrealized_pnl = quantity × (mark_eur - average_entry_eur)
equity = cash + total_marked_position_value
drawdown = (peak_equity - equity) / peak_equity
```

At drawdown ≥ 10%, set `RISK_HALT`. Preserve every ledger event. Never edit a losing record to improve performance and never route a paper event to the legacy `executions` table.

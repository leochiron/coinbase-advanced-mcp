# Initial Repository Audit

Audit date: 2026-08-10 (Europe/Paris)

> Historical note: this records the standalone workspace exactly as it appeared
> before it was reattached to the existing `coinbase-advanced-mcp` GitHub
> history. The v1 TypeScript sources were subsequently restored from
> `origin/main` and are intentionally preserved in v2. This document is not a
> description of the current combined repository.

## Scope and method

The workspace was recursively inspected before project files or dependencies were created. The audit covered hidden files, instruction files, manifests, dependency files, environment-variable names, source code, tests, documentation, market-data providers, exchange integrations, backtesting, risk controls, and portfolio logic. The directory is not a Git repository.

## Existing architecture

There is no application architecture yet. The workspace contains two directories:

- `data/`
- `scripts/` (empty)

The only existing file is `data/audit.sqlite` (45,056 bytes). It contains five empty tables:

- `audit_log(id, action, status, payload_json, response_json, created_at)`
- `order_proposals(proposal_id, proposal_type, payload_json, created_at)`
- `order_dry_runs(dry_run_id, payload_json, created_at)`
- `executions(id, source_id, client_order_id, coinbase_order_id, payload_json, response_json, created_at)`
- `cancellations(id, order_id, response_json, created_at)`

All tables contained zero rows at audit time. The database is preserved unchanged.

No programming-language sources, framework, package manager, package manifest, dependency file, configuration system, `.env.example`, tests, `README`, `AGENTS.md`, `SKILL.md`, `.codex`, `.agents`, Docker files, or source-control metadata were present.

## Reusable components

`data/audit.sqlite` is a potentially useful historical audit-store schema. It is not used by the research system in the initial implementation because it exposes execution-oriented table names and has no migration history or owning code. Keeping it isolated avoids accidentally reactivating an unknown execution path. A future migration may import proposal and dry-run records after human review.

## Missing components

Everything required for an auditable research workflow is missing:

- public/read-only market-data acquisition and provenance;
- local data cache and quality gates;
- technical indicators and market-regime classification;
- reproducible baseline strategy definitions;
- look-ahead-safe backtesting and chronological splits;
- transaction-cost and robustness models;
- strategy ranking and a fixed acceptance gate;
- portfolio risk controls and position sizing;
- a persistent paper-trading ledger;
- research journaling and generated reports;
- automated tests, packaging, commands, and documentation;
- a project-scoped Codex orchestrator skill.

## Technical and safety risks

1. The existing database includes `executions` and `cancellations`, but there is no code explaining whether it was formerly connected to Coinbase. It must remain inert.
2. There is no version-control history, so prior behavior cannot be reconstructed.
3. Public exchange APIs can be unavailable, rate-limited, geographically restricted, or return an open candle. Providers and validation must fail closed.
4. Crypto histories are non-stationary and correlated; small out-of-sample trade counts can make attractive metrics meaningless.
5. Backtests are especially vulnerable to look-ahead bias, optimistic same-bar fills, omitted costs, and parameter selection bias.
6. USD/USDT market prices must be converted consistently to the EUR paper-accounting currency.
7. External skill repositories include live CEX/DEX execution, private-key signing, and order broadcast capabilities. Those components are prohibited here.

## Integration plan

The project will use a Python 3.11+ `src/` package because the repository has no competing convention and Python has mature, transparent time-series tooling. The implementation will:

1. Add a read-only public market-data interface with cache metadata and provider provenance.
2. Reject incomplete, stale, duplicated, missing, or impossible candles before analysis.
3. Compute deterministic indicators and multi-timeframe regime/structure evidence.
4. Define six explicit baseline strategies and run next-bar, cost-aware backtests.
5. Preserve a chronological 60/20/20 split and evaluate robustness without relaxing a predeclared acceptance gate.
6. Enforce 1% trade risk, 25% single-asset exposure, 50% total exposure, three positions, 1x maximum leverage, and a 10% drawdown halt.
7. Persist research records and a EUR-denominated paper portfolio separately from the legacy database.
8. Expose only data, analysis, backtest, report, and paper-ledger commands. No live order API, credential field, withdrawal path, wallet/key handling, or exchange execution method will be implemented.
9. Add a project-scoped `crypto-trading-research` skill as the canonical workflow and document external concepts that were safely adapted rather than installing execution-capable skill packs.

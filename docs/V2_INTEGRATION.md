# V2 Integration Contract

## Purpose

V2 adds a Python research and decision engine without replacing the existing
TypeScript Coinbase MCP. Both runtimes remain independently testable and have
different authority.

## Ownership of responsibilities

| Concern                                    | Python research engine | TypeScript Coinbase MCP              |
| ------------------------------------------ | ---------------------- | ------------------------------------ |
| Public OHLCV and order-book research       | Owns                   | Does not consume by default          |
| Data-quality validation and provenance     | Owns                   | N/A                                  |
| Indicators, regimes, strategies, backtests | Owns                   | N/A                                  |
| Risk-sized research proposal               | Produces evidence only | May consume through a future adapter |
| Coinbase credentials and JWT signing       | Prohibited             | Owns                                 |
| Proposal/dry-run persistence               | No access              | Owns                                 |
| Paper and live order submission            | Prohibited             | Owns                                 |
| Cancellation and protection watcher        | Prohibited             | Owns                                 |
| Execution audit database                   | Must not mutate        | Owns                                 |

## Current integration state

The two runtimes coexist in one repository and do not call each other. The
Python CLI produces JSON/Markdown research artifacts and maintains a separate
EUR paper ledger. The TypeScript MCP preserves all v1 capabilities and safety
locks. This avoids creating an undocumented automatic path to live funds.

## Required contract for a future automation adapter

A future adapter may read a versioned Python proposal artifact, but it must not
call Coinbase directly. It must translate the evidence into the existing
TypeScript proposal model and pass through the same controls as any other
order:

1. require a fresh, closed-candle research timestamp and `PASS` data status;
2. require an eligible strategy and a non-null risk-valid proposal;
3. reject stale, duplicate, schema-invalid, or `NO TRADE` artifacts;
4. create a stored TypeScript proposal or dry-run before execution;
5. enforce configured risk limits and available-balance checks;
6. preserve idempotency, confirmation, secret redaction, and SQLite auditing;
7. expose a default-off automation switch and a local emergency stop;
8. never add withdrawal, transfer, send, payout, or wallet-export capability.

Unattended live execution is not implemented by the Python subsystem or by
this integration commit. It requires its own design review, threat model,
failure-mode tests, explicit operator opt-in, and deployment documentation.

## Test boundaries

- Python: `python -m pytest`
- TypeScript: `npm test`, `npm run build`, and `npm run lint`
- Research skill: run its validator and bundled evaluation scripts
- Integrated security review: confirm no Python credential or order route and
  confirm TypeScript live routes retain all pre-existing locks

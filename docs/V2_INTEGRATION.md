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

The Python CLI emits a strict `research_decision.v1.json` artifact after a
validated current-market analysis. A TypeScript bridge checks its schema,
freshness, closed-candle provenance, eligibility, sizing, and deduplication key,
then stores both a legacy proposal and an identical dry-run. In `PAPER` mode, a
separate automation service may route that stored payload only to the local
paper broker. It does not import or call the live execution service.

The original Python paper ledger remains independently testable. Automated v2
integration state belongs to the TypeScript audit database so every imported
artifact, simulated order, fill, and protection is traceable without mutating
the Python research history.

## Enforced automation-adapter contract

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

Unattended live execution is not implemented by the Python subsystem, bridge,
scheduler, or paper automation. It requires its own later design review, threat
model, failure-mode tests, explicit operator opt-in, and deployment
documentation.

## Test boundaries

- Python: `python -m pytest`
- TypeScript: `npm test`, `npm run build`, and `npm run lint`
- Research skill: run its validator and bundled evaluation scripts
- Integrated security review: confirm no Python credential or order route and
  confirm TypeScript live routes retain all pre-existing locks

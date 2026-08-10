# Research-to-Paper Automation

## Safety model

The automation introduced for lots 1–3 is paper-only:

```text
public Python research
  -> research_decision.v1.json
  -> strict TypeScript schema/freshness/deduplication checks
  -> stored TypeScript proposal + matching dry-run
  -> local PaperBroker only
  -> fills, protection, positions, audit and reports
```

It never calls `executeValidatedOrder` and has no live mode. The Python child
receives an allow-listed environment that excludes Coinbase keys, private keys,
tokens and generic password variables.

## Modes

- `OFF`: scheduler and cycles refuse to run. This is the default.
- `OBSERVE`: imports a valid `LONG` as a proposal and dry-run, but submits no
  paper order. `NO_TRADE` is audited normally.
- `PAPER`: performs the same import, then submits only to the local paper
  broker.

`COINBASE_TRADING_ENABLED` has no effect on this route.

## One cycle

After generating a current public-data artifact:

```powershell
$env:RESEARCH_AUTOMATION_MODE = "OBSERVE"
npm run research:once
```

Change the mode to `PAPER` only after inspecting observe-mode artifacts. The
runner consumes `reports/research_decision.v1.json` by default. Set
`RESEARCH_RUN_PIPELINE=true` if each scheduled candle cycle should first run the
full Python `run-all` workflow. That includes backtests and is intentionally
compute-intensive.

## Continuous mode

```powershell
$env:RESEARCH_AUTOMATION_MODE = "PAPER"
npm run research:daemon
```

The daemon works in closed 15-minute UTC buckets, persists the last completed
bucket in SQLite, writes `data/research-automation/heartbeat.json`, and uses an
exclusive scheduler lock. A restart resumes from persisted state; artifact
deduplication prevents a repeated strategy/signal-candle pair from creating a
second order.

## Circuit breakers

New entries stop when any of these conditions is true:

- local emergency-stop file exists;
- the research artifact declares risk halt;
- extreme volatility is present and its blocker is enabled;
- paper drawdown reaches 10%;
- configured daily realized paper loss is reached;
- configured daily or open-order count is reached;
- three consecutive automation failures require operator review.

Existing paper orders and protective exits are processed before new-entry
checks, so a halt does not disable risk reduction.

To arm the local emergency stop:

```powershell
New-Item -ItemType File -Path "data/research-automation/STOP" -Force
```

Inspect the heartbeat, audit and error first. Remove that exact file only after
the incident is understood. A future operator-status command should own the
reviewed reset of a three-failure halt.

## Paper execution model

The paper broker supports configurable fees, half-spread, adverse slippage,
deterministic partial fills, local TP/SL protection, position accounting and
daily/weekly reports under `reports/paper/`.

It is not order-book replay. Partial fills are deterministic, market fills use
configured adverse costs, and limit orders never fill worse than their limit.
These limitations must stay visible in performance reviews.

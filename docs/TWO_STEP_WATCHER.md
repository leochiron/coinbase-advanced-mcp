# Two-Step Watcher

The two-step watcher handles workflows that Coinbase cannot reliably express as one combined order:

1. Submit or monitor parent entry orders.
2. Poll Coinbase for fills.
3. For each newly filled base size, submit a protective `trigger_bracket_gtc` order.

This is useful when an entry order must be protected only after Coinbase confirms the actual filled size.

## Files

- `scripts/two-step-watcher.mjs`: local Node watcher.
- `scripts/two-step-watcher.config.example.json`: safe example config.
- `data/two-step-watcher.<strategyId>.status.json`: runtime state.
- `data/two-step-watcher.<strategyId>.log`: runtime log.

`data/` is intentionally ignored by Git.

## Build First

```bash
npm run build
```

The watcher imports compiled code from `dist/`.

## Dry-Run

Create a strategy config from the example and keep all live flags disabled:

```bash
Copy-Item scripts\two-step-watcher.config.example.json scripts\two-step-watcher.config.json
npm run watch:two-step -- --config scripts/two-step-watcher.config.json --dry-run --once
```

Dry-run mode never submits parent or protection orders. It writes state and log files so the workflow can be inspected.

## Live Parent Orders

To let the watcher submit parent orders from an existing proposal:

```json
{
    "executeParents": true,
    "parentConfirmationText": "CONFIRM_EXECUTE_ORDER",
    "proposalId": "proposal_..."
}
```

Each order must map to a proposal order with `orderIndex`.

## Live Protection Orders

To allow automatic protective orders after fills:

```json
{
    "liveProtectionEnabled": true,
    "protectionConfirmationText": "CONFIRM_EXECUTE_ORDER"
}
```

The watcher submits one protective order per newly filled delta. It rounds the protected size down to `baseIncrement`.

## Safety

- No withdrawals or transfers are implemented.
- Parent order submission requires explicit config confirmation.
- Protection order submission requires explicit config confirmation.
- State prevents duplicate protection for already protected filled size.
- Use `--once` for controlled manual polling.
- Re-check Coinbase order status before restarting a stale state file.

## Server PHP Guard

`server/coinbase-guard` is separate. It is for remote cron monitoring, cancellation of explicitly managed order ids, and backup protection for explicitly listed parent buy order ids. The Node watcher remains the richer local implementation for full two-step strategies, while the PHP guard is the lightweight server fallback.

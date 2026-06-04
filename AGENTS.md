# Codex Operating Notes

This project is a local MCP server for Coinbase Advanced Trade. It is designed for Codex local over MCP stdio.

## Current Project State

- Main transport: `stdio`
- HTTP transport: intentionally disabled placeholder
- Coinbase auth: CDP API key name + private key in `.env`
- Trading flag: controlled by `COINBASE_TRADING_ENABLED`
- Audit database: `./data/audit.sqlite`
- Secrets: never print `.env`, API keys, private keys, Bearer tokens, or full account ids

The server loads `.env` from the project root, even when `dist/index.js` is launched from another working directory.

## Required Commands

Run from the project root:

```bash
npm install
npm run build
npm test
npm run lint
```

Start MCP manually only for stdio protocol testing:

```bash
npm run dev
```

Do not expect `npm run dev` to provide an HTTP console. It waits for an MCP client over stdio.

## Codex MCP Configuration

Use an absolute path when the MCP client is configured from outside the project:

```json
{
    "mcpServers": {
        "coinbase-local": {
            "command": "node",
            "args": [
                "C:\\path\\to\\coinbase-advanced-mcp\\dist\\index.js"
            ],
            "env": {
                "MCP_TRANSPORT": "stdio"
            }
        }
    }
}
```

If the path changes on another computer, update only the `args` path.

## Safety Rules

- Never implement or expose withdrawals, transfers, sends, payouts, or equivalent tools.
- Never execute live orders unless `COINBASE_TRADING_ENABLED=true`.
- Live execution requires `confirmationText` exactly equal to `CONFIRM_EXECUTE_ORDER`.
- Live cancellation requires `confirmationText` exactly equal to `CONFIRM_CANCEL_ORDER`.
- Always create proposals or dry-runs before live execution.
- Every proposal, dry-run, execution, and cancellation must be audited in SQLite.
- Keep logs on stderr; stdout is reserved for MCP JSON-RPC.

## Paper Trading & Risk Limits

- `PAPER_TRADING_ENABLED=true` routes `execute_validated_order` / `cancel_validated_order` to a simulated, audited portfolio. It never calls Coinbase, does not require `COINBASE_TRADING_ENABLED`, and takes precedence over live trading when both are on. Confirmation (`CONFIRM_EXECUTE_ORDER`) and a stored proposal/dry-run are still required.
- Paper orders rest until `process_paper_orders` evaluates fills against live prices. Inspect with `get_paper_portfolio`; wipe/reseed with `reset_paper_portfolio` (`CONFIRM_RESET_PAPER`).
- Paper fills are simplified (order price + flat fee, no slippage/partials/bracket). Not a backtest.
- `RISK_LIMITS_ENABLED=true` with `MAX_DAILY_NOTIONAL>0` rejects a live order before sending when the projected executed notional for the UTC day would exceed the cap. Off by default.

## Useful First Checks

Ask the MCP:

- `get_server_status`
- `get_portfolio_snapshot` with `quoteCurrency: "EUR"`
- `get_order_history` with `source: "BOTH"`
- `get_audit_log`

`get_portfolio_snapshot` uses Coinbase Portfolio Breakdown when available, so it should be close to the Coinbase UI total. Small differences can happen because prices move between UI and API refreshes.

## Current Open Protective Stop Orders

Operational state (live order ids, sizes, and prices) is intentionally kept out of
this repository. Track open protective orders in a local, untracked note instead.

Before changing or cancelling any protective order, re-check its current status with
Coinbase first. Market movements may have filled, cancelled, or changed its relevance.

## Known Implementation Notes

- SEC1 Coinbase keys such as `-----BEGIN EC PRIVATE KEY-----` are normalized to PKCS#8 before JWT generation.
- JWT signing uses only the API path, not the query string.
- Coinbase size precision must respect product `base_increment`. Round sell sizes down, never up.
- ETH and SOL can include staked balances in Portfolio Breakdown that are not liquid and should not be assumed sellable through spot orders.

## Local Watcher Notes

- `scripts/two-step-watcher.mjs` is config-driven instead of hardcoded.
- Example config: `scripts/two-step-watcher.config.example.json`.
- Documentation: `docs/TWO_STEP_WATCHER.md`.
- npm command: `npm run watch:two-step`.
- `AUDIT_DATABASE_PATH` is resolved from the project root, not from the process working directory. This prevents watcher/audit drift when an agent starts the process from another folder.
- Use `scripts/check-coinbase-guard-status.ps1` to verify the PHP guard status URL without printing the status token.
- Dry-run smoke test passed with:

```bash
npm run watch:two-step -- --config scripts/two-step-watcher.config.example.json --dry-run --once
```

Important watcher behavior:

- Build first with `npm run build`; the watcher imports `dist/`.
- `executeParents=true` requires `parentConfirmationText: "CONFIRM_EXECUTE_ORDER"`.
- Automatic protection requires both `liveProtectionEnabled=true` and `protectionConfirmationText: "CONFIRM_EXECUTE_ORDER"`.
- Dry-run mode never sends Coinbase parent or protection orders.
- State/log files are written under `data/` and ignored by Git.
- The PHP `server/coinbase-guard` is separate and currently focused on remote cron cancellation of explicitly managed order ids, not Node two-step protection submission.

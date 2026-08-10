# Agent Operating Notes

## V2 Hybrid Boundary

This repository contains two complementary subsystems that must remain
separated at the execution boundary:

- The existing Node.js/TypeScript MCP owns Coinbase authentication, account
  reads, proposals, dry-runs, paper orders, audited execution, cancellation,
  and the two-step protection watcher. Preserve its existing confirmation and
  provenance locks.
- The Python `crypto_research` package owns public market-data retrieval,
  validation, indicators, regime classification, strategy backtests,
  robustness evaluation, risk sizing, and research decisions.

The Python subsystem is permanently analysis/paper-only and must never load
Coinbase credentials or call an order endpoint. A Python proposal is evidence
for the TypeScript workflow, not authorization to trade. Any bridge from a
research proposal to Coinbase must enter through the TypeScript proposal,
dry-run, risk-limit, confirmation, audit, and execution services. Do not bypass
those controls or silently enable unattended live execution.

For research work, treat `skills/crypto-trading-research/SKILL.md` as the
canonical workflow. Validate market data before analysis, preserve negative
experiments, and run `python -m pytest` plus
`python -m crypto_research.cli run-all` when current public data is required.

This project is a local-first MCP server for Coinbase Advanced Trade. It is built for Codex or another local AI client over MCP `stdio`, with strict confirmation gates for any live Coinbase action.

For onboarding a new user, follow [docs/AI_SETUP_GUIDE.md](docs/AI_SETUP_GUIDE.md). For fuller architecture and workflow context, read [docs/AI_PROJECT_CONTEXT.md](docs/AI_PROJECT_CONTEXT.md). Never read, print, summarize, or commit secrets.

## Project Purpose

The server lets an AI assistant:

- Read Coinbase accounts, products, tickers, portfolio snapshots, open orders, and order history.
- Run mechanical portfolio allocation analysis.
- Prepare proposals and dry-runs for market, limit, stop-limit, and bracket-style orders.
- Execute or cancel live Coinbase orders only after exact user confirmation.
- Audit proposals, dry-runs, executions, cancellations, paper trading events, and knowledge-source additions in SQLite.
- Rehearse orders in audited paper trading mode.
- Enforce an optional daily notional risk cap for live orders.
- Use an operator-curated knowledge base before analysis or order proposals.
- Support two-step protection workflows when Coinbase rejects entry + TP/SL as one payload.
- Deploy an optional PHP/cron guard for remote monitoring when the local machine is off.

It must never implement withdrawals, transfers, sends, payouts, or any equivalent movement of funds.

## Current Project State

- Main runtime: Node.js 20+ / TypeScript / ESM.
- Main MCP transport: `stdio`.
- HTTP transport: intentionally disabled placeholder.
- Coinbase API: Advanced Trade `/api/v3/brokerage`.
- Auth: CDP API key name + EC private key from `.env`.
- Trading switch: `COINBASE_TRADING_ENABLED`.
- Paper switch: `PAPER_TRADING_ENABLED`.
- Optional risk cap: `RISK_LIMITS_ENABLED` + `MAX_DAILY_NOTIONAL`.
- Audit DB: `data/audit.sqlite` by default.
- Knowledge sources: `knowledge/sources.json` by default, with `knowledge/sources.example.json` as the template.
- Remote guard: `server/coinbase-guard`, deployed separately to PHP hosting.

The server loads `.env` from the project root even if `dist/index.js` is launched from another working directory. `AUDIT_DATABASE_PATH` and `KNOWLEDGE_SOURCES_PATH` are resolved from the project root unless absolute.

## Secret Handling

Do not read or print:

- `.env`
- `server-ftp.env`
- `server-ssh.env`
- `server/coinbase-guard/config.local.php`
- `.history/.env_*`
- Coinbase API key names, private keys, Bearer tokens, cron tokens, status tokens, FTP passwords, or full account ids

If a command needs a secret, read it only in-process and report redacted results. Do not echo the secret in terminal output or final messages.

## Required Commands

Run from the project root:

```bash
npm install
npm run build
npm test
npm run lint
```

If the native SQLite module fails after a Node version change:

```bash
npm rebuild better-sqlite3
```

Manual MCP start:

```bash
npm run dev
```

`npm run dev` starts an MCP stdio server. It is not an HTTP console. Stdout must stay reserved for MCP JSON-RPC; logs go to stderr.

## MCP Configuration

Use an absolute compiled path when configuring Codex or another MCP client from outside the repo:

```json
{
    "mcpServers": {
        "coinbase-local": {
            "command": "node",
            "args": ["C:\\path\\to\\coinbase-advanced-mcp\\dist\\index.js"],
            "env": {
                "MCP_TRANSPORT": "stdio"
            }
        }
    }
}
```

If the project moves to another computer, update only the absolute `dist/index.js` path and rebuild.

## Registered MCP Tools

Core live/read tools:

- `get_server_status`
- `get_coinbase_accounts`
- `get_coinbase_products`
- `get_product_ticker`
- `get_portfolio_snapshot`
- `analyze_portfolio_allocation`
- `propose_limit_orders`
- `propose_stop_limit_orders`
- `create_order_dry_run`
- `execute_validated_order`
- `list_open_orders`
- `cancel_validated_order`
- `get_order_history`
- `get_audit_log`

Paper trading tools:

- `get_paper_portfolio`
- `process_paper_orders`
- `reset_paper_portfolio`

Knowledge tools:

- `get_knowledge_base`
- `add_knowledge_source`

`get_server_status` reports Coinbase configuration, trading mode, paper mode, risk limits, audit availability, and knowledge-base availability. It must not expose secrets.

## Confirmation And Safety Rules

- Never execute live orders unless `COINBASE_TRADING_ENABLED=true`.
- Never execute any order from natural language like "go" alone.
- Live execution requires a saved `proposalId` or `dryRunId` and `confirmationText` exactly equal to `CONFIRM_EXECUTE_ORDER`.
- Live cancellation requires `confirmationText` exactly equal to `CONFIRM_CANCEL_ORDER`.
- Knowledge source writes require `confirmationText` exactly equal to `CONFIRM_ADD_SOURCE`.
- Paper reset requires `confirmationText` exactly equal to `CONFIRM_RESET_PAPER`.
- Always create a proposal or dry-run before live execution.
- Always re-check Coinbase order state before cancellation and after execution/cancellation.
- Always audit proposals, dry-runs, executions, cancellations, paper events, and knowledge-source additions.
- Keep logs on stderr; stdout is reserved for MCP JSON-RPC.

## Knowledge Base

The newest in-progress feature is the operator-curated knowledge registry.

Files:

- `knowledge/sources.example.json`: committed template.
- `knowledge/sources.json`: runtime/user-curated file, gitignored.
- `src/services/knowledgeService.ts`: schema, read/write logic, audit.
- `src/tools/getKnowledgeBase.ts`: returns enabled validated sources.
- `src/tools/addKnowledgeSource.ts`: appends one source after `CONFIRM_ADD_SOURCE`.

Environment:

```text
KNOWLEDGE_SOURCES_PATH=./knowledge/sources.json
```

Rules for agents:

- Call `get_knowledge_base` before portfolio analysis or order proposals.
- Ground reasoning in enabled operator-approved sources when available.
- If the knowledge file is missing, tell the user to copy `knowledge/sources.example.json` to `knowledge/sources.json` and curate real sources.
- Never add sources automatically.
- Propose a source first, explain why it is useful, then wait for `CONFIRM_ADD_SOURCE`.
- Source types are `url`, `dataset`, `principle`, and `document`; trust levels are `high`, `medium`, and `low`.
- The knowledge base is not a secret store. Do not put API keys, account ids, tokens, or private notes that should remain confidential in it.

## Paper Trading And Risk Limits

Recent committed work added audited paper trading and an optional daily notional limit.

Paper mode:

- Enable with `PAPER_TRADING_ENABLED=true`.
- Takes precedence over live trading if both paper and live are enabled.
- `execute_validated_order` and `cancel_validated_order` operate on the simulated portfolio and never call Coinbase.
- Still requires stored proposal/dry-run plus exact confirmation.
- `process_paper_orders` evaluates resting simulated orders against live prices.
- `reset_paper_portfolio` requires `CONFIRM_RESET_PAPER`.
- Paper fills are simplified: no slippage, partial fills, order-book depth, or full bracket simulation.

Risk limits:

- Enable with `RISK_LIMITS_ENABLED=true`.
- Set `MAX_DAILY_NOTIONAL` to a positive amount.
- The check uses audited executed notional for the UTC day.
- If the projected daily notional exceeds the cap, `execute_validated_order` rejects before sending to Coinbase.
- Off by default to preserve user control over strategic risk.

## Order Model And Coinbase Gotchas

Internal order types:

- `MARKET`
- `LIMIT`
- `STOP_LIMIT`
- `BRACKET`

Important validation rules:

- Product ids must look like `BTC-EUR`.
- Numeric fields are positive decimal strings without scientific notation.
- `MARKET` and `LIMIT` require exactly one of `baseSize` or `quoteSize`.
- `STOP_LIMIT` requires `baseSize`, `stopPrice`, `limitPrice`, and `GTC`.
- `BRACKET` requires `baseSize`, `limitPrice`, and `stopPrice`.
- Attached TP/SL requires both `takeProfitPrice` and `stopLossPrice`.
- Attached TP/SL is supported by the local model only for GTC.

Observed Coinbase behavior:

- Coinbase accepted LIMIT BUY orders with attached TP/SL.
- Coinbase accepted separate SELL BRACKET protection orders.
- Coinbase rejected BUY STOP_LIMIT orders with attached TP/SL with `PREVIEW_INVALID_ORDER_TYPE_FOR_ATTACHED`.
- Therefore a rebound-confirmation workflow often needs two steps: submit BUY STOP_LIMIT first, then submit a protective SELL BRACKET after Coinbase confirms a fill.
- Product increments matter. Respect `base_increment`, `quote_increment`, and price increments. Round sell size down, never up.
- Portfolio Breakdown can include staked ETH/SOL that is not liquid spot inventory.

## Two-Step Watcher

Files:

- `scripts/two-step-watcher.mjs`
- `scripts/two-step-watcher.config.example.json`
- `docs/TWO_STEP_WATCHER.md`

Purpose:

1. Submit or monitor parent entry orders.
2. Poll Coinbase for fills.
3. Submit protective `trigger_bracket_gtc` sell orders for newly filled size.

Rules:

- Build first with `npm run build`; the watcher imports `dist/`.
- Use `--dry-run --once` for smoke tests.
- `executeParents=true` requires `parentConfirmationText: "CONFIRM_EXECUTE_ORDER"`.
- `liveProtectionEnabled=true` requires `protectionConfirmationText: "CONFIRM_EXECUTE_ORDER"`.
- State/log files are written under `data/` and ignored by Git.
- State prevents duplicate protection for already protected filled size.

## Remote PHP Guard

Folder:

- `server/coinbase-guard`

Purpose:

- Lightweight PHP/cron fallback for when the local machine is off.
- Manages only explicitly listed Coinbase order ids.
- Can cancel matching open orders according to configured rules.
- Can watch explicitly listed parent buy orders and submit a backup sell bracket after a fill.
- Can email configured notifications.

Deployment helpers:

- `scripts/create-server-guard-config.mjs`
- `scripts/deploy-coinbase-guard.ps1`
- `scripts/check-coinbase-guard-status.ps1`

Rules:

- Do not print `config.local.php`.
- Do not upload `config.local.php` unless the user intentionally wants the server armed with that key.
- `cron.php` and `status.php` require private tokens.
- `.htaccess` blocks config, state, README, and library files from public browsing.
- Live cancellation requires `CONFIRM_CANCEL_ORDER` in server config.
- Live backup protection requires `CONFIRM_EXECUTE_ORDER` in server config.

## Recent Development Summary

Committed changes:

- Initial public release: MCP stdio server, Coinbase client/auth, portfolio/pricing/allocation/order/audit services, watcher, PHP guard, tests, and docs.
- Coinbase auth/client tests and the historical v1 MIT release.
- README license clarification for the historical release.
- Audited paper trading and optional daily notional risk limit.
- AI setup guide for onboarding new users.
- V2 adds a separate Python research and decision engine while preserving the
  TypeScript Coinbase runtime. The current tree uses PolyForm Strict
  1.0.0; older published MIT versions retain their original terms.

Uncommitted/in-progress changes visible in this workspace:

- Knowledge source registry (`knowledge/sources.example.json`, `KnowledgeService`, `get_knowledge_base`, `add_knowledge_source`).
- `KNOWLEDGE_SOURCES_PATH` environment variable.
- MCP server instructions now require consulting `get_knowledge_base` before analysis/orders.
- `get_server_status` now reports knowledge-base availability and enabled source count.
- Several tool files were touched to integrate the new context and may still need final review before commit.

When continuing the work, preserve user changes. This worktree may be dirty.

## Recommended Agent Procedure

1. Read this file and `docs/AI_PROJECT_CONTEXT.md`.
2. Avoid secret files.
3. Run `npm run build`, `npm test`, and `npm run lint` before claiming implementation success.
4. Ask MCP/live services for:
    - `get_server_status`
    - `get_knowledge_base`
    - `get_portfolio_snapshot` with `quoteCurrency: "EUR"`
    - `list_open_orders`
    - `get_order_history` with `source: "BOTH"` and a sufficient `limit`
    - `get_audit_log`
5. Re-check live Coinbase state before any trading recommendation or cancellation.
6. Explain every order in plain language before asking for confirmation.
7. Execute only after exact confirmation text.
8. Verify execution/cancellation with Coinbase and summarize order ids/statuses.
9. Treat all trading commentary as informational, not financial advice.

## Current Live Portfolio/Order State

Do not store live balances, open order ids, or strategy state in this public file. They go stale quickly and can expose personal trading data.

Always query Coinbase live state before acting:

```text
get_portfolio_snapshot quoteCurrency=EUR
list_open_orders
get_order_history source=BOTH limit=100
```

If a BUY STOP_LIMIT fills, it likely has no attached protection. Create a protective SELL BRACKET proposal/dry-run for the actual filled size, explain it, then execute only after `CONFIRM_EXECUTE_ORDER`.

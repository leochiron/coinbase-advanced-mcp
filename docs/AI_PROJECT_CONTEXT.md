# AI Project Context - Coinbase Local MCP

This document is a reusable context file for another AI assistant. It explains what this project is, how it works, what it must never do, and how to reason safely about the current Coinbase trading workflow.

Do not paste secrets into this document. Do not read or print `.env`, `server-ftp.env`, `server-ssh.env`, `server/coinbase-guard/config.local.php`, `.history/.env_*`, API keys, private keys, bearer tokens, status tokens, cron tokens, or full Coinbase account ids.

## 1. Project Summary

This project is a local Model Context Protocol server for Coinbase Advanced Trade.

Its main purpose is to let Codex or another local AI:

- Read Coinbase portfolio/account data.
- Read Coinbase products and market tickers.
- Analyse a portfolio mechanically.
- Prepare order proposals and dry-runs.
- Execute live orders only after explicit confirmation.
- Cancel live orders only after explicit confirmation.
- Audit proposals, dry-runs, executions, and cancellations in SQLite.
- Support two-step protection workflows when Coinbase cannot create entry + protection in one accepted order.
- Provide a separate lightweight PHP guard that can run on a remote web server/cron when the local computer is off.

The project is intentionally not a withdrawal, transfer, send, payout, or custody movement tool. It must never implement those actions.

## 2. Location And Runtime

Project root on this machine:

```text
C:\path\to\coinbase-advanced-mcp
```

Main runtime:

- Node.js + TypeScript.
- Package type: ESM.
- Main source entry: `src/index.ts`.
- Compiled entry: `dist/index.js`.
- Main transport: MCP over `stdio`.
- HTTP transport: present only as an intentionally disabled placeholder.
- Audit DB: `data/audit.sqlite` by default.

Required commands from project root:

```bash
npm install
npm run build
npm test
npm run lint
```

Manual dev start:

```bash
npm run dev
```

Important: `npm run dev` starts an MCP stdio server. It is not an HTTP console. Stdout must stay reserved for MCP JSON-RPC. Logs must go to stderr.

## 3. Environment And Secrets

Environment is loaded by `src/config/env.ts`.

The server loads `.env` from the project root even if `dist/index.js` is launched from another working directory. This matters when Codex or a scheduler starts the process from outside the repo.

Important environment variables:

```text
COINBASE_API_KEY_NAME
COINBASE_API_PRIVATE_KEY
COINBASE_API_BASE_URL=https://api.coinbase.com
COINBASE_TRADING_ENABLED=false|true
DEFAULT_QUOTE_CURRENCY=EUR
AUDIT_DATABASE_PATH=./data/audit.sqlite
MCP_TRANSPORT=stdio|http
MCP_HTTP_PORT=3333
LOG_LEVEL=info
```

Security rules:

- Never print `.env`.
- Never print Coinbase API key name, private key, bearer token, cron token, status token, or full account ids.
- Never commit secret files.
- Never expose transfer/withdrawal/send/payout functionality.
- Live trading must be disabled by default.

Implementation note: Coinbase SEC1 EC private keys such as `-----BEGIN EC PRIVATE KEY-----` are normalized to PKCS#8 before JWT generation.

## 4. Coinbase Client

Main file: `src/coinbase/coinbaseClient.ts`.

The client wraps Coinbase Advanced Trade `/api/v3/brokerage` endpoints:

- `listAccounts()`
- `listProducts()`
- `getProduct(productId)`
- `getProductTicker(productId)`
- `getOrder(orderId)`
- `listPortfolios()`
- `getPortfolioBreakdown(portfolioUuid, currency)`
- `createOrder(payload)`
- `listOrders(params)`
- `cancelOrders(orderIds)`

Auth:

- Uses Coinbase CDP API key name + private key.
- Generates a bearer token per request.
- JWT signing uses only the API path, not the query string.

Responses and errors are passed through redaction helpers so secrets are not surfaced.

## 5. MCP Tools

The MCP server is created in `src/server/mcpServer.ts`.

Registered tools:

```text
get_server_status
get_coinbase_accounts
get_coinbase_products
get_product_ticker
get_portfolio_snapshot
analyze_portfolio_allocation
propose_limit_orders
propose_stop_limit_orders
create_order_dry_run
execute_validated_order
list_open_orders
cancel_validated_order
get_order_history
get_audit_log
```

### Tool Intent

`get_server_status`

- Confirms server startup, transport, Coinbase configuration, trading flag, and audit DB availability.

`get_coinbase_accounts`

- Returns Coinbase accounts/balances.
- Must not expose full account ids to the user unless the code already redacts them appropriately.

`get_coinbase_products`

- Lists Coinbase products, optionally by quote currency/product type.

`get_product_ticker`

- Fetches ticker snapshot for one product such as `BTC-EUR`.

`get_portfolio_snapshot`

- Returns estimated portfolio value in a quote currency.
- Prefers Coinbase Portfolio Breakdown when available.
- Can include staked balances in portfolio breakdown. Staked ETH/SOL should not be assumed liquid or sellable through spot orders.

`analyze_portfolio_allocation`

- Mechanical allocation analysis against a target.
- Must not be treated as financial advice.

`propose_limit_orders`

- Builds one or more LIMIT order payloads and saves a proposal locally.
- Does not send anything to Coinbase.

`propose_stop_limit_orders`

- Builds one or more STOP_LIMIT order payloads and saves a proposal locally.
- Does not send anything to Coinbase.
- Stop direction is inferred from side:
  - SELL => stop down.
  - BUY => stop up.

`create_order_dry_run`

- Builds one complete order payload and saves it locally.
- Does not send anything to Coinbase.

`execute_validated_order`

- Sends a previously saved proposal order or dry-run to Coinbase.
- Requires `COINBASE_TRADING_ENABLED=true`.
- Requires `confirmationText` exactly equal to `CONFIRM_EXECUTE_ORDER`.
- Saves execution in SQLite.

`list_open_orders`

- Lists open/pending/queued Coinbase orders, optionally by product.

`cancel_validated_order`

- Cancels one live Coinbase order.
- Requires `COINBASE_TRADING_ENABLED=true`.
- Requires `confirmationText` exactly equal to `CONFIRM_CANCEL_ORDER`.
- Saves cancellation in SQLite.

`get_order_history`

- Reads Coinbase history, local audit history, or both.

`get_audit_log`

- Reads local audit log entries.

## 6. Order Model

Defined mainly by:

- `src/services/orderProposalService.ts`
- `src/services/orderExecutionService.ts`
- `src/utils/validators.ts`
- `src/coinbase/coinbaseTypes.ts`

Supported internal order types:

```text
MARKET
LIMIT
STOP_LIMIT
BRACKET
```

Supported sides:

```text
BUY
SELL
```

Supported time in force values:

```text
GTC
GTD
IOC
FOK
```

Important constraints:

- Numeric inputs are decimal strings, positive, no scientific notation.
- Product ids must look like `BTC-EUR`.
- MARKET and LIMIT require exactly one of `baseSize` or `quoteSize`.
- STOP_LIMIT requires `baseSize`, `stopPrice`, `limitPrice`, and GTC.
- BRACKET requires `baseSize`, `limitPrice`, and `stopPrice`.
- Attached TP/SL requires both `takeProfitPrice` and `stopLossPrice`.
- Attached TP/SL is supported only with GTC.

Payload mapping:

- MARKET => `market_market_ioc` or `market_market_fok`.
- LIMIT GTC => `limit_limit_gtc`.
- LIMIT IOC => `sor_limit_ioc`.
- LIMIT FOK => `limit_limit_fok`.
- STOP_LIMIT GTC => `stop_limit_stop_limit_gtc`.
- BRACKET => `trigger_bracket_gtc`.
- Attached TP/SL => `attached_order_configuration.trigger_bracket_gtc`.

Coinbase limitations observed in real use:

- Coinbase rejected BUY STOP_LIMIT orders with attached TP/SL (`PREVIEW_INVALID_ORDER_TYPE_FOR_ATTACHED`).
- Coinbase accepted LIMIT BUY orders with attached TP/SL.
- Coinbase accepted separate BRACKET SELL protection orders.
- Therefore, a "buy only if rebound confirms" flow often needs two steps: submit BUY STOP_LIMIT first, then submit protection after fill.

## 7. Safety And Confirmation Model

Live execution path:

1. Create proposal or dry-run.
2. User inspects proposal/dry-run.
3. Confirm exact text:

```text
CONFIRM_EXECUTE_ORDER
```

4. Call `execute_validated_order`.
5. Execution is audited in SQLite.

Live cancellation path:

1. Re-check live order status with Coinbase.
2. User confirms exact text:

```text
CONFIRM_CANCEL_ORDER
```

3. Call `cancel_validated_order`.
4. Cancellation is audited in SQLite.

Never execute or cancel from natural language like "go" alone. The exact confirmation text is required.

Never bypass the proposal/dry-run requirement. `execute_validated_order` must reference a saved `proposalId` or `dryRunId`.

## 8. Audit Database

Default path:

```text
data/audit.sqlite
```

Migrations in `src/storage/migrations.ts` create:

```text
audit_log
order_proposals
order_dry_runs
executions
cancellations
```

Purpose:

- Preserve every proposal.
- Preserve every dry-run.
- Preserve every live execution response.
- Preserve every cancellation response.
- Make trading actions traceable.

The audit DB is local runtime state, not a public source of truth for secrets.

## 9. Portfolio And Pricing Services

Portfolio service:

- File: `src/services/portfolioService.ts`.
- Uses Coinbase Portfolio Breakdown when possible.
- Falls back to accounts + products + ticker pricing.
- Computes:
  - quantity
  - available balance
  - hold balance
  - estimated price
  - estimated value
  - portfolio weight
  - valuation status

Pricing service:

- File: `src/services/pricingService.ts`.
- Can list products.
- Can fetch ticker.
- Can estimate an asset price against a quote currency.
- Uses product price first, then ticker trade/bid/ask fallback.

Important:

- Portfolio Breakdown can include staked positions.
- Spot sell orders should use liquid/available balances and open-order holds, not blindly the total portfolio breakdown.

## 10. Two-Step Watcher

Main files:

```text
scripts/two-step-watcher.mjs
scripts/two-step-watcher.config.example.json
docs/TWO_STEP_WATCHER.md
```

Purpose:

1. Submit or monitor parent entry orders.
2. Poll Coinbase for fills.
3. Submit protective `trigger_bracket_gtc` orders for newly filled size.

Use case:

- Coinbase cannot express a desired order as a single accepted payload.
- Example: BUY STOP_LIMIT entry plus automatic TP/SL protection.

Important behavior:

- Build first: `npm run build`.
- Watcher imports from `dist/`.
- State/log files are written under `data/`.
- `AUDIT_DATABASE_PATH` is resolved from the project root, avoiding audit drift if started from another folder.
- `--dry-run` never submits live parent or protection orders.
- `--once` performs one controlled polling pass.
- `executeParents=true` requires `parentConfirmationText: "CONFIRM_EXECUTE_ORDER"`.
- `liveProtectionEnabled=true` requires `protectionConfirmationText: "CONFIRM_EXECUTE_ORDER"`.
- State prevents duplicate protection for already protected filled size.

## 11. Remote PHP Guard

Folder:

```text
server/coinbase-guard
```

Purpose:

- Lightweight PHP/cron fallback for when the local computer is off.
- It manages only explicitly listed order ids.
- It can cancel matching open orders when a configured rule triggers.
- It can email the address configured in `config.local.php`.
- It can watch explicitly listed parent buy orders and submit a backup sell bracket after fill.

Important files:

```text
server/coinbase-guard/cron.php
server/coinbase-guard/status.php
server/coinbase-guard/lib/CoinbaseClient.php
server/coinbase-guard/lib/Guard.php
server/coinbase-guard/config.example.php
server/coinbase-guard/config.local.php
```

Do not print `config.local.php`.

Remote intended path:

```text
https://your-domain.example.com/mcp-coinbase/
```

Cron:

- Host cron should call `cron.php` every 10 minutes.
- `cron.php` requires a private token.
- `status.php` requires a private status token.

Safety:

- No withdrawals/transfers/sends/payouts.
- No automatic order discovery by default.
- Only listed order ids are managed.
- Live cancellation requires `CONFIRM_CANCEL_ORDER` in server config.
- Live backup protection requires `CONFIRM_EXECUTE_ORDER` in server config.
- `.htaccess` blocks local config and state files.

## 12. Current Trading Philosophy

The trading workflow used in recent sessions is not fully automated portfolio management. It is a human-approved, AI-assisted order workflow.

Core principles:

- Prefer protection over prediction.
- Avoid market buys during panic unless explicitly intended.
- Use cash as a shield during drawdowns.
- Re-enter through conditional orders if rebound confirms.
- Buy lower only in small protected ladder orders.
- Keep moonshot positions small and explicitly classified.
- Prefer stablecoin exits when reasonable for tax deferral, but do not force extra conversions if they add spread/complexity.

Common strategy patterns:

1. Protective stop/limit or bracket sells for existing spot positions.
2. BUY STOP_LIMIT for rebound confirmation.
3. LIMIT BUY with attached TP/SL for crash ladder entries.
4. Separate BRACKET SELL after a BUY STOP_LIMIT fill when Coinbase cannot attach TP/SL.
5. Split speculative moonshot exits into tranches.

## 13. Live Portfolio/Order State

Personal portfolio balances and live order ids are intentionally kept out of this
public repository. Always query the live state before acting, never assume an order
referenced anywhere in this document is still open:

```text
get_portfolio_snapshot quoteCurrency=EUR
list_open_orders
get_order_history source=BOTH limit=100
```

Any BUY STOP_LIMIT fill has no attached protection. If one fills, create a protective
SELL BRACKET dry-run/proposal for the actual filled size and execute it only after
explicit confirmation.

## 14. Recommended AI Operating Procedure

When another AI receives this project:

1. Read this file and `AGENTS.md`.
2. Do not read secret files.
3. Run from project root:

```bash
npm run build
npm test
npm run lint
```

4. Ask the MCP/read API for:

```text
get_server_status
get_portfolio_snapshot quoteCurrency=EUR
list_open_orders
get_order_history source=BOTH limit=100
get_audit_log
```

5. Re-check current Coinbase state before giving trading advice.
6. Never assume an order listed in this document is still open.
7. For any live order:
   - create proposal/dry-run first,
   - explain it,
   - wait for exact confirmation,
   - execute,
   - verify with Coinbase,
   - summarize order ids/statuses.
8. For any cancellation:
   - re-check order status,
   - wait for exact confirmation,
   - cancel,
   - verify status,
   - summarize.
9. Treat all trading suggestions as informational, not financial advice.
10. Distinguish clearly between:
    - protecting existing exposure,
    - buying a dip,
    - buying confirmed rebound,
    - speculative moonshot,
    - tax-aware stablecoin exit.

## 15. Known Practical Gotchas

- `better-sqlite3` can fail after Node version changes with a native ABI mismatch. Fix with:

```bash
npm rebuild better-sqlite3
```

- Coinbase can reject multiple statuses combined with `OPEN` in some list order calls. Use `orderStatus: ["OPEN"]` when necessary.
- Coinbase Portfolio Breakdown and Coinbase UI can differ slightly because prices move between refreshes.
- Product increments matter. Respect `base_increment`, `quote_increment`, and `price_increment`. Round sell size down, never up.
- Do not assume all portfolio assets are tradable against EUR. Some are USDC pairs or delisted on public exchange endpoints.
- Public Coinbase Exchange endpoints and Advanced Trade endpoints can disagree on product availability. Prefer authenticated Advanced Trade product data for actual order support.
- Existing `dist/` may be stale; build before running watcher or MCP from compiled files.
- Runtime files under `data/` are ignored by Git.

## 16. Short Prompt To Feed Another AI

Use this if a compact bootstrap prompt is needed:

```text
You are helping with a local Node/TypeScript MCP server for Coinbase Advanced Trade. Read docs/AI_PROJECT_CONTEXT.md and AGENTS.md first. Never read or print secrets. Never implement withdrawals/transfers/sends/payouts. Live execution requires an existing proposal/dry-run, COINBASE_TRADING_ENABLED=true, and exact confirmation text CONFIRM_EXECUTE_ORDER. Live cancellation requires exact CONFIRM_CANCEL_ORDER. Always audit, verify Coinbase status after actions, and treat trading output as informational rather than financial advice. Re-check live portfolio and open orders before acting.
```


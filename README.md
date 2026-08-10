# Coinbase Advanced MCP v2

> A **local-first**, safety-oriented crypto system combining a TypeScript
> [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for
> **Coinbase Advanced Trade** with an auditable Python research, backtesting,
> regime, risk, and decision engine.

![status](https://img.shields.io/badge/status-experimental-orange)
![node](https://img.shields.io/badge/node-%E2%89%A520.19-339933?logo=node.js&logoColor=white)
![language](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![research](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white)
![transport](https://img.shields.io/badge/MCP-stdio-blue)

> [!WARNING]
> This software can place **real orders with real money** when you explicitly enable it. It is experimental, provided **as-is with no warranty**, and is **not financial advice**. Read the [Disclaimer](#disclaimer) before using it. You are solely responsible for every order that reaches Coinbase.

> [!TIP]
> **Setting this up with an AI assistant?** Point it at [`docs/AI_SETUP_GUIDE.md`](docs/AI_SETUP_GUIDE.md) — a step-by-step onboarding script written for the AI to walk you through installing the server, creating and linking your Coinbase API key, rehearsing in paper mode, and (optionally) deploying the remote PHP guard.

---

## What it is

`coinbase-advanced-mcp` v2 keeps the Node.js + TypeScript server that exposes
Coinbase Advanced Trade as MCP tools and adds a separate Python research
subsystem. Any MCP-compatible client (Codex, Claude, etc.) can then, in natural
language:

- read accounts, balances, products, and live prices;
- take a portfolio snapshot and run a **mechanical** allocation/drift analysis;
- **prepare** limit / stop-limit / bracket orders as proposals or dry-runs (no network send);
- **execute** or **cancel** live orders — but only behind a triple-lock confirmation model;
- keep a complete **local SQLite audit trail** of everything it did.
- retrieve and validate public BTC, ETH, and SOL OHLCV across four timeframes;
- classify trend, momentum, volatility, and structure regimes;
- backtest six explicit strategy families with costs and chronological splits;
- reject weak strategies through sensitivity, walk-forward, Monte Carlo, and
  cross-asset gates;
- generate traceable `LONG` or `NO TRADE` research proposals with stop-risk
  sizing and EUR portfolio limits.

The v1 transport is `stdio` (the client launches the process and talks JSON-RPC over stdin/stdout). HTTP / Streamable HTTP is an intentionally inactive placeholder until the stdio version is fully validated.

It **does not** implement withdrawals, transfers, sends, payouts, or any equivalent capability — by design, and never will.

## Why this exists — the philosophy

Letting an AI agent touch a real trading account is genuinely risky. This project is built on the assumption that **the agent will eventually be wrong**, and that the software's job is to make a wrong call _cheap and reversible_ rather than catastrophic. The design principles:

- **Read by default, act only on purpose.** Trading is off (`COINBASE_TRADING_ENABLED=false`) until you flip it. The vast majority of tools are read-only.
- **Prepare ≠ send.** Proposals and dry-runs build real Coinbase payloads and store them, but never call the live API. You inspect exactly what _would_ be sent before anything is sent.
- **Protection over prediction.** The order model favours stop-limit and bracket protection, and a two-step watcher that only arms protection _after_ Coinbase confirms a real fill.
- **No silent power.** Every live action requires an exact confirmation phrase and must reference a previously stored proposal or dry-run. An agent cannot conjure an order out of thin air.
- **No exfiltration surface.** Withdrawals/transfers/sends are simply not implemented, so the worst-case blast radius is a bad _trade_, not a drained account.
- **Auditability.** Every proposal, dry-run, execution, and cancellation is written to a local SQLite database, with secrets redacted.
- **Mechanical, not advisory.** Allocation analysis is arithmetic on your balances. The server repeats, everywhere, that its output is _not_ personalized financial advice.

In short: v2 separates **decision intelligence** from **execution authority**.
The research engine can reject or propose; only the existing audited TypeScript
workflow can reach Coinbase. The current version remains human-approved and
does not silently convert a research signal into an unattended live order.

## Safety model

Every live action passes three independent locks:

1. **Global switch** — `COINBASE_TRADING_ENABLED=true` is required (default `false`).
2. **Exact confirmation** — `execute_validated_order` requires `confirmationText` exactly equal to `CONFIRM_EXECUTE_ORDER`; `cancel_validated_order` requires exactly `CONFIRM_CANCEL_ORDER`.
3. **Provenance** — every live order must reference an existing `proposalId` or `dryRunId` stored in the audit database.

Additional guarantees:

- Order proposals and dry-runs **never** send anything to Coinbase.
- No investment-size or risk-limit blocks are imposed beyond technical validation and confirmation — _you_ own the risk decisions.
- Secrets (API keys, private keys, Bearer tokens) are redacted before logging or storage.
- Recommended Coinbase key scopes: `view` for read-only, `view` + `trade` for execution. **Never enable `transfer`.**

To return to read-only mode at any time, set `COINBASE_TRADING_ENABLED=false` and restart.

## Tools

| Category     | Tool                                                                               | Sends to Coinbase? |
| ------------ | ---------------------------------------------------------------------------------- | ------------------ |
| Status       | `get_server_status`                                                                | No                 |
| Reads        | `get_coinbase_accounts`, `get_coinbase_products`, `get_product_ticker`             | Read               |
| Reads        | `get_portfolio_snapshot`, `list_open_orders`, `get_order_history`, `get_audit_log` | Read               |
| Analysis     | `analyze_portfolio_allocation`                                                     | Read               |
| Prepare      | `propose_limit_orders`, `propose_stop_limit_orders`, `create_order_dry_run`        | **No**             |
| Act (locked) | `execute_validated_order`, `cancel_validated_order`                                | **Live**           |
| Paper        | `get_paper_portfolio`, `process_paper_orders`, `reset_paper_portfolio`             | **No**             |
| Knowledge    | `get_knowledge_base`, `add_knowledge_source` (confirmed)                           | **No**             |

## Requirements

- Node.js `>=20.19.0`
- npm
- Python `>=3.11` for the research subsystem
- A Coinbase Advanced Trade CDP API key (from the [Coinbase Developer Platform](https://portal.cdp.coinbase.com/))

## Install

```bash
npm install
cp .env.example .env
```

Install the Python research subsystem on Windows:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.lock
.venv\Scripts\python -m pip install -e . --no-deps
```

Fill `.env`:

```bash
COINBASE_API_KEY_NAME=organizations/your-org-id/apiKeys/your-key-id
COINBASE_API_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----\n"
COINBASE_API_BASE_URL=https://api.coinbase.com
COINBASE_TRADING_ENABLED=false
DEFAULT_QUOTE_CURRENCY=EUR
AUDIT_DATABASE_PATH=./data/audit.sqlite
MCP_TRANSPORT=stdio
MCP_HTTP_PORT=3333
LOG_LEVEL=info
```

The server starts even if Coinbase keys are missing; Coinbase tools then return a clear configuration error. The private key must stay in `.env` or your process environment — **never commit it**. Newlines may be pasted as escaped `\n`; the server converts them back (and normalizes SEC1 EC keys to PKCS#8) before JWT signing.

## Commands

```bash
npm run dev     # start the MCP server over stdio (waits for an MCP client)
npm run build   # compile TypeScript to dist/
npm test        # run the vitest suite
npm run lint    # eslint
```

Research commands:

```powershell
.venv\Scripts\python -m pytest
.venv\Scripts\python -m crypto_research.cli fetch
.venv\Scripts\python -m crypto_research.cli validate
.venv\Scripts\python -m crypto_research.cli backtest
.venv\Scripts\python -m crypto_research.cli analyze
.venv\Scripts\python -m crypto_research.cli run-all
.venv\Scripts\python -m crypto_research.cli paper show
```

The research provider uses public, unauthenticated GET endpoints and does not
receive Coinbase credentials. Binance public data is the default, with Kraken
public data as the full-run fallback.

In stdio mode, **stdout is reserved for MCP JSON-RPC** — logs go to stderr only.

## Connect an MCP client (Codex example)

Build first (`npm run build`), then point the client at the compiled entrypoint:

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

Use an absolute `dist/index.js` path when the client is configured from another working directory. The server loads `.env` from its own project root regardless of where it is launched.

Expected status before live trading:

```json
{
    "serverStarted": true,
    "transport": "stdio",
    "coinbaseConfigured": true,
    "auditDatabaseAvailable": true
}
```

## Dry-run workflow

1. Ask the agent to prepare an order with `create_order_dry_run` or a proposal tool.
2. Inspect the returned payload and its `dryRunId` / `proposalId`.
3. Keep `COINBASE_TRADING_ENABLED=false` until you intentionally want live trading.
4. For live execution: set `COINBASE_TRADING_ENABLED=true`, restart the server, and call `execute_validated_order` with the confirmation phrase `CONFIRM_EXECUTE_ORDER`.

### Example prompts

```text
Use the local Coinbase MCP and fetch my portfolio snapshot in EUR.
Compare my portfolio to this target allocation: BTC 40%, ETH 30%, SOL 10%, USDC 20%.
Prepare limit orders to bring SOL down to 10% of the portfolio, without executing.
Create a dry-run to sell 20% of my ETH line with a limit order at <price>.
Execute dry-run X. Confirmation: CONFIRM_EXECUTE_ORDER.
List my open orders.
Cancel order Y. Confirmation: CONFIRM_CANCEL_ORDER.
```

## Knowledge base — your validated sources

The assistant should not reason from diffuse, unvetted knowledge. This feature gives it a **precise, operator-curated set of trusted sources** to consult before any analysis or order proposal.

- **You curate it, and it's your responsibility.** Before trading, copy `knowledge/sources.example.json` to `knowledge/sources.json` and fill it with sources _you_ trust (macro calendars, on-chain dashboards, methodology notes, personal risk principles, …). Choosing reliable sources is on you. The real file is **gitignored**; only the example template is committed.
- **The assistant consults it first.** The server instructions and the analysis/proposal tool descriptions tell the agent to call `get_knowledge_base` and ground its reasoning in your validated sources before proposing anything.
- **The assistant may propose, but never adds on its own.** It can suggest a new source, but `add_knowledge_source` only writes to the file when you supply the exact phrase `confirmationText: CONFIRM_ADD_SOURCE`. You stay in control of your information sources. Every addition is recorded in the audit log.
- **Removing a source** is a manual edit of `knowledge/sources.json` (delete its entry). Park a source without deleting it by setting `"enabled": false`.

Each source entry: `id`, `title`, `type` (`url` | `dataset` | `principle` | `document`), `url` (for `url`/`dataset`), `category`, `trust` (`high` | `medium` | `low`), `notes`, `enabled`, `addedBy`, `addedAt`. The schema is documented in `knowledge/sources.example.json`. The file location is configurable via `KNOWLEDGE_SOURCES_PATH`.

> [!NOTE]
> Curating sources does not make mechanical output financial advice, and the assistant can still misread a source. The sources improve grounding; they do not transfer responsibility (see the [Disclaimer](#disclaimer)).

## Paper trading

Paper mode lets you rehearse the **exact same workflow** (propose → dry-run → confirmed execute) against a **simulated, audited portfolio** that never touches Coinbase. It is the only simulation here that produces a full audit trail.

Enable it in `.env`:

```bash
PAPER_TRADING_ENABLED=true
PAPER_STARTING_CASH=10000   # seed cash when no Coinbase keys are present
PAPER_FEE_BPS=60            # simulated taker fee (0.60%)
```

How it works:

- **Seeding** — on first use, the paper portfolio is seeded from a real Coinbase snapshot when keys are configured, otherwise from `PAPER_STARTING_CASH` in your quote currency. Fully usable offline, with no API keys.
- **Resting orders + deferred fills** — `MARKET` orders fill immediately at the live ticker; `LIMIT` / `STOP_LIMIT` orders rest until you call `process_paper_orders`, which evaluates them against current prices and fills any that are triggered (limit-buy fills at/below the limit, stop-sell triggers at/below the stop, etc.).
- **Same locks** — `execute_validated_order` still requires `CONFIRM_EXECUTE_ORDER` and a stored proposal/dry-run, so paper is a faithful rehearsal of the live flow. It does **not** require `COINBASE_TRADING_ENABLED`, and if both paper and live are enabled, **paper wins**.
- **Audited** — submissions, fills, rejections, cancellations, seeding, and resets are all written to the audit log.

Tools: `get_paper_portfolio`, `process_paper_orders`, and `reset_paper_portfolio` (requires `CONFIRM_RESET_PAPER`).

> [!NOTE]
> Paper fills are a **simplified simulation**, not a backtest: fills happen at the order's stated price with a flat fee, with no slippage, partial fills, order-book depth, or attached TP/SL bracket modeling.

## Risk limits

An optional, **opt-in** guard for live orders, off by default so the project keeps its "you own the risk decisions" stance. v1 enforces a single rule — a maximum executed **notional per UTC day**, computed from the audit log:

```bash
RISK_LIMITS_ENABLED=true
MAX_DAILY_NOTIONAL=500   # reject a live order once today's executed notional would exceed this; 0 = unlimited
```

When enabled, `execute_validated_order` rejects an order **before anything is sent to Coinbase** if the projected daily notional would exceed the cap. It runs in addition to (not instead of) the triple-lock confirmation model.

## Two-step protection watcher

For workflows where Coinbase cannot reliably place entry + protection as one combined order, a local watcher can submit a parent order from a saved proposal, poll for fills, and submit a protective `trigger_bracket_gtc` order for the actually filled size:

```bash
npm run build
npm run watch:two-step -- --config scripts/two-step-watcher.config.example.json --dry-run --once
```

See [`docs/TWO_STEP_WATCHER.md`](docs/TWO_STEP_WATCHER.md) before enabling any live parent or protection flags. A separate, lightweight PHP/cron guard for remote monitoring lives under [`server/coinbase-guard/`](server/coinbase-guard/).

## V2 research and decision engine

The Python subsystem is intentionally independent of Coinbase authentication
and order transport. Its complete sequence is:

1. fetch closed public candles and record source, retrieval time, and hashes;
2. fail closed on missing, duplicated, stale, inconsistent, or impossible data;
3. compute indicators and daily → 4h → 1h → 15m regimes;
4. evaluate six deterministic long/flat strategy families;
5. run 60/20/20 chronological tests, parameter sensitivity, adverse costs,
   delayed entries, walk-forward windows, Monte Carlo, and asset robustness;
6. permit a proposal only after every fixed acceptance and portfolio-risk gate;
7. otherwise return an explicit `NO TRADE` decision with evidence and levels.

The research result is not a Coinbase order and never mutates the TypeScript
audit/execution database. Future automation must consume it through an explicit
adapter that creates a normal TypeScript proposal and preserves all configured
dry-run, risk, confirmation, audit, and emergency-stop controls.

Start with the project skill at
[`skills/crypto-trading-research/SKILL.md`](skills/crypto-trading-research/SKILL.md)
and the integration contract at
[`docs/V2_INTEGRATION.md`](docs/V2_INTEGRATION.md).

The first integrated automation milestone is documented in
[`docs/RESEARCH_AUTOMATION.md`](docs/RESEARCH_AUTOMATION.md). It adds a strict
Python-to-TypeScript proposal bridge, continuous closed-candle scheduling,
circuit breakers, and automatic **paper-only** execution. Compatibility and
rollback requirements are recorded in
[`docs/COMPATIBILITY_MATRIX.md`](docs/COMPATIBILITY_MATRIX.md) and
[`docs/RELEASE_STRATEGY.md`](docs/RELEASE_STRATEGY.md).

## Project structure

```
src/
  coinbase/    Coinbase Advanced Trade client, JWT auth, types, errors
  crypto_research/ Public-data research, indicators, regimes, backtests, risk
  config/      env loading & validation (zod)
  server/      MCP server wiring + stdio/http transports
  services/    portfolio, pricing, allocation, proposals, execution, audit
  storage/     SQLite database + migrations
  tools/       the MCP tool definitions
  utils/       validators, secret redaction, id/idempotency, logging
  tests/       vitest unit tests
docs/          architecture context & watcher docs
scripts/       two-step watcher + server guard helpers
server/        optional PHP/cron guard (separate deployment)
config/        fixed Python research universe, costs, gates, and risk policy
skills/        reusable crypto research workflow and validation scripts
tests/         Python research tests (TypeScript tests remain under src/tests)
pyproject.toml Python package and CLI metadata
```

Implementation notes: Coinbase order payloads use the Advanced Trade `/api/v3/brokerage` endpoints; JWT Bearer tokens are generated per request and signed over the API path only (not the query string); order sizes must respect each product's `base_increment` (sell sizes rounded **down**); staked balances (e.g. ETH/SOL) can appear in portfolio breakdowns but are not liquid spot inventory. Tests mock Coinbase and never call the live API.

## Disclaimer

This project is provided for educational and personal use, **as-is and without warranty of any kind**, express or implied, including but not limited to merchantability, fitness for a particular purpose, and non-infringement.

- **Not financial advice.** Nothing produced by this software — including allocation analysis, order proposals, or any AI agent's commentary — constitutes financial, investment, tax, or legal advice. Mechanical output is arithmetic, not a recommendation.
- **You operate it; you own the outcome.** Trading cryptocurrencies carries substantial risk, including the total loss of funds. Every order that reaches Coinbase does so because you enabled trading and supplied the explicit confirmation phrase. All trading decisions, configurations, and confirmations are yours.
- **AI agents can be wrong.** This server is designed to be driven by AI agents, which can misunderstand, hallucinate, miscalculate, or act on stale data. The author is **not liable** for any loss, damage, missed opportunity, or erroneous trade resulting from the actions, suggestions, or mistakes of any AI agent, automation, or third-party client used with this software. The safety model (read-only default, dry-runs, confirmation phrases, audit log) reduces risk but does **not** guarantee correctness.
- **No liability.** To the maximum extent permitted by law, the author and contributors shall not be liable for any direct, indirect, incidental, special, consequential, or exemplary damages arising from the use of, or inability to use, this software.
- **Third parties.** This is an unofficial project and is not affiliated with, endorsed by, or supported by Coinbase. Use of the Coinbase API is subject to Coinbase's own terms.

If you do not accept these terms, do not enable trading and do not use this software with live funds.

## License

The current version is source-available under the
[PolyForm Strict License 1.0.0](LICENSE). Running the unmodified software for
personal study, home testing, research, experimentation, and other permitted
noncommercial uses is allowed under its terms. Redistribution, modification,
commercial use, or professional use requires a separate written license from
Léo Chiron; see [commercial licensing](COMMERCIAL_LICENSE.md).

Versions previously published under MIT remain governed by the license that
accompanied those versions. Third-party dependencies retain their own licenses.

# AI Setup Guide — onboarding a new user

**Audience: the AI assistant.** This is a script for *you* (Codex, Claude, etc.) to walk a user
through installing this server and connecting it to their Coinbase account, step by step. The user
may be non-technical. Go one step at a time, confirm each step succeeded before moving on, and never
rush ahead.

## Your operating rules for this onboarding

- **Never handle secrets in the chat.** Do not ask the user to paste their Coinbase private key, API
  key name, or any token into the conversation. Tell them to paste those **directly into the `.env`
  file** in their editor. You may edit the non-secret lines of `.env`, but leave the secret values
  for the user to fill.
- **Never print secrets.** Do not echo `.env`, `config.local.php`, private keys, or Bearer tokens.
- **Keep trading off until asked.** `COINBASE_TRADING_ENABLED=false` is the safe default. Do not flip
  it without an explicit, informed request from the user.
- **Prefer a paper-trading rehearsal first** (Step 6) before anything live.
- Confirm the user's OS early — commands differ slightly on Windows (PowerShell) vs macOS/Linux (bash).

---

## Step 0 — Prerequisites

Ask the user to confirm Node.js ≥ 20.17 is installed:

```bash
node --version
```

If it is missing or older, point them to https://nodejs.org (LTS) and have them reinstall, then
re-check. `npm` ships with Node.

## Step 1 — Install and build

From the project root:

```bash
npm install
npm run build
```

- bash/macOS/Linux: `cp .env.example .env`
- Windows PowerShell: `Copy-Item .env.example .env`

If `npm install` fails on a native module (`better-sqlite3`), have them run `npm rebuild better-sqlite3`.

## Step 2 — Create a Coinbase API key

Guide the user through the **Coinbase Developer Platform (CDP)**:

1. Go to https://portal.cdp.coinbase.com/ and sign in with their Coinbase account.
2. Open **API Keys** and create a key for **Advanced Trade** (a "Secret API Key" / trading key, not
   a read-only data key).
3. **Permissions** — choose the minimum they need:
   - Read-only (portfolio, prices, analysis): `view`
   - To also place/cancel live orders later: `view` + `trade`
   - **Never enable `transfer`/`withdraw`.** This server has no withdrawal capability and the key
     should not grant one.
4. When the key is created, Coinbase shows **two values once**:
   - an **API key name** like `organizations/<org-id>/apiKeys/<key-id>`
   - a **private key** (an EC PEM block beginning `-----BEGIN EC PRIVATE KEY-----`)

   Tell the user to copy both somewhere safe immediately — the private key is shown only once.

## Step 3 — Fill `.env` (user pastes the secrets)

Ask the user to open `.env` in their editor and set:

```bash
COINBASE_API_KEY_NAME=organizations/your-org-id/apiKeys/your-key-id
COINBASE_API_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----\n"
COINBASE_API_BASE_URL=https://api.coinbase.com
COINBASE_TRADING_ENABLED=false
DEFAULT_QUOTE_CURRENCY=EUR
```

Guidance to give the user:

- The **private key must stay on one line** inside the quotes. Replace real line breaks with `\n`
  (the server converts them back and also normalizes the SEC1 EC key to PKCS#8 before signing).
- Keep the surrounding **double quotes** around the private key.
- `DEFAULT_QUOTE_CURRENCY` should match how they think about their portfolio (e.g. `EUR` or `USD`).
- Leave the paper-trading and risk-limit variables at their defaults for now.

You (the AI) can edit non-secret lines like `DEFAULT_QUOTE_CURRENCY` directly; do **not** fill the two
secret lines yourself.

## Step 4 — Connect the MCP client

The user runs this server from their MCP client (Codex, Claude Desktop, Cursor, …). Build first
(`npm run build`), then add a server entry pointing at the compiled `dist/index.js` with an
**absolute path**. Example (`codex-mcp-config.example.json` is in the repo):

```json
{
    "mcpServers": {
        "coinbase-local": {
            "command": "node",
            "args": ["/absolute/path/to/coinbase-advanced-mcp/dist/index.js"],
            "env": { "MCP_TRANSPORT": "stdio" }
        }
    }
}
```

Help the user find the absolute path (`pwd` on bash, `(Get-Location).Path` on PowerShell) and append
`/dist/index.js` (or `\dist\index.js` on Windows, escaping backslashes in JSON as `\\`). Then have
them restart / reload the MCP client so it picks up the new server.

The server loads `.env` from its own project root, so the client does not need to launch it from that
directory.

## Step 5 — Verify the connection

Ask the MCP for status (call the `get_server_status` tool). You want:

```json
{
    "serverStarted": true,
    "transport": "stdio",
    "coinbaseConfigured": true,
    "tradingEnabled": false,
    "paperTradingEnabled": false,
    "riskLimitsEnabled": false,
    "auditDatabaseAvailable": true
}
```

- `coinbaseConfigured: false` → the key name/private key in `.env` are missing or malformed. Recheck
  Step 3 (quotes, `\n`, no stray spaces) and that the client was restarted after editing `.env`.
- Then call `get_portfolio_snapshot` with `quoteCurrency` set to their currency. If it returns a
  portfolio close to the Coinbase app, the link works. A clear Coinbase auth error means the key or
  its permissions are wrong (often `view` not granted, or a typo in the key name).

## Step 6 — Recommended: rehearse in paper mode first

Before any live order, suggest a no-risk rehearsal:

1. In `.env`: `PAPER_TRADING_ENABLED=true` (optionally `PAPER_STARTING_CASH=10000`), then restart the
   client.
2. `get_server_status` → `paperTradingEnabled: true`.
3. `get_paper_portfolio` → seeds a simulated portfolio (from their real snapshot if keys exist, else
   cash).
4. Walk the full flow: `propose_limit_orders` / `create_order_dry_run` → `execute_validated_order`
   with `confirmationText: CONFIRM_EXECUTE_ORDER`. The order is simulated, never sent to Coinbase.
5. `process_paper_orders` evaluates resting orders against live prices and fills triggered ones.
6. Everything is in `get_audit_log`. Reset anytime with `reset_paper_portfolio`
   (`confirmationText: CONFIRM_RESET_PAPER`).

When done rehearsing, set `PAPER_TRADING_ENABLED=false` and restart.

## Step 7 — Curate the knowledge sources

Before relying on the assistant for analysis or order ideas, set up the operator's **validated
sources** (see README → "Knowledge base"). Choosing reliable sources is the user's responsibility.

1. Copy the template:
   - bash: `cp knowledge/sources.example.json knowledge/sources.json`
   - PowerShell: `Copy-Item knowledge\sources.example.json knowledge\sources.json`
2. Have the user fill `knowledge/sources.json` with sources **they** trust (macro calendars,
   on-chain dashboards, methodology notes, personal risk principles…), setting `"enabled": true`
   on each one they want active. The schema is documented in the example file's `_readme`.
3. Verify: `get_server_status` shows `knowledgeBaseAvailable: true` and a non-zero
   `knowledgeSourceCount`; `get_knowledge_base` lists the enabled sources.
4. From now on, call `get_knowledge_base` **before** analysis or order proposals and ground your
   reasoning in those sources.

**Golden rule:** you may *suggest* adding a source, but never call `add_knowledge_source` on your
own initiative. Describe the proposed source, then wait for the user to confirm with the exact
phrase `CONFIRM_ADD_SOURCE`. The user owns their source list; removing a source is a manual edit of
`knowledge/sources.json`.

## Step 8 — Going live (only when the user explicitly asks)

Explain the safety model before flipping anything:

1. The key must have the `trade` permission (Step 2).
2. In `.env`: `COINBASE_TRADING_ENABLED=true`, then **restart the client**.
3. Every live order still requires a stored `proposalId`/`dryRunId` **and** the exact phrase
   `confirmationText: CONFIRM_EXECUTE_ORDER`. Cancellation requires `CONFIRM_CANCEL_ORDER`.
4. **Optional risk guard:** to cap daily exposure, set `RISK_LIMITS_ENABLED=true` and
   `MAX_DAILY_NOTIONAL=<amount>` (in the quote currency). Live orders that would push the day's
   executed notional over the cap are rejected before sending.
5. Always re-check live state (`get_portfolio_snapshot`, `list_open_orders`) before and after acting,
   and never present mechanical output as financial advice.

To return to read-only: `COINBASE_TRADING_ENABLED=false` and restart.

---

## Step 9 — Optional/advanced: deploy the remote PHP guard

`server/coinbase-guard/` is a small, **separate** PHP/cron program for users who want a lightweight
remote watchdog that runs even when their computer is off. It only manages **explicitly listed**
Coinbase order ids — it can cancel them on a rule and place a backup protective sell after a listed
buy fills. It implements **no** withdrawals/transfers. This step is for users with PHP web hosting
(FTP + a cron panel). Skip it otherwise.

Do this only after the main MCP server works and the user asks for it.

1. **Create the server config from the same Coinbase key in `.env`:**
   ```bash
   npm run build
   node scripts/create-server-guard-config.mjs
   ```
   This writes `server/coinbase-guard/config.local.php` (gitignored) with the Coinbase key from
   `.env` plus freshly generated random `cron_token` and `status_token`. Tell the user to edit
   `mail_to` / `mail_from` and add any order ids to `managed_orders`. Keep live actions disabled while
   testing:
   ```php
   'live_cancel_enabled' => false,
   'cancel_confirmation_text' => '',
   ```
2. **Provide FTP details** in a `server-ftp.env` file at the project root (gitignored). It needs:
   ```bash
   FTP_HOST=ftp.example-host.com
   FTP_USER=...
   FTP_PASSWORD=...
   FTP_REMOTE_DIR=/mcp-coinbase
   REMOTE_PUBLIC_URL=https://your-domain.example.com/mcp-coinbase
   ```
   Have the user paste these into `server-ftp.env` themselves (FTP password is a secret).
3. **Upload** the guard (Windows PowerShell helper; excludes `config.local.php` and `state/` by
   default):
   ```powershell
   .\scripts\deploy-coinbase-guard.ps1
   ```
   To also upload the generated local config, pass `-IncludeLocalConfig` — but only when the user
   intends it, since it contains the Coinbase key. (On non-Windows hosts, upload the
   `server/coinbase-guard/` files and the `config.local.php` with any FTP client, keeping `state/` and
   the local config private.)
4. **Smoke-test** the cron endpoint (read-only while live actions are disabled):
   ```text
   https://your-domain.example.com/mcp-coinbase/cron.php?token=YOUR_CRON_TOKEN
   ```
5. **Schedule** `cron.php` every ~10 minutes in the host's cron panel.
6. **Verify status** without printing the token:
   ```powershell
   .\scripts\check-coinbase-guard-status.ps1
   ```
7. **Arm live actions** only when the user is ready, in `config.local.php`:
   ```php
   'live_cancel_enabled' => true,
   'cancel_confirmation_text' => 'CONFIRM_CANCEL_ORDER',
   ```
   (Backup protection uses `live_protection_enabled` + `protection_confirmation_text` =
   `'CONFIRM_EXECUTE_ORDER'`.)

See `server/coinbase-guard/README.md` for the full guard reference.

---

## Troubleshooting quick table

| Symptom | Likely cause / fix |
| --- | --- |
| `coinbaseConfigured: false` | Missing/malformed keys in `.env`; client not restarted after edit. |
| Coinbase auth error on a read tool | Key lacks `view`, wrong `COINBASE_API_KEY_NAME`, or private key newline issue. |
| Tool says trading is disabled | `COINBASE_TRADING_ENABLED=false` (expected until Step 7) or client not restarted. |
| `better-sqlite3` load error after Node upgrade | `npm rebuild better-sqlite3`. |
| Snapshot total differs slightly from the app | Prices move between refreshes; staked ETH/SOL is shown but not liquid. |
| MCP client doesn't see the server | Wrong absolute path to `dist/index.js`, or forgot `npm run build` / restart. |

## Safety reminders to repeat to the user

- Read-only by default; nothing is sent to Coinbase without explicit confirmation and a stored
  proposal/dry-run.
- This server can never withdraw or transfer funds.
- Mechanical analysis is **not** financial advice; the user owns every trading decision (see the
  Disclaimer in `README.md`).

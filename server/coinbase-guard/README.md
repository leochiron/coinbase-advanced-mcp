# Coinbase Guard PHP

Small PHP/cron guard for Coinbase Advanced Trade orders.

It only manages order ids explicitly listed in `config.local.php`.
It can cancel matching open orders when a configured rule is triggered, then email the address set in `config.local.php`.
It can also watch explicitly listed buy orders and submit a backup sell bracket after a fill.

## Install

1. Upload this directory to the FTP target, for example `/mcp-coinbase`.
2. Copy `config.example.php` to `config.local.php` on the server.
3. Fill Coinbase API key name/private key, long random `cron_token` and `status_token`.
4. Add explicit order ids in `managed_orders`.
5. Keep live cancellation disabled while testing:

```php
'live_cancel_enabled' => false,
'cancel_confirmation_text' => '',
```

6. Call:

```text
https://your-domain.example.com/mcp-coinbase/cron.php?token=YOUR_CRON_TOKEN
```

7. When the output looks right, arm live cancellation:

```php
'live_cancel_enabled' => true,
'cancel_confirmation_text' => 'CONFIRM_CANCEL_ORDER',
```

## Backup Protection

Add parent buy orders to `protection_orders`. The guard watches only these explicit order ids.
If a parent fills and Coinbase does not report an attached order id or attached order configuration, the guard can create a `trigger_bracket_gtc` sell order for the filled size.
The guard records protected filled size in `state/protection-state.json` so repeated cron runs do not submit duplicate backup orders for the same fill.

Keep live protection disabled while testing:

```php
'live_protection_enabled' => false,
'protection_confirmation_text' => '',
```

Arm live protection only when intentional:

```php
'live_protection_enabled' => true,
'protection_confirmation_text' => 'CONFIRM_EXECUTE_ORDER',
```

## Cron

Configure the host cron panel to call `cron.php` every 10 minutes.

## Status

```text
https://your-domain.example.com/mcp-coinbase/status.php?token=YOUR_STATUS_TOKEN
```

## Safety

- No withdrawals, transfers, sends, or payouts.
- No automatic order discovery by default.
- Only listed order ids are managed.
- Live cancellation requires `CONFIRM_CANCEL_ORDER` in server config.
- Live backup protection requires `CONFIRM_EXECUTE_ORDER` in server config.
- `config.local.php` and state files are blocked by `.htaccess`.

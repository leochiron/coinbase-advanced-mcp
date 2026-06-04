import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { loadEnv } from "../dist/config/env.js";

const env = loadEnv();

function phpString(value) {
    return `'${String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")}'`;
}

const cronToken = randomBytes(24).toString("hex");
const statusToken = randomBytes(24).toString("hex");

const php = [
    "<?php",
    "",
    "declare(strict_types=1);",
    "",
    "return [",
    "    'enabled' => true,",
    "    'live_cancel_enabled' => true,",
    "    'cancel_confirmation_text' => 'CONFIRM_CANCEL_ORDER',",
    "",
    `    'coinbase_api_key_name' => ${phpString(env.coinbaseApiKeyName)},`,
    `    'coinbase_api_private_key' => ${phpString(env.coinbaseApiPrivateKey)},`,
    `    'coinbase_api_base_url' => ${phpString(env.coinbaseApiBaseUrl)},`,
    "",
    "    'mail_to' => 'alerts@example.com',",
    "    'mail_from' => 'coinbase-guard@your-domain.example.com',",
    "",
    `    'cron_token' => ${phpString(cronToken)},`,
    `    'status_token' => ${phpString(statusToken)},`,
    "",
    "    'state_dir' => __DIR__ . '/state',",
    "",
    "    // Add future Coinbase order ids here. Only listed orders can be cancelled.",
    "    'managed_orders' => [],",
    "];",
    ""
].join("\n");

writeFileSync("server/coinbase-guard/config.local.php", php, "utf8");
console.log("CONFIG_LOCAL_CREATED");

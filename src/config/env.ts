import { createPrivateKey } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadDotenv({ path: resolve(projectRoot, ".env") });
loadDotenv();

const booleanFromString = z
    .string()
    .optional()
    .default("false")
    .transform((value) => value.toLowerCase() === "true");

const envSchema = z.object({
    COINBASE_API_KEY_NAME: z.string().optional().default(""),
    COINBASE_API_PRIVATE_KEY: z.string().optional().default(""),
    COINBASE_API_BASE_URL: z.string().url().default("https://api.coinbase.com"),
    COINBASE_TRADING_ENABLED: booleanFromString,
    DEFAULT_QUOTE_CURRENCY: z.string().min(2).default("EUR"),
    AUDIT_DATABASE_PATH: z.string().min(1).default("./data/audit.sqlite"),
    KNOWLEDGE_SOURCES_PATH: z.string().min(1).default("./knowledge/sources.json"),
    MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
    MCP_HTTP_PORT: z.coerce.number().int().positive().default(3333),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    PAPER_TRADING_ENABLED: booleanFromString,
    PAPER_STARTING_CASH: z.string().default("10000"),
    PAPER_FEE_BPS: z.coerce.number().min(0).default(60),
    RISK_LIMITS_ENABLED: booleanFromString,
    MAX_DAILY_NOTIONAL: z.coerce.number().min(0).default(0)
});

export type AppEnv = ReturnType<typeof loadEnv>;

export function loadEnv() {
    const parsed = envSchema.parse(process.env);
    const privateKey = normalizeCoinbasePrivateKey(parsed.COINBASE_API_PRIVATE_KEY);
    const keyName = parsed.COINBASE_API_KEY_NAME.trim();
    const auditDatabasePath =
        parsed.AUDIT_DATABASE_PATH === ":memory:" || isAbsolute(parsed.AUDIT_DATABASE_PATH)
            ? parsed.AUDIT_DATABASE_PATH
            : resolve(projectRoot, parsed.AUDIT_DATABASE_PATH);
    const knowledgeSourcesPath = isAbsolute(parsed.KNOWLEDGE_SOURCES_PATH)
        ? parsed.KNOWLEDGE_SOURCES_PATH
        : resolve(projectRoot, parsed.KNOWLEDGE_SOURCES_PATH);

    return {
        projectRoot,
        coinbaseApiKeyName: keyName,
        coinbaseApiPrivateKey: privateKey,
        coinbaseApiBaseUrl: parsed.COINBASE_API_BASE_URL.replace(/\/$/, ""),
        coinbaseConfigured: keyName.length > 0 && privateKey.trim().length > 0,
        tradingEnabled: parsed.COINBASE_TRADING_ENABLED,
        defaultQuoteCurrency: parsed.DEFAULT_QUOTE_CURRENCY.toUpperCase(),
        auditDatabasePath,
        knowledgeSourcesPath,
        mcpTransport: parsed.MCP_TRANSPORT,
        mcpHttpPort: parsed.MCP_HTTP_PORT,
        logLevel: parsed.LOG_LEVEL,
        paperTradingEnabled: parsed.PAPER_TRADING_ENABLED,
        paperStartingCash: parsed.PAPER_STARTING_CASH.trim(),
        paperFeeBps: parsed.PAPER_FEE_BPS,
        riskLimitsEnabled: parsed.RISK_LIMITS_ENABLED,
        maxDailyNotional: parsed.MAX_DAILY_NOTIONAL
    };
}

function normalizeCoinbasePrivateKey(value: string): string {
    const privateKey = value.replace(/\\n/g, "\n").trim();

    if (!privateKey.includes("-----BEGIN EC PRIVATE KEY-----")) {
        return privateKey;
    }

    // Coinbase may provide SEC1 EC keys, while the SDK imports PKCS#8 keys through jose.
    return createPrivateKey({
        key: privateKey,
        format: "pem"
    }).export({
        type: "pkcs8",
        format: "pem"
    }) as string;
}

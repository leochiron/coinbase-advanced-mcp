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

const booleanTrueFromString = z
    .string()
    .optional()
    .default("true")
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
    PAPER_HALF_SPREAD_BPS: z.coerce.number().min(0).default(2),
    PAPER_SLIPPAGE_BPS: z.coerce.number().min(0).default(3),
    PAPER_PARTIAL_FILL_RATIO: z.coerce.number().positive().max(1).default(1),
    RISK_LIMITS_ENABLED: booleanFromString,
    MAX_DAILY_NOTIONAL: z.coerce.number().min(0).default(0),
    RESEARCH_AUTOMATION_MODE: z.enum(["OFF", "OBSERVE", "PAPER"]).default("OFF"),
    RESEARCH_DECISION_PATH: z.string().min(1).default("./reports/research_decision.v1.json"),
    RESEARCH_EMERGENCY_STOP_PATH: z.string().min(1).default("./data/research-automation/STOP"),
    RESEARCH_DECISION_MAX_AGE_MINUTES: z.coerce.number().positive().default(90),
    RESEARCH_SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
    RESEARCH_RUN_PIPELINE: booleanFromString,
    RESEARCH_PYTHON_COMMAND: z.string().min(1).default("python"),
    RESEARCH_PIPELINE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900),
    RESEARCH_MAX_DAILY_LOSS_EUR: z.coerce.number().positive().default(50),
    RESEARCH_MAX_ORDERS_PER_DAY: z.coerce.number().int().positive().default(20),
    RESEARCH_MAX_OPEN_ORDERS: z.coerce.number().int().positive().default(6),
    RESEARCH_BLOCK_EXTREME_VOLATILITY: booleanTrueFromString
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
    const researchDecisionPath = isAbsolute(parsed.RESEARCH_DECISION_PATH)
        ? parsed.RESEARCH_DECISION_PATH
        : resolve(projectRoot, parsed.RESEARCH_DECISION_PATH);
    const researchEmergencyStopPath = isAbsolute(parsed.RESEARCH_EMERGENCY_STOP_PATH)
        ? parsed.RESEARCH_EMERGENCY_STOP_PATH
        : resolve(projectRoot, parsed.RESEARCH_EMERGENCY_STOP_PATH);

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
        paperHalfSpreadBps: parsed.PAPER_HALF_SPREAD_BPS,
        paperSlippageBps: parsed.PAPER_SLIPPAGE_BPS,
        paperPartialFillRatio: parsed.PAPER_PARTIAL_FILL_RATIO,
        riskLimitsEnabled: parsed.RISK_LIMITS_ENABLED,
        maxDailyNotional: parsed.MAX_DAILY_NOTIONAL,
        researchAutomationMode: parsed.RESEARCH_AUTOMATION_MODE,
        researchDecisionPath,
        researchEmergencyStopPath,
        researchDecisionMaxAgeMinutes: parsed.RESEARCH_DECISION_MAX_AGE_MINUTES,
        researchSchedulerIntervalSeconds: parsed.RESEARCH_SCHEDULER_INTERVAL_SECONDS,
        researchRunPipeline: parsed.RESEARCH_RUN_PIPELINE,
        researchPythonCommand: parsed.RESEARCH_PYTHON_COMMAND,
        researchPipelineTimeoutSeconds: parsed.RESEARCH_PIPELINE_TIMEOUT_SECONDS,
        researchMaxDailyLossEur: parsed.RESEARCH_MAX_DAILY_LOSS_EUR,
        researchMaxOrdersPerDay: parsed.RESEARCH_MAX_ORDERS_PER_DAY,
        researchMaxOpenOrders: parsed.RESEARCH_MAX_OPEN_ORDERS,
        researchBlockExtremeVolatility: parsed.RESEARCH_BLOCK_EXTREME_VOLATILITY
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

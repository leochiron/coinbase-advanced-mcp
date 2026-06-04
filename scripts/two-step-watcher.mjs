import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CoinbaseClient } from "../dist/coinbase/coinbaseClient.js";
import { loadEnv } from "../dist/config/env.js";
import { AuditService } from "../dist/services/auditService.js";
import { OrderExecutionService } from "../dist/services/orderExecutionService.js";
import { createAuditDatabase } from "../dist/storage/database.js";
import { createClientOrderId } from "../dist/utils/idempotency.js";

const args = parseArgs(process.argv.slice(2));
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const dataDir = resolve(projectRoot, "data");
const configPath = resolve(projectRoot, args.config ?? "scripts/two-step-watcher.config.json");

mkdirSync(dataDir, { recursive: true });

const strategy = loadStrategy(configPath);
const strategyId = strategy.strategyId ?? basename(configPath).replace(/[^a-zA-Z0-9_-]+/g, "-");
const statusPath = resolve(projectRoot, strategy.statusPath ?? `data/two-step-watcher.${strategyId}.status.json`);
const logPath = resolve(projectRoot, strategy.logPath ?? `data/two-step-watcher.${strategyId}.log`);
const dryRun = args.dryRun === true || strategy.dryRun === true;
const once = args.once === true || strategy.once === true;
const pollMs = Number(strategy.pollMs ?? 60_000);

const env = loadEnv();
const db = createAuditDatabase(env.auditDatabasePath);
const auditService = new AuditService(db);
const coinbaseClient = new CoinbaseClient(env);
const orderExecutionService = new OrderExecutionService(coinbaseClient, auditService, env);

let shuttingDown = false;
process.on("SIGINT", () => {
    shuttingDown = true;
    log("SIGINT received, stopping after current poll.");
});
process.on("SIGTERM", () => {
    shuttingDown = true;
    log("SIGTERM received, stopping after current poll.");
});

let state = loadState();
if (!state) {
    state = {
        version: 2,
        pid: process.pid,
        strategyId,
        configPath,
        configHash: hashStrategy(strategy),
        proposalId: strategy.proposalId,
        startedAt: new Date().toISOString(),
        lastPollAt: null,
        completedAt: null,
        mode: "starting",
        dryRun,
        auditDatabasePath: env.auditDatabasePath,
        logPath,
        statusPath,
        orders: strategy.orders.map((order) => ({
            ...order,
            parentOrderId: order.parentOrderId ?? null,
            parentClientOrderId: null,
            parentStatus: order.parentOrderId ? "EXTERNAL" : "NOT_SENT",
            parentFilledSize: "0",
            protectedBaseSize: "0",
            protectionOrders: [],
            lastError: null
        }))
    };
    saveState();
} else {
    assertCompatibleState(state, strategy);
}

state.pid = process.pid;
state.mode = dryRun ? "dry_run" : "running";
state.dryRun = dryRun;
state.auditDatabasePath = env.auditDatabasePath;
saveState();

log(`Watcher started strategy=${strategyId} proposal=${strategy.proposalId ?? "external"} dryRun=${dryRun}.`);

try {
    await executeParentOrders();
    do {
        await pollOnce();
        if (allParentsTerminalAndProtected()) {
            state.mode = "complete";
            state.completedAt = new Date().toISOString();
            saveState();
            log("All parent orders are terminal and all filled quantities are protected. Watcher complete.");
            break;
        }
        if (once) {
            state.mode = dryRun ? "dry_run_once_complete" : "once_complete";
            state.completedAt = new Date().toISOString();
            saveState();
            break;
        }
        await sleep(pollMs);
    } while (!shuttingDown);
    if (shuttingDown && state.mode === "running") {
        state.mode = "stopped";
        saveState();
    }
} catch (error) {
    state.mode = "error";
    state.lastFatalError = formatError(error);
    saveState();
    log(`FATAL ${state.lastFatalError}`);
    process.exitCode = 1;
} finally {
    db.close();
}

async function executeParentOrders() {
    if (strategy.executeParents !== true) {
        return;
    }
    if (!strategy.proposalId) {
        throw new Error("proposalId is required when executeParents=true");
    }

    for (const order of state.orders) {
        if (order.parentOrderId || order.parentStatus === "FAILED") {
            continue;
        }

        if (dryRun || strategy.parentConfirmationText !== "CONFIRM_EXECUTE_ORDER") {
            order.parentStatus = dryRun ? "DRY_RUN_NOT_SENT" : "CONFIRMATION_REQUIRED";
            order.lastError = dryRun ? null : "parentConfirmationText must equal CONFIRM_EXECUTE_ORDER";
            saveState();
            log(`Parent not submitted ${order.productId}: ${order.parentStatus}.`);
            continue;
        }

        log(`Submitting parent order ${order.productId} from proposal index ${order.orderIndex}.`);
        const result = await orderExecutionService.executeValidatedOrder({
            proposalId: strategy.proposalId,
            orderIndex: order.orderIndex,
            confirmationText: "CONFIRM_EXECUTE_ORDER"
        });

        order.parentClientOrderId = result.clientOrderId;
        order.parentOrderId = result.coinbaseOrderId ?? null;
        order.parentStatus = result.status;
        order.lastSubmitResponse = result;
        order.lastError =
            result.status === "FAILED" ? JSON.stringify(result.raw?.error_response ?? result.raw ?? null) : null;
        saveState();

        log(
            result.status === "SENT"
                ? `Parent submitted ${order.productId}: ${order.parentOrderId}.`
                : `Parent submit FAILED ${order.productId}: ${order.lastError ?? "unknown error"}.`
        );
    }
}

async function pollOnce() {
    state.lastPollAt = new Date().toISOString();

    for (const order of state.orders) {
        if (!order.parentOrderId) {
            continue;
        }

        let parent;
        try {
            parent = await coinbaseClient.getOrder(order.parentOrderId);
        } catch (error) {
            order.lastError = formatError(error);
            log(`Poll error ${order.productId}: ${order.lastError}`);
            continue;
        }

        order.parentStatus = parent.status ?? order.parentStatus;
        order.parentFilledSize = parent.filled_size ?? order.parentFilledSize ?? "0";
        order.parentLastFillTime = parent.last_fill_time ?? order.parentLastFillTime ?? null;
        order.parentCompletionPercentage = parent.completion_percentage ?? order.parentCompletionPercentage ?? null;

        const filled = Number(order.parentFilledSize ?? 0);
        const protectedSize = Number(order.protectedBaseSize ?? 0);
        const delta = formatBaseSize(filled - protectedSize, order.baseIncrement);

        if (Number(delta) > 0) {
            try {
                await submitProtection(order, delta);
            } catch (error) {
                order.lastError = formatError(error);
                log(`Protection error ${order.productId}: ${order.lastError}`);
            }
        }
    }

    saveState();
    const summary = state.orders
        .map(
            (order) =>
                `${order.productId}:${order.parentStatus}:filled=${order.parentFilledSize}:protected=${order.protectedBaseSize}`
        )
        .join(" | ");
    log(`Poll ${summary}`);
}

async function submitProtection(order, baseSize) {
    const payload = {
        client_order_id: createClientOrderId(),
        product_id: order.productId,
        side: "SELL",
        order_configuration: {
            trigger_bracket_gtc: {
                base_size: baseSize,
                limit_price: order.takeProfitPrice,
                stop_trigger_price: order.stopLossPrice
            }
        }
    };

    if (
        dryRun ||
        strategy.liveProtectionEnabled !== true ||
        strategy.protectionConfirmationText !== "CONFIRM_EXECUTE_ORDER"
    ) {
        order.lastProtectionPreview = payload;
        order.lastError = dryRun
            ? null
            : "Protection requires liveProtectionEnabled=true and protectionConfirmationText=CONFIRM_EXECUTE_ORDER";
        log(
            `Protection preview ${order.productId} size=${baseSize} TP=${order.takeProfitPrice} SL=${order.stopLossPrice}.`
        );
        return;
    }

    log(
        `Submitting protection ${order.productId} size=${baseSize} TP=${order.takeProfitPrice} SL=${order.stopLossPrice}.`
    );
    const response = await coinbaseClient.createOrder(payload);
    const auditLogId = auditService.saveExecution(`two-step-protection:${order.parentOrderId}`, payload, response);
    const coinbaseOrderId = response.success_response?.order_id ?? response.order_id ?? null;

    if (response.success === false || !coinbaseOrderId) {
        order.lastError = JSON.stringify(response.error_response ?? response);
        log(`Protection FAILED ${order.productId}: ${order.lastError}.`);
        return;
    }

    order.protectedBaseSize = addDecimalStrings(order.protectedBaseSize, baseSize, order.baseIncrement);
    order.protectionOrders.push({
        coinbaseOrderId,
        clientOrderId: payload.client_order_id,
        baseSize,
        takeProfitPrice: order.takeProfitPrice,
        stopLossPrice: order.stopLossPrice,
        auditLogId,
        createdAt: new Date().toISOString()
    });
    order.lastProtectionPreview = null;
    order.lastError = null;
    log(`Protection submitted ${order.productId}: ${coinbaseOrderId}, protected=${order.protectedBaseSize}.`);
}

function allParentsTerminalAndProtected() {
    return state.orders.every((order) => {
        if (!order.parentOrderId) {
            return ["FAILED", "DRY_RUN_NOT_SENT", "CONFIRMATION_REQUIRED"].includes(order.parentStatus);
        }
        const terminal = ["FILLED", "CANCELLED", "EXPIRED", "FAILED", "REJECTED"].includes(order.parentStatus);
        const filled = Number(order.parentFilledSize ?? 0);
        const protectedSize = Number(order.protectedBaseSize ?? 0);
        return terminal && (dryRun || protectedSize + Number(order.baseIncrement) / 2 >= filled);
    });
}

function loadStrategy(path) {
    if (!existsSync(path)) {
        throw new Error(`Watcher config not found: ${path}`);
    }

    const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    if (!Array.isArray(parsed.orders) || parsed.orders.length === 0) {
        throw new Error("Watcher config must contain a non-empty orders array");
    }

    return parsed;
}

function assertCompatibleState(existingState, nextStrategy) {
    if (existingState.strategyId !== strategyId) {
        throw new Error(`Existing state strategyId ${existingState.strategyId} does not match ${strategyId}`);
    }
    if ((existingState.proposalId ?? null) !== (nextStrategy.proposalId ?? null)) {
        throw new Error("Existing state proposalId does not match watcher config");
    }
}

function hashStrategy(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function formatBaseSize(value, increment) {
    if (!Number.isFinite(value) || value <= 0) {
        return "0";
    }

    const decimals = decimalPlaces(increment);
    const factor = 10 ** decimals;
    const rounded = Math.floor((value + Number.EPSILON) * factor) / factor;
    if (rounded <= 0) {
        return "0";
    }

    return decimals === 0
        ? String(Math.trunc(rounded))
        : rounded.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
}

function addDecimalStrings(left, right, increment) {
    return formatBaseSize(Number(left ?? 0) + Number(right ?? 0), increment);
}

function decimalPlaces(value) {
    const dot = value.indexOf(".");
    return dot === -1 ? 0 : value.length - dot - 1;
}

function loadState() {
    if (!existsSync(statusPath)) {
        return undefined;
    }
    return JSON.parse(readFileSync(statusPath, "utf8").replace(/^\uFEFF/, ""));
}

function saveState() {
    writeFileSync(statusPath, `${JSON.stringify(state, null, 2)}\n`);
}

function log(message) {
    appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
}

function parseArgs(values) {
    const output = {};
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (value === "--config") {
            output.config = values[index + 1];
            index += 1;
        } else if (value === "--dry-run") {
            output.dryRun = true;
        } else if (value === "--once") {
            output.once = true;
        }
    }
    return output;
}

function formatError(error) {
    if (error && typeof error === "object" && "responseBody" in error) {
        return JSON.stringify(error.responseBody);
    }
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function sleep(ms) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

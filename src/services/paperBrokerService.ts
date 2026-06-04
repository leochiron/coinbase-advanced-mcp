import type Database from "better-sqlite3";
import type { AppEnv } from "../config/env.js";
import type { CoinbaseOrderPayload } from "../coinbase/coinbaseTypes.js";
import { createId } from "../utils/idempotency.js";
import { parseDecimal, percent, toDecimalString } from "../utils/numberFormat.js";
import type { AuditService } from "./auditService.js";
import type { PortfolioService } from "./portfolioService.js";
import type { PricingService } from "./pricingService.js";

type PaperEnv = Pick<AppEnv, "paperStartingCash" | "paperFeeBps" | "defaultQuoteCurrency" | "coinbaseConfigured">;

type OrderType = "MARKET" | "LIMIT" | "STOP_LIMIT" | "BRACKET";

type OrderIntent = {
    productId: string;
    baseAsset: string;
    quoteAsset: string;
    side: "BUY" | "SELL";
    orderType: OrderType;
    baseSize?: number;
    quoteSize?: number;
    limitPrice?: number;
    stopPrice?: number;
};

export type PaperOrderRow = {
    paper_order_id: string;
    product_id: string;
    side: string;
    order_type: string;
    base_size: string | null;
    quote_size: string | null;
    limit_price: string | null;
    stop_price: string | null;
    status: string;
    created_at: string;
    filled_at: string | null;
    fill_price: string | null;
    fill_size: string | null;
    fee: string | null;
    reason: string | null;
    source_id: string | null;
};

export class PaperBrokerService {
    constructor(
        private readonly db: Database.Database,
        private readonly auditService: AuditService,
        private readonly pricingService: PricingService,
        private readonly portfolioService: PortfolioService,
        private readonly env: PaperEnv
    ) {}

    async submitOrder(payload: CoinbaseOrderPayload, sourceId: string) {
        const quoteCurrency = this.env.defaultQuoteCurrency;
        await this.ensureSeeded(quoteCurrency);

        const intent = parseIntent(payload);
        const paperOrderId = createId("paper");
        const createdAt = new Date().toISOString();

        this.db
            .prepare(
                `INSERT INTO paper_orders (paper_order_id, client_order_id, product_id, side, order_type, base_size, quote_size, limit_price, stop_price, status, created_at, source_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                paperOrderId,
                payload.client_order_id,
                intent.productId,
                intent.side,
                intent.orderType,
                intent.baseSize !== undefined ? toDecimalString(intent.baseSize) : null,
                intent.quoteSize !== undefined ? toDecimalString(intent.quoteSize) : null,
                intent.limitPrice !== undefined ? toDecimalString(intent.limitPrice) : null,
                intent.stopPrice !== undefined ? toDecimalString(intent.stopPrice) : null,
                "OPEN",
                createdAt,
                sourceId
            );

        this.auditService.append("paper_order_submitted", "OPEN", { paperOrderId, payload });

        if (intent.orderType === "MARKET") {
            const price = await this.getMarketPrice(intent.productId);
            const fill = this.tryFill(paperOrderId, intent, price, price);
            return { paperOrderId, mode: "PAPER", ...fill };
        }

        return { paperOrderId, mode: "PAPER", status: "OPEN" as const, message: "Resting paper order. Call process_paper_orders to evaluate fills." };
    }

    async processFills() {
        const open = this.db.prepare("SELECT * FROM paper_orders WHERE status = 'OPEN' ORDER BY created_at ASC").all() as PaperOrderRow[];
        const results: Array<Record<string, unknown>> = [];

        for (const row of open) {
            const intent = intentFromRow(row);
            let price: number;
            try {
                price = await this.getMarketPrice(intent.productId);
            } catch {
                continue;
            }

            const trigger = shouldFill(intent, price);
            if (!trigger.fill) {
                continue;
            }

            const result = this.tryFill(row.paper_order_id, intent, price, trigger.fillPrice);
            results.push({ paperOrderId: row.paper_order_id, productId: intent.productId, marketPrice: price, ...result });
        }

        return { evaluated: open.length, filled: results.filter((r) => r.status === "FILLED").length, results };
    }

    cancelOrder(paperOrderId: string) {
        const row = this.db.prepare("SELECT status FROM paper_orders WHERE paper_order_id = ?").get(paperOrderId) as
            | { status: string }
            | undefined;
        if (!row) {
            throw new Error(`paper order not found: ${paperOrderId}`);
        }
        if (row.status !== "OPEN") {
            return { paperOrderId, status: row.status, message: "Only OPEN paper orders can be cancelled." };
        }

        this.db.prepare("UPDATE paper_orders SET status = 'CANCELLED' WHERE paper_order_id = ?").run(paperOrderId);
        this.auditService.append("paper_order_cancelled", "CANCELLED", { paperOrderId });
        return { paperOrderId, status: "CANCELLED" as const };
    }

    async getPortfolio(quoteCurrency: string) {
        await this.ensureSeeded(quoteCurrency);
        const balances = this.db.prepare("SELECT asset, balance FROM paper_balances ORDER BY asset ASC").all() as Array<{
            asset: string;
            balance: string;
        }>;

        const assets = [];
        let totalEstimatedValue = 0;
        for (const { asset, balance } of balances) {
            const quantity = parseDecimal(balance);
            if (quantity === 0) {
                continue;
            }
            const lookup = await this.pricingService.getPrice(asset, quoteCurrency);
            const estimatedValue = lookup.price === undefined ? undefined : quantity * lookup.price;
            totalEstimatedValue += estimatedValue ?? 0;
            assets.push({ asset, quantity, estimatedPrice: lookup.price, estimatedValue, valuationStatus: lookup.valuationStatus });
        }

        for (const asset of assets) {
            (asset as { portfolioWeightPercent?: number }).portfolioWeightPercent =
                totalEstimatedValue > 0 ? percent(((asset.estimatedValue ?? 0) / totalEstimatedValue) * 100) : 0;
        }

        const openOrders = (this.db.prepare("SELECT * FROM paper_orders WHERE status = 'OPEN' ORDER BY created_at ASC").all() as PaperOrderRow[]).map(
            mapOrderRow
        );

        return { mode: "PAPER", quoteCurrency, totalEstimatedValue, assets, openOrders };
    }

    async reset(startingBalances?: Record<string, string>) {
        this.db.exec("DELETE FROM paper_orders; DELETE FROM paper_balances; DELETE FROM paper_meta;");
        this.auditService.append("paper_reset", "done", { startingBalances: startingBalances ?? null });
        await this.ensureSeeded(this.env.defaultQuoteCurrency, startingBalances);
        return this.getPortfolio(this.env.defaultQuoteCurrency);
    }

    async ensureSeeded(quoteCurrency: string, startingBalances?: Record<string, string>) {
        if (this.getMeta("seeded") === "true") {
            return;
        }

        if (startingBalances) {
            for (const [asset, value] of Object.entries(startingBalances)) {
                this.setBalance(asset.toUpperCase(), parseDecimal(value));
            }
        } else {
            const seeded = this.env.coinbaseConfigured ? await this.trySeedFromSnapshot(quoteCurrency) : false;
            if (!seeded) {
                this.setBalance(quoteCurrency.toUpperCase(), parseDecimal(this.env.paperStartingCash));
            }
        }

        this.setMeta("seeded", "true");
        this.setMeta("quoteCurrency", quoteCurrency.toUpperCase());
        this.auditService.append("paper_seeded", "done", { quoteCurrency, source: startingBalances ? "explicit" : "auto" });
    }

    private async trySeedFromSnapshot(quoteCurrency: string): Promise<boolean> {
        try {
            const snapshot = await this.portfolioService.getSnapshot(quoteCurrency);
            if (!snapshot.assets.length) {
                return false;
            }
            for (const asset of snapshot.assets) {
                this.setBalance(asset.asset.toUpperCase(), asset.quantity);
            }
            return true;
        } catch {
            return false;
        }
    }

    private tryFill(paperOrderId: string, intent: OrderIntent, marketPrice: number, fillPrice: number) {
        const size = intent.baseSize ?? (intent.quoteSize !== undefined && fillPrice > 0 ? intent.quoteSize / fillPrice : 0);
        if (size <= 0 || fillPrice <= 0) {
            return this.rejectOrder(paperOrderId, "Could not resolve a positive fill size/price.");
        }

        const feeRate = this.env.paperFeeBps / 10_000;
        const notional = size * fillPrice;
        const fee = notional * feeRate;

        if (intent.side === "BUY") {
            const cost = notional + fee;
            if (this.getBalance(intent.quoteAsset) < cost) {
                return this.rejectOrder(paperOrderId, `Insufficient ${intent.quoteAsset} balance for paper BUY (need ${cost.toFixed(2)}).`);
            }
            this.adjustBalance(intent.quoteAsset, -cost);
            this.adjustBalance(intent.baseAsset, size);
        } else {
            if (this.getBalance(intent.baseAsset) < size) {
                return this.rejectOrder(paperOrderId, `Insufficient ${intent.baseAsset} balance for paper SELL (need ${size}).`);
            }
            this.adjustBalance(intent.baseAsset, -size);
            this.adjustBalance(intent.quoteAsset, notional - fee);
        }

        const filledAt = new Date().toISOString();
        this.db
            .prepare("UPDATE paper_orders SET status = 'FILLED', filled_at = ?, fill_price = ?, fill_size = ?, fee = ? WHERE paper_order_id = ?")
            .run(filledAt, toDecimalString(fillPrice), toDecimalString(size), toDecimalString(fee), paperOrderId);
        this.auditService.append("paper_order_fill", "FILLED", { paperOrderId, side: intent.side, productId: intent.productId, size, fillPrice, fee, marketPrice });

        return { status: "FILLED" as const, side: intent.side, fillPrice, fillSize: size, fee };
    }

    private rejectOrder(paperOrderId: string, reason: string) {
        this.db.prepare("UPDATE paper_orders SET status = 'REJECTED', reason = ? WHERE paper_order_id = ?").run(reason, paperOrderId);
        this.auditService.append("paper_order_rejected", "REJECTED", { paperOrderId, reason });
        return { status: "REJECTED" as const, reason };
    }

    private async getMarketPrice(productId: string): Promise<number> {
        const ticker = await this.pricingService.getProductTicker(productId);
        const last = parseDecimal(ticker.price);
        if (last > 0) {
            return last;
        }
        const bid = parseDecimal(ticker.bestBid);
        const ask = parseDecimal(ticker.bestAsk);
        if (bid > 0 && ask > 0) {
            return (bid + ask) / 2;
        }
        throw new Error(`No market price available for ${productId}`);
    }

    private getBalance(asset: string): number {
        const row = this.db.prepare("SELECT balance FROM paper_balances WHERE asset = ?").get(asset.toUpperCase()) as
            | { balance: string }
            | undefined;
        return parseDecimal(row?.balance);
    }

    private setBalance(asset: string, value: number): void {
        this.db
            .prepare(
                "INSERT INTO paper_balances (asset, balance, updated_at) VALUES (?, ?, ?) ON CONFLICT(asset) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at"
            )
            .run(asset.toUpperCase(), toDecimalString(value), new Date().toISOString());
    }

    private adjustBalance(asset: string, delta: number): void {
        this.setBalance(asset, this.getBalance(asset) + delta);
    }

    private getMeta(key: string): string | undefined {
        const row = this.db.prepare("SELECT value FROM paper_meta WHERE key = ?").get(key) as { value: string } | undefined;
        return row?.value;
    }

    private setMeta(key: string, value: string): void {
        this.db
            .prepare("INSERT INTO paper_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .run(key, value);
    }
}

function parseIntent(payload: CoinbaseOrderPayload): OrderIntent {
    const [base, quote] = payload.product_id.split("-");
    const [configKey, config] = Object.entries(payload.order_configuration)[0];
    const num = (value: string | boolean | undefined): number | undefined =>
        typeof value === "string" && value.length > 0 ? parseDecimal(value) : undefined;

    return {
        productId: payload.product_id,
        baseAsset: (base ?? "").toUpperCase(),
        quoteAsset: (quote ?? "").toUpperCase(),
        side: payload.side,
        orderType: orderTypeFromConfigKey(configKey),
        baseSize: num(config.base_size),
        quoteSize: num(config.quote_size),
        limitPrice: num(config.limit_price),
        stopPrice: num(config.stop_price)
    };
}

function intentFromRow(row: PaperOrderRow): OrderIntent {
    const [base, quote] = row.product_id.split("-");
    const num = (value: string | null): number | undefined => (value ? parseDecimal(value) : undefined);
    return {
        productId: row.product_id,
        baseAsset: (base ?? "").toUpperCase(),
        quoteAsset: (quote ?? "").toUpperCase(),
        side: row.side === "SELL" ? "SELL" : "BUY",
        orderType: row.order_type as OrderType,
        baseSize: num(row.base_size),
        quoteSize: num(row.quote_size),
        limitPrice: num(row.limit_price),
        stopPrice: num(row.stop_price)
    };
}

function orderTypeFromConfigKey(key: string): OrderType {
    if (key.startsWith("market_market")) {
        return "MARKET";
    }
    if (key.startsWith("stop_limit")) {
        return "STOP_LIMIT";
    }
    if (key.startsWith("trigger_bracket")) {
        return "BRACKET";
    }
    return "LIMIT";
}

function shouldFill(intent: OrderIntent, price: number): { fill: boolean; fillPrice: number } {
    const noFill = { fill: false, fillPrice: 0 };

    if (intent.orderType === "LIMIT") {
        if (intent.limitPrice === undefined) {
            return noFill;
        }
        if (intent.side === "BUY" && price <= intent.limitPrice) {
            return { fill: true, fillPrice: intent.limitPrice };
        }
        if (intent.side === "SELL" && price >= intent.limitPrice) {
            return { fill: true, fillPrice: intent.limitPrice };
        }
        return noFill;
    }

    if (intent.orderType === "STOP_LIMIT") {
        if (intent.stopPrice === undefined || intent.limitPrice === undefined) {
            return noFill;
        }
        // Direction inferred from side, matching the proposal builder: SELL -> STOP_DOWN, BUY -> STOP_UP.
        if (intent.side === "SELL" && price <= intent.stopPrice) {
            return { fill: true, fillPrice: intent.limitPrice };
        }
        if (intent.side === "BUY" && price >= intent.stopPrice) {
            return { fill: true, fillPrice: intent.limitPrice };
        }
        return noFill;
    }

    return noFill;
}

function mapOrderRow(row: PaperOrderRow) {
    return {
        paperOrderId: row.paper_order_id,
        productId: row.product_id,
        side: row.side,
        orderType: row.order_type,
        baseSize: row.base_size ?? undefined,
        quoteSize: row.quote_size ?? undefined,
        limitPrice: row.limit_price ?? undefined,
        stopPrice: row.stop_price ?? undefined,
        status: row.status,
        createdAt: row.created_at
    };
}

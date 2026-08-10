import type Database from "better-sqlite3";
import type { AppEnv } from "../config/env.js";
import type { CoinbaseOrderPayload } from "../coinbase/coinbaseTypes.js";
import { createId } from "../utils/idempotency.js";
import { parseDecimal, percent, toDecimalString } from "../utils/numberFormat.js";
import type { AuditService } from "./auditService.js";
import type { PortfolioService } from "./portfolioService.js";
import type { PricingService } from "./pricingService.js";

type PaperEnv = Pick<AppEnv, "paperStartingCash" | "paperFeeBps" | "defaultQuoteCurrency" | "coinbaseConfigured"> &
    Partial<Pick<AppEnv, "paperHalfSpreadBps" | "paperSlippageBps" | "paperPartialFillRatio">>;
type PaperPricing = Pick<PricingService, "getProductTicker" | "getPrice">;
type PaperPortfolio = Pick<PortfolioService, "getSnapshot">;

type OrderType = "MARKET" | "LIMIT" | "STOP_LIMIT" | "BRACKET";
type TriggerReason = "MARKET" | "LIMIT" | "STOP" | "TAKE_PROFIT";

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
    takeProfitPrice?: number;
    stopLossPrice?: number;
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
    take_profit_price: string | null;
    stop_loss_price: string | null;
    parent_paper_order_id: string | null;
    remaining_size: string | null;
    status: string;
    created_at: string;
    filled_at: string | null;
    fill_price: string | null;
    fill_size: string | null;
    fee: string | null;
    reason: string | null;
    source_id: string | null;
};

type PaperPositionRow = {
    position_id: string;
    product_id: string;
    quantity: string;
    average_entry_price: string;
    realized_pnl: string;
    entry_fees: string;
    exit_fees: string;
    status: string;
    opened_at: string;
    closed_at: string | null;
};

export class PaperBrokerService {
    constructor(
        private readonly db: Database.Database,
        private readonly auditService: AuditService,
        private readonly pricingService: PaperPricing,
        private readonly portfolioService: PaperPortfolio,
        private readonly env: PaperEnv
    ) {}

    async submitOrder(payload: CoinbaseOrderPayload, sourceId: string, marketPriceOverride?: number) {
        const quoteCurrency = this.env.defaultQuoteCurrency;
        await this.ensureSeeded(quoteCurrency);

        const intent = parseIntent(payload);
        const paperOrderId = createId("paper");
        const createdAt = new Date().toISOString();
        this.insertOrder(paperOrderId, payload.client_order_id, intent, "OPEN", createdAt, sourceId);
        this.auditService.append("paper_order_submitted", "OPEN", { paperOrderId, payload });

        if (intent.orderType === "MARKET") {
            const price = marketPriceOverride ?? (await this.getMarketPrice(intent.productId));
            const fill = this.tryFill(paperOrderId, intent, price, price, "MARKET");
            return { paperOrderId, mode: "PAPER", ...fill };
        }

        return {
            paperOrderId,
            mode: "PAPER",
            status: "OPEN" as const,
            message: "Resting paper order. Call process_paper_orders to evaluate fills."
        };
    }

    async processFills(marketPrices: Record<string, number> = {}) {
        const open = this.db
            .prepare("SELECT * FROM paper_orders WHERE status IN ('OPEN', 'PARTIALLY_FILLED') ORDER BY created_at ASC")
            .all() as PaperOrderRow[];
        const results: Array<Record<string, unknown>> = [];

        for (const row of open) {
            const intent = intentFromRow(row);
            let price: number;
            try {
                price = marketPrices[intent.productId] ?? (await this.getMarketPrice(intent.productId));
            } catch {
                this.auditService.append("paper_price_unavailable", "SKIPPED", {
                    paperOrderId: row.paper_order_id,
                    productId: intent.productId
                });
                continue;
            }

            const trigger = shouldFill(intent, price);
            if (!trigger.fill) {
                continue;
            }
            const result = this.tryFill(row.paper_order_id, intent, price, trigger.fillPrice, trigger.reason);
            results.push({
                paperOrderId: row.paper_order_id,
                productId: intent.productId,
                marketPrice: price,
                ...result
            });
        }

        return {
            evaluated: open.length,
            filled: results.filter((result) => result.status === "FILLED").length,
            partiallyFilled: results.filter((result) => result.status === "PARTIALLY_FILLED").length,
            results
        };
    }

    cancelOrder(paperOrderId: string) {
        const row = this.db.prepare("SELECT status FROM paper_orders WHERE paper_order_id = ?").get(paperOrderId) as
            | { status: string }
            | undefined;
        if (!row) {
            throw new Error(`paper order not found: ${paperOrderId}`);
        }
        if (!new Set(["OPEN", "PARTIALLY_FILLED"]).has(row.status)) {
            return { paperOrderId, status: row.status, message: "Only open paper orders can be cancelled." };
        }

        this.db.prepare("UPDATE paper_orders SET status = 'CANCELLED' WHERE paper_order_id = ?").run(paperOrderId);
        this.auditService.append("paper_order_cancelled", "CANCELLED", { paperOrderId });
        return { paperOrderId, status: "CANCELLED" as const };
    }

    async getPortfolio(quoteCurrency: string, marketPrices: Record<string, number> = {}) {
        await this.ensureSeeded(quoteCurrency);
        const balances = this.db
            .prepare("SELECT asset, balance FROM paper_balances ORDER BY asset ASC")
            .all() as Array<{
            asset: string;
            balance: string;
        }>;

        const assets: Array<{
            asset: string;
            quantity: number;
            estimatedPrice?: number;
            estimatedValue?: number;
            valuationStatus: "VALUED" | "QUOTE_CURRENCY" | "UNVALUED";
            portfolioWeightPercent?: number;
        }> = [];
        let totalEstimatedValue = 0;
        for (const { asset, balance } of balances) {
            const quantity = parseDecimal(balance);
            if (quantity === 0) {
                continue;
            }
            const productId = `${asset.toUpperCase()}-${quoteCurrency.toUpperCase()}`;
            const override = asset.toUpperCase() === quoteCurrency.toUpperCase() ? 1 : marketPrices[productId];
            const overrideStatus: "QUOTE_CURRENCY" | "VALUED" =
                asset.toUpperCase() === quoteCurrency.toUpperCase() ? "QUOTE_CURRENCY" : "VALUED";
            const lookup =
                override !== undefined
                    ? {
                          price: override,
                          valuationStatus: overrideStatus
                      }
                    : await this.pricingService.getPrice(asset, quoteCurrency);
            const estimatedValue = lookup.price === undefined ? undefined : quantity * lookup.price;
            totalEstimatedValue += estimatedValue ?? 0;
            assets.push({
                asset,
                quantity,
                estimatedPrice: lookup.price,
                estimatedValue,
                valuationStatus: lookup.valuationStatus
            });
        }

        for (const asset of assets) {
            asset.portfolioWeightPercent =
                totalEstimatedValue > 0 ? percent(((asset.estimatedValue ?? 0) / totalEstimatedValue) * 100) : 0;
        }

        const openOrders = (
            this.db
                .prepare(
                    "SELECT * FROM paper_orders WHERE status IN ('OPEN', 'PARTIALLY_FILLED') ORDER BY created_at ASC"
                )
                .all() as PaperOrderRow[]
        ).map(mapOrderRow);

        return { mode: "PAPER", quoteCurrency, totalEstimatedValue, assets, openOrders };
    }

    async getPerformanceReport(quoteCurrency: string, marketPrices: Record<string, number> = {}) {
        const portfolio = await this.getPortfolio(quoteCurrency, marketPrices);
        const positions = this.db
            .prepare("SELECT * FROM paper_positions ORDER BY opened_at ASC")
            .all() as PaperPositionRow[];
        const initialEquity = parseDecimal(this.getMeta("initialEquity")) || portfolio.totalEstimatedValue;
        const previousPeak = parseDecimal(this.getMeta("peakEquity")) || initialEquity;
        const peakEquity = Math.max(previousPeak, portfolio.totalEstimatedValue);
        const drawdown = peakEquity > 0 ? Math.max(0, (peakEquity - portfolio.totalEstimatedValue) / peakEquity) : 0;
        this.setMeta("initialEquity", toDecimalString(initialEquity));
        this.setMeta("peakEquity", toDecimalString(peakEquity));
        this.setMeta("latestEquity", toDecimalString(portfolio.totalEstimatedValue));
        this.setMeta("latestDrawdown", toDecimalString(drawdown));

        const realizedPnl = positions.reduce((sum, position) => sum + parseDecimal(position.realized_pnl), 0);
        const feesRow = this.db
            .prepare("SELECT COALESCE(SUM(CAST(fee AS REAL)), 0) AS fees FROM paper_orders")
            .get() as {
            fees: number;
        };
        const fees = Number(feesRow.fees);
        const counts = this.db
            .prepare("SELECT status, COUNT(*) AS count FROM paper_orders GROUP BY status")
            .all() as Array<{ status: string; count: number }>;
        const balanceByAsset = new Map(portfolio.assets.map((asset) => [asset.asset, asset.quantity]));
        const consistencyIssues = positions
            .filter((position) => position.status === "OPEN")
            .flatMap((position) => {
                const baseAsset = position.product_id.split("-")[0] ?? "";
                const tracked = parseDecimal(position.quantity);
                const balance = balanceByAsset.get(baseAsset) ?? 0;
                return balance + 1e-10 < tracked
                    ? [`${position.product_id}: tracked open quantity ${tracked} exceeds paper balance ${balance}`]
                    : [];
            });
        return {
            generatedAt: new Date().toISOString(),
            mode: "PAPER",
            portfolio,
            initialEquity,
            currentEquity: portfolio.totalEstimatedValue,
            peakEquity,
            drawdown,
            realizedPnl,
            fees,
            positions: positions.map(mapPositionRow),
            orderCounts: Object.fromEntries(counts.map((item) => [item.status, item.count])),
            positionConsistency: { ok: consistencyIssues.length === 0, issues: consistencyIssues },
            modelAssumptions: {
                feeBps: this.env.paperFeeBps,
                halfSpreadBps: this.halfSpreadBps,
                slippageBps: this.slippageBps,
                partialFillRatio: this.partialFillRatio,
                note: "Partial fills are deterministic stress assumptions, not order-book replay. Limit orders never fill worse than their limit."
            }
        };
    }

    async reset(startingBalances?: Record<string, string>) {
        this.db.exec(
            "DELETE FROM paper_orders; DELETE FROM paper_realized_events; DELETE FROM paper_positions; DELETE FROM paper_balances; DELETE FROM paper_meta;"
        );
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
        this.auditService.append("paper_seeded", "done", {
            quoteCurrency,
            source: startingBalances ? "explicit" : "auto"
        });
    }

    private get halfSpreadBps(): number {
        return this.env.paperHalfSpreadBps ?? 0;
    }

    private get slippageBps(): number {
        return this.env.paperSlippageBps ?? 0;
    }

    private get partialFillRatio(): number {
        return this.env.paperPartialFillRatio ?? 1;
    }

    private insertOrder(
        paperOrderId: string,
        clientOrderId: string,
        intent: OrderIntent,
        status: string,
        createdAt: string,
        sourceId: string,
        parentPaperOrderId?: string
    ): void {
        this.db
            .prepare(
                `INSERT INTO paper_orders (
                    paper_order_id, client_order_id, product_id, side, order_type, base_size, quote_size,
                    limit_price, stop_price, take_profit_price, stop_loss_price, parent_paper_order_id,
                    remaining_size, status, created_at, source_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                paperOrderId,
                clientOrderId,
                intent.productId,
                intent.side,
                intent.orderType,
                decimalOrNull(intent.baseSize),
                decimalOrNull(intent.quoteSize),
                decimalOrNull(intent.limitPrice),
                decimalOrNull(intent.stopPrice),
                decimalOrNull(intent.takeProfitPrice),
                decimalOrNull(intent.stopLossPrice),
                parentPaperOrderId ?? null,
                decimalOrNull(intent.baseSize),
                status,
                createdAt,
                sourceId
            );
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

    private tryFill(
        paperOrderId: string,
        intent: OrderIntent,
        marketPrice: number,
        referenceFillPrice: number,
        triggerReason: TriggerReason
    ) {
        const row = this.db.prepare("SELECT * FROM paper_orders WHERE paper_order_id = ?").get(paperOrderId) as
            | PaperOrderRow
            | undefined;
        if (!row) {
            throw new Error(`paper order not found: ${paperOrderId}`);
        }
        const fillPrice = this.executionPrice(intent, marketPrice, referenceFillPrice, triggerReason);
        const totalSize =
            intent.baseSize ?? (intent.quoteSize !== undefined && fillPrice > 0 ? intent.quoteSize / fillPrice : 0);
        const alreadyFilled = parseDecimal(row.fill_size ?? undefined);
        const remaining = parseDecimal(row.remaining_size ?? undefined) || Math.max(0, totalSize - alreadyFilled);
        const maximumChunk = intent.orderType === "MARKET" ? totalSize : totalSize * this.partialFillRatio;
        const size = Math.min(remaining, maximumChunk);
        if (size <= 0 || fillPrice <= 0) {
            return this.rejectOrder(paperOrderId, "Could not resolve a positive fill size/price.");
        }

        const feeRate = this.env.paperFeeBps / 10_000;
        const notional = size * fillPrice;
        const fee = notional * feeRate;
        if (intent.side === "BUY") {
            const cost = notional + fee;
            if (this.getBalance(intent.quoteAsset) + 1e-9 < cost) {
                return this.rejectOrder(
                    paperOrderId,
                    `Insufficient ${intent.quoteAsset} balance for paper BUY (need ${cost.toFixed(2)}).`
                );
            }
            this.adjustBalance(intent.quoteAsset, -cost);
            this.adjustBalance(intent.baseAsset, size);
        } else {
            if (this.getBalance(intent.baseAsset) + 1e-12 < size) {
                return this.rejectOrder(
                    paperOrderId,
                    `Insufficient ${intent.baseAsset} balance for paper SELL (need ${size}).`
                );
            }
            this.adjustBalance(intent.baseAsset, -size);
            this.adjustBalance(intent.quoteAsset, notional - fee);
        }

        const cumulativeSize = alreadyFilled + size;
        const previousPrice = parseDecimal(row.fill_price ?? undefined);
        const cumulativePrice =
            cumulativeSize > 0 ? (previousPrice * alreadyFilled + fillPrice * size) / cumulativeSize : fillPrice;
        const cumulativeFee = parseDecimal(row.fee ?? undefined) + fee;
        const remainingAfter = Math.max(0, totalSize - cumulativeSize);
        const complete = remainingAfter <= Math.max(1e-12, totalSize * 1e-10);
        const status = complete ? "FILLED" : "PARTIALLY_FILLED";
        const filledAt = new Date().toISOString();
        this.db
            .prepare(
                "UPDATE paper_orders SET status = ?, filled_at = ?, fill_price = ?, fill_size = ?, remaining_size = ?, fee = ?, reason = ? WHERE paper_order_id = ?"
            )
            .run(
                status,
                filledAt,
                toDecimalString(cumulativePrice),
                toDecimalString(cumulativeSize),
                toDecimalString(remainingAfter),
                toDecimalString(cumulativeFee),
                triggerReason,
                paperOrderId
            );
        this.updatePosition(intent, size, fillPrice, fee, filledAt);
        if (intent.side === "BUY" && intent.takeProfitPrice !== undefined && intent.stopLossPrice !== undefined) {
            this.createProtectionOrder(intent, size, paperOrderId, filledAt);
        }
        this.auditService.append("paper_order_fill", status, {
            paperOrderId,
            side: intent.side,
            productId: intent.productId,
            size,
            cumulativeSize,
            remainingSize: remainingAfter,
            fillPrice,
            fee,
            marketPrice,
            triggerReason
        });
        return {
            status,
            side: intent.side,
            fillPrice,
            fillSize: size,
            cumulativeFillSize: cumulativeSize,
            remainingSize: remainingAfter,
            fee
        };
    }

    private executionPrice(intent: OrderIntent, marketPrice: number, reference: number, reason: TriggerReason): number {
        const adverse = (this.halfSpreadBps + this.slippageBps) / 10_000;
        if (intent.orderType === "LIMIT" || reason === "TAKE_PROFIT") {
            return intent.limitPrice ?? reference;
        }
        const slipped = intent.side === "BUY" ? marketPrice * (1 + adverse) : marketPrice * (1 - adverse);
        if (intent.orderType === "STOP_LIMIT" && intent.limitPrice !== undefined) {
            return intent.side === "BUY" ? Math.min(slipped, intent.limitPrice) : Math.max(slipped, intent.limitPrice);
        }
        return slipped;
    }

    private updatePosition(intent: OrderIntent, size: number, fillPrice: number, fee: number, timestamp: string): void {
        const existing = this.db
            .prepare("SELECT * FROM paper_positions WHERE product_id = ? AND status = 'OPEN'")
            .get(intent.productId) as PaperPositionRow | undefined;
        if (intent.side === "BUY") {
            if (!existing) {
                this.db
                    .prepare(
                        "INSERT INTO paper_positions (position_id, product_id, quantity, average_entry_price, realized_pnl, entry_fees, exit_fees, status, opened_at) VALUES (?, ?, ?, ?, '0', ?, '0', 'OPEN', ?)"
                    )
                    .run(
                        createId("position"),
                        intent.productId,
                        toDecimalString(size),
                        toDecimalString(fillPrice),
                        toDecimalString(fee),
                        timestamp
                    );
                return;
            }
            const oldQuantity = parseDecimal(existing.quantity);
            const newQuantity = oldQuantity + size;
            const average = (oldQuantity * parseDecimal(existing.average_entry_price) + size * fillPrice) / newQuantity;
            this.db
                .prepare(
                    "UPDATE paper_positions SET quantity = ?, average_entry_price = ?, entry_fees = ? WHERE position_id = ?"
                )
                .run(
                    toDecimalString(newQuantity),
                    toDecimalString(average),
                    toDecimalString(parseDecimal(existing.entry_fees) + fee),
                    existing.position_id
                );
            return;
        }
        if (!existing) {
            return;
        }
        const oldQuantity = parseDecimal(existing.quantity);
        const sold = Math.min(size, oldQuantity);
        const entryFeeAllocation = oldQuantity > 0 ? parseDecimal(existing.entry_fees) * (sold / oldQuantity) : 0;
        const pnl = sold * (fillPrice - parseDecimal(existing.average_entry_price)) - fee - entryFeeAllocation;
        const remaining = Math.max(0, oldQuantity - sold);
        const status = remaining <= 1e-12 ? "CLOSED" : "OPEN";
        this.db
            .prepare(
                "UPDATE paper_positions SET quantity = ?, realized_pnl = ?, entry_fees = ?, exit_fees = ?, status = ?, closed_at = ? WHERE position_id = ?"
            )
            .run(
                toDecimalString(remaining),
                toDecimalString(parseDecimal(existing.realized_pnl) + pnl),
                toDecimalString(Math.max(0, parseDecimal(existing.entry_fees) - entryFeeAllocation)),
                toDecimalString(parseDecimal(existing.exit_fees) + fee),
                status,
                status === "CLOSED" ? timestamp : null,
                existing.position_id
            );
        this.db
            .prepare(
                "INSERT INTO paper_realized_events (event_id, position_id, product_id, realized_pnl, created_at) VALUES (?, ?, ?, ?, ?)"
            )
            .run(createId("paperpnl"), existing.position_id, intent.productId, toDecimalString(pnl), timestamp);
    }

    private createProtectionOrder(
        intent: OrderIntent,
        size: number,
        parentPaperOrderId: string,
        createdAt: string
    ): void {
        const protection: OrderIntent = {
            productId: intent.productId,
            baseAsset: intent.baseAsset,
            quoteAsset: intent.quoteAsset,
            side: "SELL",
            orderType: "BRACKET",
            baseSize: size,
            limitPrice: intent.takeProfitPrice,
            stopPrice: intent.stopLossPrice
        };
        const protectionId = createId("paper");
        this.insertOrder(
            protectionId,
            `${parentPaperOrderId}-protection`,
            protection,
            "OPEN",
            createdAt,
            parentPaperOrderId,
            parentPaperOrderId
        );
        this.auditService.append("paper_protection_created", "OPEN", {
            paperOrderId: protectionId,
            parentPaperOrderId,
            takeProfitPrice: intent.takeProfitPrice,
            stopLossPrice: intent.stopLossPrice,
            size
        });
    }

    private rejectOrder(paperOrderId: string, reason: string) {
        this.db
            .prepare("UPDATE paper_orders SET status = 'REJECTED', reason = ? WHERE paper_order_id = ?")
            .run(reason, paperOrderId);
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
        const row = this.db.prepare("SELECT value FROM paper_meta WHERE key = ?").get(key) as
            | { value: string }
            | undefined;
        return row?.value;
    }

    private setMeta(key: string, value: string): void {
        this.db
            .prepare(
                "INSERT INTO paper_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
            )
            .run(key, value);
    }
}

function parseIntent(payload: CoinbaseOrderPayload): OrderIntent {
    const [base, quote] = payload.product_id.split("-");
    const [configKey, config] = Object.entries(payload.order_configuration)[0];
    const num = (value: string | boolean | undefined): number | undefined =>
        typeof value === "string" && value.length > 0 ? parseDecimal(value) : undefined;
    const attached = payload.attached_order_configuration?.trigger_bracket_gtc;
    return {
        productId: payload.product_id,
        baseAsset: (base ?? "").toUpperCase(),
        quoteAsset: (quote ?? "").toUpperCase(),
        side: payload.side,
        orderType: orderTypeFromConfigKey(configKey),
        baseSize: num(config.base_size),
        quoteSize: num(config.quote_size),
        limitPrice: num(config.limit_price),
        stopPrice: num(config.stop_price ?? config.stop_trigger_price),
        takeProfitPrice: num(attached?.limit_price),
        stopLossPrice: num(attached?.stop_trigger_price)
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
        stopPrice: num(row.stop_price),
        takeProfitPrice: num(row.take_profit_price),
        stopLossPrice: num(row.stop_loss_price)
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

function shouldFill(intent: OrderIntent, price: number): { fill: boolean; fillPrice: number; reason: TriggerReason } {
    const noFill = { fill: false, fillPrice: 0, reason: "LIMIT" as const };
    if (intent.orderType === "LIMIT") {
        if (intent.limitPrice === undefined) {
            return noFill;
        }
        if (
            (intent.side === "BUY" && price <= intent.limitPrice) ||
            (intent.side === "SELL" && price >= intent.limitPrice)
        ) {
            return { fill: true, fillPrice: intent.limitPrice, reason: "LIMIT" };
        }
        return noFill;
    }
    if (intent.orderType === "STOP_LIMIT") {
        if (intent.stopPrice === undefined || intent.limitPrice === undefined) {
            return noFill;
        }
        if (
            (intent.side === "SELL" && price <= intent.stopPrice && price >= intent.limitPrice) ||
            (intent.side === "BUY" && price >= intent.stopPrice && price <= intent.limitPrice)
        ) {
            return { fill: true, fillPrice: intent.limitPrice, reason: "STOP" };
        }
        return noFill;
    }
    if (intent.orderType === "BRACKET" && intent.side === "SELL") {
        if (intent.stopPrice !== undefined && price <= intent.stopPrice) {
            return { fill: true, fillPrice: price, reason: "STOP" };
        }
        if (intent.limitPrice !== undefined && price >= intent.limitPrice) {
            return { fill: true, fillPrice: intent.limitPrice, reason: "TAKE_PROFIT" };
        }
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
        remainingSize: row.remaining_size ?? undefined,
        status: row.status,
        parentPaperOrderId: row.parent_paper_order_id ?? undefined,
        createdAt: row.created_at
    };
}

function mapPositionRow(row: PaperPositionRow) {
    return {
        positionId: row.position_id,
        productId: row.product_id,
        quantity: parseDecimal(row.quantity),
        averageEntryPrice: parseDecimal(row.average_entry_price),
        realizedPnl: parseDecimal(row.realized_pnl),
        entryFees: parseDecimal(row.entry_fees),
        exitFees: parseDecimal(row.exit_fees),
        status: row.status,
        openedAt: row.opened_at,
        closedAt: row.closed_at ?? undefined
    };
}

function decimalOrNull(value: number | undefined): string | null {
    return value === undefined ? null : toDecimalString(value);
}

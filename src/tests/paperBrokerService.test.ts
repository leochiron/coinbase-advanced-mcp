import { beforeEach, describe, expect, it } from "vitest";
import type { CoinbaseOrderPayload } from "../coinbase/coinbaseTypes.js";
import { AuditService } from "../services/auditService.js";
import { PaperBrokerService } from "../services/paperBrokerService.js";
import type { PortfolioService } from "../services/portfolioService.js";
import type { PricingService } from "../services/pricingService.js";
import { createAuditDatabase } from "../storage/database.js";

const paperEnv = { paperStartingCash: "10000", paperFeeBps: 60, defaultQuoteCurrency: "EUR", coinbaseConfigured: false };

// Mutable market price the fake pricing service reports.
let marketPrice = 100;

function createFakes() {
    const pricingService = {
        getProductTicker: async (productId: string) => ({ productId, price: String(marketPrice) }),
        getPrice: async (asset: string, quoteCurrency: string) =>
            asset === quoteCurrency
                ? { asset, quoteCurrency, price: 1, valuationStatus: "QUOTE_CURRENCY" as const }
                : { asset, quoteCurrency, price: marketPrice, valuationStatus: "VALUED" as const }
    } as unknown as PricingService;

    const portfolioService = {
        getSnapshot: async () => ({ assets: [], totalEstimatedValue: 0, quoteCurrency: "EUR", unvaluedAssets: [] })
    } as unknown as PortfolioService;

    return { pricingService, portfolioService };
}

function marketBuy(quoteSize: string): CoinbaseOrderPayload {
    return {
        client_order_id: "codex-mb",
        product_id: "BTC-EUR",
        side: "BUY",
        order_configuration: { market_market_ioc: { quote_size: quoteSize } }
    };
}

function limitBuy(baseSize: string, limitPrice: string): CoinbaseOrderPayload {
    return {
        client_order_id: "codex-lb",
        product_id: "BTC-EUR",
        side: "BUY",
        order_configuration: { limit_limit_gtc: { base_size: baseSize, limit_price: limitPrice, post_only: false } }
    };
}

function protectedLimitBuy(baseSize: string, limitPrice: string, takeProfit: string, stopLoss: string): CoinbaseOrderPayload {
    return {
        ...limitBuy(baseSize, limitPrice),
        attached_order_configuration: {
            trigger_bracket_gtc: { limit_price: takeProfit, stop_trigger_price: stopLoss }
        }
    };
}

function stopSell(baseSize: string, stopPrice: string, limitPrice: string): CoinbaseOrderPayload {
    return {
        client_order_id: "codex-ss",
        product_id: "BTC-EUR",
        side: "SELL",
        order_configuration: {
            stop_limit_stop_limit_gtc: {
                base_size: baseSize,
                limit_price: limitPrice,
                stop_price: stopPrice,
                stop_direction: "STOP_DIRECTION_STOP_DOWN"
            }
        }
    };
}

function createBroker() {
    const db = createAuditDatabase(":memory:");
    const audit = new AuditService(db);
    const { pricingService, portfolioService } = createFakes();
    return new PaperBrokerService(db, audit, pricingService, portfolioService, paperEnv);
}

function createBrokerWithEnv(overrides: Partial<typeof paperEnv>) {
    const db = createAuditDatabase(":memory:");
    const audit = new AuditService(db);
    const { pricingService, portfolioService } = createFakes();
    return new PaperBrokerService(db, audit, pricingService, portfolioService, { ...paperEnv, ...overrides });
}

async function balanceOf(broker: PaperBrokerService, asset: string): Promise<number> {
    const portfolio = await broker.getPortfolio("EUR");
    return portfolio.assets.find((a) => a.asset === asset)?.quantity ?? 0;
}

describe("PaperBrokerService", () => {
    beforeEach(() => {
        marketPrice = 100;
    });

    it("seeds a cash portfolio when Coinbase is not configured", async () => {
        const broker = createBroker();
        const portfolio = await broker.getPortfolio("EUR");
        expect(portfolio.assets.find((a) => a.asset === "EUR")?.quantity).toBe(10000);
    });

    it("fills a MARKET buy immediately and debits cash plus fee", async () => {
        const broker = createBroker();
        marketPrice = 100;

        const result = await broker.submitOrder(marketBuy("1000"), "dryrun_x");

        expect(result.status).toBe("FILLED");
        // size = 1000 / 100 = 10 BTC; cost = 1000 + 0.6% fee = 1006.
        expect(await balanceOf(broker, "BTC")).toBeCloseTo(10, 6);
        expect(await balanceOf(broker, "EUR")).toBeCloseTo(8994, 6);
    });

    it("keeps a LIMIT buy resting until the market crosses, then fills at the limit", async () => {
        const broker = createBroker();
        marketPrice = 100;

        const submitted = await broker.submitOrder(limitBuy("1", "90"), "dryrun_x");
        expect(submitted.status).toBe("OPEN");

        // Market still above the limit -> no fill.
        const first = await broker.processFills();
        expect(first.filled).toBe(0);

        // Market drops to/below the limit -> fill at the limit price (90), fee 0.54.
        marketPrice = 85;
        const second = await broker.processFills();
        expect(second.filled).toBe(1);
        expect(await balanceOf(broker, "BTC")).toBeCloseTo(1, 6);
        expect(await balanceOf(broker, "EUR")).toBeCloseTo(10000 - 90 - 0.54, 6);
    });

    it("triggers a STOP SELL when the price falls to the stop", async () => {
        const broker = createBroker();
        // Acquire BTC first via a market buy.
        marketPrice = 100;
        await broker.submitOrder(marketBuy("1000"), "dryrun_x"); // 10 BTC

        await broker.submitOrder(stopSell("5", "85", "80"), "dryrun_y");

        marketPrice = 90; // above stop -> no trigger
        expect((await broker.processFills()).filled).toBe(0);

        marketPrice = 84; // at/below stop -> trigger, fill at limit 80
        const filled = await broker.processFills();
        expect(filled.filled).toBe(1);
        expect(await balanceOf(broker, "BTC")).toBeCloseTo(5, 6);
    });

    it("rejects an order when the simulated balance is insufficient", async () => {
        const broker = createBroker();
        const result = await broker.submitOrder(marketBuy("999999"), "dryrun_x");
        expect(result.status).toBe("REJECTED");
        // Cash unchanged.
        expect(await balanceOf(broker, "EUR")).toBe(10000);
    });

    it("cancels an open resting order", async () => {
        const broker = createBroker();
        const submitted = await broker.submitOrder(limitBuy("1", "90"), "dryrun_x");
        const cancelled = broker.cancelOrder(submitted.paperOrderId);
        expect(cancelled.status).toBe("CANCELLED");
        expect((await broker.processFills()).evaluated).toBe(0);
    });

    it("supports deterministic partial fills for resting orders", async () => {
        const broker = createBrokerWithEnv({ paperPartialFillRatio: 0.5 });
        await broker.submitOrder(limitBuy("1", "100"), "dryrun_partial");
        marketPrice = 90;
        const first = await broker.processFills();
        expect(first.partiallyFilled).toBe(1);
        expect(await balanceOf(broker, "BTC")).toBeCloseTo(0.5, 8);
        const second = await broker.processFills();
        expect(second.filled).toBe(1);
        expect(await balanceOf(broker, "BTC")).toBeCloseTo(1, 8);
    });

    it("creates and fills attached paper protection after an entry fill", async () => {
        const broker = createBroker();
        await broker.submitOrder(protectedLimitBuy("1", "100", "110", "90"), "dryrun_protected");
        marketPrice = 95;
        expect((await broker.processFills()).filled).toBe(1);
        expect((await broker.getPortfolio("EUR")).openOrders.some((order) => order.orderType === "BRACKET")).toBe(true);
        marketPrice = 111;
        expect((await broker.processFills()).filled).toBe(1);
        expect(await balanceOf(broker, "BTC")).toBeCloseTo(0, 8);
        const performance = await broker.getPerformanceReport("EUR");
        expect(performance.realizedPnl).toBeGreaterThan(0);
    });

    it("charges adverse spread and slippage to market orders", async () => {
        const broker = createBrokerWithEnv({ paperHalfSpreadBps: 2, paperSlippageBps: 3 });
        const fill = await broker.submitOrder(marketBuy("1000"), "dryrun_costs", 100);
        expect(fill.fillPrice).toBeCloseTo(100.05, 8);
        expect(await balanceOf(broker, "BTC")).toBeLessThan(10);
    });
});

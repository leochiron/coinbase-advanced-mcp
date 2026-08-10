import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperReportService } from "../research/paperReportService.js";
import { ResearchAutomationService } from "../research/researchAutomationService.js";
import { ResearchCircuitBreaker } from "../research/researchCircuitBreaker.js";
import { ResearchProposalBridge } from "../research/researchProposalBridge.js";
import { AuditService } from "../services/auditService.js";
import { OrderProposalService } from "../services/orderProposalService.js";
import { PaperBrokerService } from "../services/paperBrokerService.js";
import type { PortfolioService } from "../services/portfolioService.js";
import type { PricingService } from "../services/pricingService.js";
import { createAuditDatabase } from "../storage/database.js";
import { researchDecision } from "./researchTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const path of temporaryDirectories.splice(0)) {
        rmSync(path, { recursive: true, force: true });
    }
});

function harness(mode: "OBSERVE" | "PAPER") {
    const db = createAuditDatabase(":memory:");
    const audit = new AuditService(db);
    const ticker = vi.fn(async () => ({ productId: "BTC-EUR", price: "90" }));
    const pricing = {
        getProductTicker: ticker,
        getPrice: async (asset: string, quoteCurrency: string) => ({
            asset,
            quoteCurrency,
            price: asset === quoteCurrency ? 1 : 90,
            valuationStatus: asset === quoteCurrency ? ("QUOTE_CURRENCY" as const) : ("VALUED" as const)
        })
    } as unknown as PricingService;
    const portfolio = { getSnapshot: async () => ({ assets: [] }) } as unknown as PortfolioService;
    const broker = new PaperBrokerService(db, audit, pricing, portfolio, {
        paperStartingCash: "10000",
        paperFeeBps: 10,
        paperHalfSpreadBps: 1,
        paperSlippageBps: 3,
        paperPartialFillRatio: 1,
        defaultQuoteCurrency: "EUR",
        coinbaseConfigured: false
    });
    const reports = mkdtempSync(join(tmpdir(), "research-paper-reports-"));
    temporaryDirectories.push(reports);
    const bridge = new ResearchProposalBridge(audit, new OrderProposalService(audit), 90);
    const breaker = new ResearchCircuitBreaker(audit, {
        researchEmergencyStopPath: join(reports, "STOP"),
        researchMaxDailyLossEur: 50,
        researchMaxOrdersPerDay: 20,
        researchMaxOpenOrders: 6,
        researchBlockExtremeVolatility: true
    });
    const service = new ResearchAutomationService(
        { researchAutomationMode: mode, defaultQuoteCurrency: "EUR" },
        audit,
        bridge,
        broker,
        breaker,
        new PaperReportService(reports)
    );
    return { service, audit, ticker };
}

describe("ResearchAutomationService", () => {
    it("runs a full paper cycle without a Coinbase price or order call", async () => {
        const { service, ticker } = harness("PAPER");
        const result = await service.runDecision(researchDecision(), new Date("2026-01-01T12:10:00Z"));
        expect(result.status).toBe("PAPER_SUBMITTED");
        expect(result.performance.positions.some((position) => position.status === "OPEN")).toBe(true);
        expect(result.executionComparison).toMatchObject({ priceVarianceBps: 0 });
        expect(ticker).not.toHaveBeenCalled();
    });

    it("creates audit artifacts but no paper order in OBSERVE mode", async () => {
        const { service, audit } = harness("OBSERVE");
        const result = await service.runDecision(researchDecision(), new Date("2026-01-01T12:10:00Z"));
        expect(result.status).toBe("DRY_RUN_ONLY");
        expect(audit.countPaperOrdersSince("2020-01-01T00:00:00Z")).toBe(0);
        expect(result.dryRunId).toMatch(/^dryrun_/);
    });

    it("blocks new entries during extreme volatility", async () => {
        const { service, audit } = harness("PAPER");
        const artifact = researchDecision({
            risk: { halt: false, extremeVolatility: true, maximumRiskEur: 10, estimatedLossAtStopEur: 10 }
        });
        const result = await service.runDecision(artifact, new Date("2026-01-01T12:10:00Z"));
        expect(result.status).toBe("HALTED");
        expect(audit.countPaperOrdersSince("2020-01-01T00:00:00Z")).toBe(0);
    });
});

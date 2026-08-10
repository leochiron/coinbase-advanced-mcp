import type { AppEnv } from "../config/env.js";
import type { AuditService } from "../services/auditService.js";
import type { PaperBrokerService } from "../services/paperBrokerService.js";
import type { PaperReportService } from "./paperReportService.js";
import type { ResearchCircuitBreaker } from "./researchCircuitBreaker.js";
import type { ResearchProposalBridge } from "./researchProposalBridge.js";

type AutomationEnv = Pick<AppEnv, "researchAutomationMode" | "defaultQuoteCurrency">;

export class ResearchAutomationService {
    constructor(
        private readonly env: AutomationEnv,
        private readonly auditService: AuditService,
        private readonly bridge: ResearchProposalBridge,
        private readonly paperBroker: PaperBrokerService,
        private readonly circuitBreaker: ResearchCircuitBreaker,
        private readonly reportService: PaperReportService
    ) {}

    async runDecision(input: unknown, now = new Date()) {
        try {
            if (this.env.researchAutomationMode === "OFF") {
                throw new Error("Research automation is OFF");
            }
            const artifact = this.bridge.validate(input, now);
            const marketPrices = Object.fromEntries(
                Object.entries(artifact.marketPricesEur).map(([productId, price]) => [productId, Number(price)])
            );

            // Existing entries and protections are processed first. A halt blocks new risk, not risk reduction.
            const fillsBeforeDecision = await this.paperBroker.processFills(marketPrices);
            let performance = await this.paperBroker.getPerformanceReport(this.env.defaultQuoteCurrency, marketPrices);
            if (artifact.decision === "LONG") {
                const breaker = this.circuitBreaker.evaluate(artifact, performance, now);
                if (!breaker.allowed) {
                    const automation = {
                        status: "HALTED",
                        decision: artifact.decision,
                        artifactId: artifact.artifactId,
                        reasons: breaker.reasons,
                        fillsBeforeDecision
                    };
                    const reports = this.reportService.write(performance, automation, now);
                    return { ...automation, reports, performance };
                }
            }

            const imported = this.bridge.import(artifact, now);
            let paperOrder: unknown;
            let fillsAfterDecision: unknown;
            let executionComparison: Record<string, unknown> | undefined;
            if (imported.status === "IMPORTED" && this.env.researchAutomationMode === "PAPER") {
                const dryRun = this.auditService.getDryRun(imported.dryRunId);
                if (!dryRun) {
                    throw new Error(`Imported dry-run was not found: ${imported.dryRunId}`);
                }
                const productPrice = marketPrices[dryRun.payload.product_id];
                paperOrder = await this.paperBroker.submitOrder(dryRun.payload, imported.dryRunId, productPrice);
                fillsAfterDecision = await this.paperBroker.processFills(marketPrices);
                performance = await this.paperBroker.getPerformanceReport(this.env.defaultQuoteCurrency, marketPrices);
                executionComparison = compareExpectedToPaper(artifact, paperOrder, fillsAfterDecision);
            }

            const status =
                imported.status === "NO_TRADE"
                    ? "NO_TRADE"
                    : imported.status === "DUPLICATE"
                      ? "DUPLICATE_IGNORED"
                      : this.env.researchAutomationMode === "OBSERVE"
                        ? "DRY_RUN_ONLY"
                        : "PAPER_SUBMITTED";
            const automation = {
                status,
                decision: artifact.decision,
                artifactId: artifact.artifactId,
                proposalId: imported.status === "IMPORTED" ? imported.proposalId : undefined,
                dryRunId: imported.status === "IMPORTED" ? imported.dryRunId : undefined,
                paperOrder,
                executionComparison,
                fillsBeforeDecision,
                fillsAfterDecision
            };
            const reports = this.reportService.write(performance, automation, now);
            this.auditService.append("research_automation_cycle", status, automation);
            this.circuitBreaker.recordSuccess();
            return { ...automation, reports, performance };
        } catch (error) {
            this.circuitBreaker.recordFailure(error);
            throw error;
        }
    }
}

function compareExpectedToPaper(
    artifact: ReturnType<ResearchProposalBridge["validate"]>,
    paperOrder: unknown,
    fills: unknown
): Record<string, unknown> {
    const expectedPrice = Number(artifact.orderIntent?.limitPrice ?? 0);
    const expectedUnits = Number(artifact.orderIntent?.baseSize ?? 0);
    const order = paperOrder as { status?: unknown; fillPrice?: unknown; fillSize?: unknown } | undefined;
    const fillBatch = fills as { results?: Array<{ fillPrice?: unknown; cumulativeFillSize?: unknown }> } | undefined;
    const latestFill = fillBatch?.results?.find((item) => Number(item.fillPrice) > 0);
    const simulatedPrice = Number(order?.fillPrice ?? latestFill?.fillPrice ?? 0);
    const simulatedUnits = Number(order?.fillSize ?? latestFill?.cumulativeFillSize ?? 0);
    return {
        expectedLimitPrice: expectedPrice,
        expectedUnits,
        expectedPositionValue: artifact.research?.positionValueEur,
        expectedMaximumRisk: artifact.research?.maximumRiskEur,
        paperOrderStatus: typeof order?.status === "string" ? order.status : "OPEN",
        simulatedFillPrice: simulatedPrice || undefined,
        simulatedFillUnits: simulatedUnits || undefined,
        simulatedNotional: simulatedPrice > 0 && simulatedUnits > 0 ? simulatedPrice * simulatedUnits : undefined,
        priceVarianceBps:
            simulatedPrice > 0 && expectedPrice > 0 ? (simulatedPrice / expectedPrice - 1) * 10_000 : undefined
    };
}

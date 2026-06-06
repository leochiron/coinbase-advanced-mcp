import type { AppEnv } from "../config/env.js";
import type { AllocationService } from "../services/allocationService.js";
import type { AuditService } from "../services/auditService.js";
import type { KnowledgeService } from "../services/knowledgeService.js";
import type { OrderExecutionService } from "../services/orderExecutionService.js";
import type { OrderProposalService } from "../services/orderProposalService.js";
import type { PaperBrokerService } from "../services/paperBrokerService.js";
import type { PortfolioService } from "../services/portfolioService.js";
import type { PricingService } from "../services/pricingService.js";

export type ToolContext = {
    env: AppEnv;
    auditService: AuditService;
    portfolioService: PortfolioService;
    pricingService: PricingService;
    allocationService: AllocationService;
    orderProposalService: OrderProposalService;
    orderExecutionService: OrderExecutionService;
    paperBrokerService: PaperBrokerService;
    knowledgeService: KnowledgeService;
};

export function toolResult(output: unknown) {
    return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
        structuredContent: output as Record<string, unknown>
    };
}

export function toolError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
        content: [{ type: "text" as const, text: message }],
        isError: true
    };
}

export async function safeTool(handler: () => unknown) {
    try {
        return toolResult(await handler());
    } catch (error) {
        return toolError(error);
    }
}

import { describe, expect, it } from "vitest";
import { ResearchProposalBridge } from "../research/researchProposalBridge.js";
import { OrderProposalService } from "../services/orderProposalService.js";
import { createTestAuditService } from "./testHelpers.js";
import { noTradeDecision, researchDecision } from "./researchTestFixtures.js";

const now = new Date("2026-01-01T12:10:00Z");

describe("ResearchProposalBridge", () => {
    it("stores a TypeScript proposal and matching dry-run for a fresh LONG", () => {
        const audit = createTestAuditService();
        const bridge = new ResearchProposalBridge(audit, new OrderProposalService(audit), 90);
        const result = bridge.import(researchDecision(), now);
        expect(result.status).toBe("IMPORTED");
        if (result.status !== "IMPORTED") {
            throw new Error("Expected import");
        }
        const proposal = audit.getProposal(result.proposalId);
        const dryRun = audit.getDryRun(result.dryRunId);
        expect(proposal?.orders[0]).toEqual(dryRun?.payload);
        expect(dryRun?.payload.product_id).toBe("BTC-EUR");
    });

    it("records NO_TRADE without creating an order artifact", () => {
        const audit = createTestAuditService();
        const bridge = new ResearchProposalBridge(audit, new OrderProposalService(audit), 90);
        expect(bridge.import(noTradeDecision(), now).status).toBe("NO_TRADE");
        expect(audit.listAuditLog().some((entry) => (entry as { action: string }).action === "order_dry_run")).toBe(
            false
        );
    });

    it("ignores the same signal candle and strategy on a second import", () => {
        const audit = createTestAuditService();
        const bridge = new ResearchProposalBridge(audit, new OrderProposalService(audit), 90);
        bridge.import(researchDecision(), now);
        const duplicate = bridge.import(researchDecision(), now);
        expect(duplicate.status).toBe("DUPLICATE");
    });

    it("rejects stale decisions before creating a proposal", () => {
        const audit = createTestAuditService();
        const bridge = new ResearchProposalBridge(audit, new OrderProposalService(audit), 30);
        expect(() => bridge.import(researchDecision(), new Date("2026-01-01T13:00:00Z"))).toThrow(/stale|expired/i);
        expect(audit.listAuditLog()).toHaveLength(0);
    });

    it("rejects a tampered deduplication identity", () => {
        const audit = createTestAuditService();
        const bridge = new ResearchProposalBridge(audit, new OrderProposalService(audit), 90);
        const tampered = researchDecision();
        tampered.dedupeKey = "f".repeat(64);
        expect(() => bridge.import(tampered, now)).toThrow(/identity/i);
        expect(audit.listAuditLog()).toHaveLength(0);
    });
});

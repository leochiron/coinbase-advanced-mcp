import { describe, expect, it } from "vitest";
import { ResearchCircuitBreaker } from "../research/researchCircuitBreaker.js";
import { createTestAuditService } from "./testHelpers.js";
import { researchDecision } from "./researchTestFixtures.js";

function breaker() {
    const audit = createTestAuditService();
    return {
        audit,
        service: new ResearchCircuitBreaker(audit, {
            researchEmergencyStopPath: "Z:/definitely-missing/research-stop",
            researchMaxDailyLossEur: 50,
            researchMaxOrdersPerDay: 20,
            researchMaxOpenOrders: 6,
            researchBlockExtremeVolatility: true
        })
    };
}

describe("ResearchCircuitBreaker", () => {
    it("halts new entries at the fixed 10% paper drawdown", () => {
        const { service } = breaker();
        const result = service.evaluate(researchDecision(), {
            drawdown: 0.1,
            positionConsistency: { ok: true, issues: [] }
        });
        expect(result.allowed).toBe(false);
        expect(result.reasons.join(" ")).toMatch(/drawdown/i);
    });

    it("requires operator review after three consecutive failures", () => {
        const { audit, service } = breaker();
        service.recordFailure(new Error("one"));
        service.recordFailure(new Error("two"));
        service.recordFailure(new Error("three"));
        const result = service.evaluate(researchDecision(), {
            drawdown: 0,
            positionConsistency: { ok: true, issues: [] }
        });
        expect(audit.getAutomationState("automationHalt")).toBe("true");
        expect(result.reasons.join(" ")).toMatch(/three consecutive failures/i);
    });

    it("blocks an inconsistent local paper portfolio", () => {
        const { service } = breaker();
        const result = service.evaluate(researchDecision(), {
            drawdown: 0,
            positionConsistency: { ok: false, issues: ["BTC balance mismatch"] }
        });
        expect(result.reasons.join(" ")).toMatch(/inconsistent/i);
    });
});

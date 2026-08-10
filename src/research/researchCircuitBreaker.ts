import { existsSync } from "node:fs";
import type { AppEnv } from "../config/env.js";
import type { AuditService } from "../services/auditService.js";
import type { ResearchDecision } from "./proposalContract.js";

type BreakerEnv = Pick<
    AppEnv,
    | "researchEmergencyStopPath"
    | "researchMaxDailyLossEur"
    | "researchMaxOrdersPerDay"
    | "researchMaxOpenOrders"
    | "researchBlockExtremeVolatility"
>;

export type CircuitBreakerResult = { allowed: boolean; reasons: string[] };

export class ResearchCircuitBreaker {
    constructor(
        private readonly auditService: AuditService,
        private readonly env: BreakerEnv
    ) {}

    evaluate(
        artifact: ResearchDecision,
        performance: { drawdown: number; positionConsistency?: { ok: boolean; issues: string[] } },
        now = new Date()
    ): CircuitBreakerResult {
        const reasons: string[] = [];
        if (existsSync(this.env.researchEmergencyStopPath)) {
            reasons.push(`Emergency stop file is present: ${this.env.researchEmergencyStopPath}`);
        }
        if (artifact.risk.halt) {
            reasons.push("The research engine declared RISK_HALT");
        }
        if (this.env.researchBlockExtremeVolatility && artifact.risk.extremeVolatility) {
            reasons.push("Extreme market volatility blocks new paper entries");
        }
        if (performance.drawdown >= 0.1) {
            reasons.push("Paper portfolio drawdown reached the fixed 10% halt threshold");
        }
        if (performance.positionConsistency && !performance.positionConsistency.ok) {
            reasons.push(`Paper portfolio state is inconsistent: ${performance.positionConsistency.issues.join("; ")}`);
        }
        const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
        const dailyPnl = this.auditService.realizedPaperPnlSince(dayStart);
        if (dailyPnl <= -this.env.researchMaxDailyLossEur) {
            reasons.push(`Daily realized paper loss reached EUR ${Math.abs(dailyPnl).toFixed(2)}`);
        }
        if (this.auditService.countPaperOrdersSince(dayStart) >= this.env.researchMaxOrdersPerDay) {
            reasons.push("Maximum paper orders per UTC day reached");
        }
        if (this.auditService.countOpenPaperOrders() >= this.env.researchMaxOpenOrders) {
            reasons.push("Maximum open paper orders reached");
        }
        if (this.auditService.getAutomationState("automationHalt") === "true") {
            reasons.push("Automation halted after three consecutive failures; operator review is required");
        }
        const result = { allowed: reasons.length === 0, reasons };
        this.auditService.setAutomationState(
            "latestCircuitBreaker",
            JSON.stringify({ ...result, checkedAt: now.toISOString() })
        );
        if (!result.allowed) {
            this.auditService.append("research_circuit_breaker", "HALTED", {
                artifactId: artifact.artifactId,
                reasons
            });
        }
        return result;
    }

    recordSuccess(): void {
        this.auditService.setAutomationState("consecutiveFailures", "0");
    }

    recordFailure(error: unknown): void {
        const failures = Number(this.auditService.getAutomationState("consecutiveFailures") ?? "0") + 1;
        this.auditService.setAutomationState("consecutiveFailures", String(failures));
        if (failures >= 3) {
            this.auditService.setAutomationState("automationHalt", "true");
        }
        this.auditService.append("research_automation_failure", failures >= 3 ? "HALTED" : "FAILED", {
            failures,
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

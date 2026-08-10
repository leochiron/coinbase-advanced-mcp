import { createHash } from "node:crypto";
import type { AuditService } from "../services/auditService.js";
import type { OrderProposalService } from "../services/orderProposalService.js";
import { parseResearchDecision, type ResearchDecision } from "./proposalContract.js";

export type BridgeResult =
    | { status: "NO_TRADE"; artifact: ResearchDecision }
    | { status: "DUPLICATE"; artifact: ResearchDecision; proposalId?: string; dryRunId?: string }
    | { status: "IMPORTED"; artifact: ResearchDecision; proposalId: string; dryRunId: string };

export class ResearchProposalBridge {
    constructor(
        private readonly auditService: AuditService,
        private readonly orderProposalService: OrderProposalService,
        private readonly maxAgeMinutes: number
    ) {}

    validate(input: unknown, now = new Date()): ResearchDecision {
        const artifact = parseResearchDecision(input);
        this.assertIdentity(artifact);
        this.assertFresh(artifact, now);
        return artifact;
    }

    import(input: unknown, now = new Date()): BridgeResult {
        const artifact = this.validate(input, now);

        const existing = this.auditService.getResearchImportByDedupeKey(artifact.dedupeKey);
        if (existing) {
            this.auditService.append("research_decision_duplicate", "IGNORED", {
                artifactId: artifact.artifactId,
                dedupeKey: artifact.dedupeKey,
                originalArtifactId: existing.artifactId
            });
            return {
                status: "DUPLICATE",
                artifact,
                proposalId: existing.proposalId,
                dryRunId: existing.dryRunId
            };
        }

        if (artifact.decision === "NO_TRADE") {
            this.auditService.saveResearchImport({
                artifactId: artifact.artifactId,
                dedupeKey: artifact.dedupeKey,
                decision: artifact.decision,
                status: "NO_TRADE",
                payload: artifact
            });
            return { status: "NO_TRADE", artifact };
        }

        if (
            artifact.risk.halt ||
            artifact.research?.sizingAllowed !== true ||
            artifact.research.strategyEligible !== true
        ) {
            throw new Error("Research decision is not risk-valid and eligible");
        }

        const intent = artifact.orderIntent;
        if (!intent) {
            throw new Error("LONG decision is missing its order intent");
        }
        const proposal = this.orderProposalService.proposeLimitOrders([
            {
                productId: intent.productId,
                side: intent.side,
                baseSize: intent.baseSize,
                quoteSize: intent.quoteSize,
                limitPrice: intent.limitPrice as string,
                takeProfitPrice: intent.takeProfitPrice,
                stopLossPrice: intent.stopLossPrice,
                timeInForce: intent.timeInForce
            }
        ]);
        const payload = proposal.orders[0];
        if (!payload) {
            throw new Error("The TypeScript proposal service returned no order");
        }
        const dryRun = this.auditService.saveDryRun(payload);
        this.auditService.saveResearchImport({
            artifactId: artifact.artifactId,
            dedupeKey: artifact.dedupeKey,
            decision: artifact.decision,
            status: "IMPORTED_PAPER_ONLY",
            proposalId: proposal.proposalId,
            dryRunId: dryRun.dryRunId,
            payload: artifact
        });
        return {
            status: "IMPORTED",
            artifact,
            proposalId: proposal.proposalId,
            dryRunId: dryRun.dryRunId
        };
    }

    private assertFresh(artifact: ResearchDecision, now: Date): void {
        const generated = new Date(artifact.generatedAt);
        const expires = new Date(artifact.expiresAt);
        const closed = new Date(artifact.closedCandleAt);
        const maximumAgeMs = this.maxAgeMinutes * 60_000;
        if (generated.getTime() > now.getTime() + 5 * 60_000) {
            throw new Error("Research decision timestamp is in the future");
        }
        if (closed.getTime() > generated.getTime()) {
            throw new Error("Research decision does not reference a closed candle");
        }
        if (expires.getTime() <= generated.getTime()) {
            throw new Error("Research decision expiry must be after generation");
        }
        if (artifact.sourceEvidence.some((item) => new Date(item.latestClosedCandle).getTime() > generated.getTime())) {
            throw new Error(
                "Research decision contains source evidence from a candle that was not closed at generation time"
            );
        }
        if (now.getTime() > expires.getTime() || now.getTime() - generated.getTime() > maximumAgeMs) {
            throw new Error("Research decision is stale or expired");
        }
    }

    private assertIdentity(artifact: ResearchDecision): void {
        const material = [
            artifact.schemaVersion,
            artifact.decision,
            artifact.orderIntent?.productId ?? "NONE",
            artifact.research?.strategy ?? "NONE",
            artifact.closedCandleAt
        ].join("|");
        const expected = createHash("sha256").update(material, "utf8").digest("hex");
        if (artifact.dedupeKey !== expected || artifact.artifactId !== `research_${expected.slice(0, 24)}`) {
            throw new Error(
                "Research decision identity does not match its strategy, product, decision, and closed candle"
            );
        }
    }
}

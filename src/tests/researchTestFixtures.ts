import { createHash } from "node:crypto";
import type { ResearchDecision } from "../research/proposalContract.js";

export function researchDecision(overrides: Partial<ResearchDecision> = {}): ResearchDecision {
    const artifact: ResearchDecision = {
        schemaName: "crypto-research-decision",
        schemaVersion: "1.0.0",
        artifactId: "research_aaaaaaaaaaaaaaaaaaaaaaaa",
        dedupeKey: "a".repeat(64),
        generatedAt: "2026-01-01T12:00:00Z",
        expiresAt: "2026-01-01T13:30:00Z",
        closedCandleAt: "2026-01-01T10:59:59Z",
        mode: "PAPER_ANALYSIS_ONLY",
        decision: "LONG",
        dataStatus: "PASS",
        orderIntent: {
            productId: "BTC-EUR",
            side: "BUY",
            orderType: "LIMIT",
            baseSize: "1",
            limitPrice: "100",
            takeProfitPrice: "110",
            stopLossPrice: "90",
            timeInForce: "GTC"
        },
        research: {
            asset: "BTC/USDT",
            strategy: "ema-trend",
            strategyEligible: true,
            timeframe: "1h",
            signalCandle: "2026-01-01T10:59:59Z",
            confidence: "MEDIUM",
            maximumRiskEur: 10,
            estimatedLossAtStopEur: 10,
            positionValueEur: 100,
            sizingAllowed: true,
            marketRegime: { trend: "bullish" }
        },
        risk: { halt: false, extremeVolatility: false, maximumRiskEur: 10, estimatedLossAtStopEur: 10 },
        marketPricesEur: { "BTC-EUR": "90" },
        noTradeReasons: [],
        sourceEvidence: [
            {
                symbol: "BTC/USDT",
                timeframe: "1h",
                provider: "test",
                exchange: "test",
                retrievedAt: "2026-01-01T11:01:00Z",
                sha256: "b".repeat(64),
                latestClosedCandle: "2026-01-01T10:59:59Z"
            }
        ],
        bridgePolicy: {
            paperOnly: true,
            requiresStoredDryRun: true,
            liveExecutionAuthorized: false,
            requiresInstrumentRoundingBeforeLive: true
        },
        ...overrides
    };
    const material = [
        artifact.schemaVersion,
        artifact.decision,
        artifact.orderIntent?.productId ?? "NONE",
        artifact.research?.strategy ?? "NONE",
        artifact.closedCandleAt
    ].join("|");
    artifact.dedupeKey = createHash("sha256").update(material, "utf8").digest("hex");
    artifact.artifactId = `research_${artifact.dedupeKey.slice(0, 24)}`;
    return artifact;
}

export function noTradeDecision(): ResearchDecision {
    return researchDecision({
        decision: "NO_TRADE",
        orderIntent: null,
        research: null,
        risk: { halt: false, extremeVolatility: false, maximumRiskEur: 0, estimatedLossAtStopEur: 0 },
        noTradeReasons: ["No strategy passed the frozen gate"]
    });
}

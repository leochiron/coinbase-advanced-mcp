import { z } from "zod";
import { decimalStringSchema, orderInputSchema } from "../utils/validators.js";

const timestampSchema = z.string().datetime({ offset: true });

export const researchDecisionSchema = z
    .object({
        schemaName: z.literal("crypto-research-decision"),
        schemaVersion: z.literal("1.0.0"),
        artifactId: z.string().regex(/^research_[a-f0-9]{24}$/),
        dedupeKey: z.string().regex(/^[a-f0-9]{64}$/),
        generatedAt: timestampSchema,
        expiresAt: timestampSchema,
        closedCandleAt: timestampSchema,
        mode: z.literal("PAPER_ANALYSIS_ONLY"),
        decision: z.enum(["LONG", "NO_TRADE"]),
        dataStatus: z.literal("PASS"),
        orderIntent: orderInputSchema.nullable(),
        research: z
            .object({
                asset: z.string().min(1),
                strategy: z.string().min(1),
                strategyEligible: z.literal(true),
                timeframe: z.enum(["15m", "1h", "4h"]),
                signalCandle: timestampSchema,
                confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
                maximumRiskEur: z.number().nonnegative(),
                estimatedLossAtStopEur: z.number().nonnegative(),
                positionValueEur: z.number().positive(),
                sizingAllowed: z.literal(true),
                marketRegime: z.record(z.unknown())
            })
            .nullable(),
        risk: z.object({
            halt: z.boolean(),
            extremeVolatility: z.boolean(),
            maximumRiskEur: z.number().nonnegative(),
            estimatedLossAtStopEur: z.number().nonnegative()
        }),
        marketPricesEur: z.record(decimalStringSchema),
        noTradeReasons: z.array(z.string()),
        sourceEvidence: z
            .array(
                z.object({
                    symbol: z.string().min(1),
                    timeframe: z.string().min(1),
                    provider: z.string().min(1),
                    exchange: z.string().min(1),
                    retrievedAt: timestampSchema,
                    sha256: z.string().regex(/^[a-f0-9]{64}$/),
                    latestClosedCandle: timestampSchema
                })
            )
            .min(1),
        bridgePolicy: z.object({
            paperOnly: z.literal(true),
            requiresStoredDryRun: z.literal(true),
            liveExecutionAuthorized: z.literal(false),
            requiresInstrumentRoundingBeforeLive: z.literal(true)
        })
    })
    .strict()
    .superRefine((value, context) => {
        if (value.decision === "LONG" && (!value.orderIntent || !value.research)) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "LONG requires orderIntent and research evidence"
            });
        }
        if (value.decision === "NO_TRADE" && (value.orderIntent !== null || value.research !== null)) {
            context.addIssue({ code: z.ZodIssueCode.custom, message: "NO_TRADE cannot contain an order intent" });
        }
        if (value.orderIntent && (value.orderIntent.side !== "BUY" || value.orderIntent.orderType !== "LIMIT")) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "The v1 bridge accepts paper LIMIT BUY intents only"
            });
        }
        if (value.orderIntent && !value.orderIntent.productId.endsWith("-EUR")) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "The v1 bridge accepts EUR-quoted products only"
            });
        }
        if (value.orderIntent) {
            const hasBase = value.orderIntent.baseSize !== undefined;
            const hasQuote = value.orderIntent.quoteSize !== undefined;
            if (hasBase === hasQuote || value.orderIntent.limitPrice === undefined) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "A paper LIMIT intent requires limitPrice and exactly one size"
                });
            }
            if (!value.orderIntent.takeProfitPrice || !value.orderIntent.stopLossPrice) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "A research paper entry requires both take-profit and stop-loss protection"
                });
            }
        }
        if (value.research && value.research.estimatedLossAtStopEur > value.research.maximumRiskEur + 0.01) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Estimated stop loss exceeds the research risk budget"
            });
        }
    });

export type ResearchDecision = z.infer<typeof researchDecisionSchema>;

export function parseResearchDecision(input: unknown): ResearchDecision {
    return researchDecisionSchema.parse(input);
}

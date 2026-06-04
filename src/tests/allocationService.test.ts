import { describe, expect, it } from "vitest";
import { AllocationService } from "../services/allocationService.js";
import type { PortfolioService } from "../services/portfolioService.js";

describe("AllocationService", () => {
    it("analyzes current allocation without a target", async () => {
        const portfolioService = {
            getSnapshot: async () => ({
                totalEstimatedValue: 1000,
                quoteCurrency: "EUR",
                assets: [
                    {
                        asset: "BTC",
                        quantity: 1,
                        availableBalance: 1,
                        holdBalance: 0,
                        estimatedValue: 700,
                        portfolioWeightPercent: 70,
                        valuationStatus: "VALUED" as const
                    },
                    {
                        asset: "ETH",
                        quantity: 1,
                        availableBalance: 1,
                        holdBalance: 0,
                        estimatedValue: 300,
                        portfolioWeightPercent: 30,
                        valuationStatus: "VALUED" as const
                    }
                ],
                unvaluedAssets: []
            })
        } as Pick<PortfolioService, "getSnapshot"> as PortfolioService;

        const result = await new AllocationService(portfolioService).analyze({
            quoteCurrency: "EUR",
            driftThresholdPercent: 5
        });

        expect(result.currentAllocation).toHaveLength(2);
        expect(result.drift).toHaveLength(0);
        expect(result.concentration.topAsset).toBe("BTC");
    });

    it("calculates target drift", async () => {
        const portfolioService = {
            getSnapshot: async () => ({
                totalEstimatedValue: 1000,
                quoteCurrency: "EUR",
                assets: [
                    {
                        asset: "BTC",
                        quantity: 1,
                        availableBalance: 1,
                        holdBalance: 0,
                        estimatedValue: 700,
                        portfolioWeightPercent: 70,
                        valuationStatus: "VALUED" as const
                    }
                ],
                unvaluedAssets: []
            })
        } as Pick<PortfolioService, "getSnapshot"> as PortfolioService;

        const result = await new AllocationService(portfolioService).analyze({
            quoteCurrency: "EUR",
            targetAllocation: { BTC: 40 },
            driftThresholdPercent: 5
        });

        expect(result.overweight[0]?.asset).toBe("BTC");
        expect(result.overweight[0]?.driftPercent).toBe(30);
    });
});

import { percent } from "../utils/numberFormat.js";
import type { PortfolioService } from "./portfolioService.js";

export type TargetAllocation = Record<string, number>;

export class AllocationService {
    constructor(private readonly portfolioService: PortfolioService) {}

    async analyze(params: { targetAllocation?: TargetAllocation; quoteCurrency: string; driftThresholdPercent: number }) {
        const snapshot = await this.portfolioService.getSnapshot(params.quoteCurrency);
        const currentAllocation = snapshot.assets.map((asset) => ({
            asset: asset.asset,
            currentPercent: asset.portfolioWeightPercent,
            estimatedValue: asset.estimatedValue ?? 0,
            valuationStatus: asset.valuationStatus
        }));

        const drift = params.targetAllocation
            ? currentAllocation.map((asset) => {
                  const targetPercent = params.targetAllocation?.[asset.asset] ?? 0;
                  return {
                      asset: asset.asset,
                      currentPercent: asset.currentPercent,
                      targetPercent,
                      driftPercent: percent(asset.currentPercent - targetPercent)
                  };
              })
            : [];

        const overweight = drift.filter((item) => item.driftPercent > params.driftThresholdPercent);
        const underweight = drift.filter((item) => item.driftPercent < -params.driftThresholdPercent);
        const sorted = [...currentAllocation].sort((a, b) => b.currentPercent - a.currentPercent);
        const top3Weight = percent(sorted.slice(0, 3).reduce((total, item) => total + item.currentPercent, 0));

        return {
            quoteCurrency: params.quoteCurrency,
            totalEstimatedValue: snapshot.totalEstimatedValue,
            currentAllocation,
            drift,
            overweight,
            underweight,
            concentration: {
                topAsset: sorted[0]?.asset,
                topAssetWeightPercent: sorted[0]?.currentPercent ?? 0,
                top3WeightPercent: top3Weight,
                assetCount: currentAllocation.length
            },
            mechanicalRemarks: [
                "This is a mechanical allocation analysis, not personalized financial advice.",
                snapshot.unvaluedAssets.length > 0
                    ? `Some assets could not be valued: ${snapshot.unvaluedAssets.join(", ")}.`
                    : "All non-zero assets were valued in the requested quote currency."
            ]
        };
    }
}

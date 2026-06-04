import type { CoinbaseClient } from "../coinbase/coinbaseClient.js";
import type { CoinbaseMoney, CoinbasePortfolioBreakdownResponse, CoinbaseProduct } from "../coinbase/coinbaseTypes.js";
import { parseDecimal, percent } from "../utils/numberFormat.js";
import type { PricingService } from "./pricingService.js";

type PortfolioClient = Pick<CoinbaseClient, "listAccounts" | "listProducts"> &
    Partial<Pick<CoinbaseClient, "listPortfolios" | "getPortfolioBreakdown">>;

export type PortfolioSnapshotAsset = {
    asset: string;
    quantity: number;
    availableBalance: number;
    holdBalance: number;
    estimatedPrice?: number;
    estimatedValue?: number;
    portfolioWeightPercent: number;
    productIdUsed?: string;
    valuationStatus: "VALUED" | "QUOTE_CURRENCY" | "UNVALUED";
};

export class PortfolioService {
    constructor(
        private readonly client: PortfolioClient,
        private readonly pricingService: PricingService
    ) {}

    async getAccounts(raw = false) {
        const response = await this.client.listAccounts();
        const accounts = response.accounts.map((account) => ({
            asset: account.currency,
            availableBalance: account.available_balance?.value ?? "0",
            holdBalance: account.hold?.value ?? "0",
            currency: account.currency,
            accountId: account.uuid,
            ...(raw ? { raw: account } : {})
        }));

        return { accounts };
    }

    async getSnapshot(quoteCurrency: string) {
        const portfolioBreakdownSnapshot = await this.tryGetPortfolioBreakdownSnapshot(quoteCurrency);
        if (portfolioBreakdownSnapshot) {
            return portfolioBreakdownSnapshot;
        }

        const accountsResponse = await this.client.listAccounts();
        const products = await this.safeListProducts(quoteCurrency);
        const assets: PortfolioSnapshotAsset[] = [];

        for (const account of accountsResponse.accounts) {
            const availableBalance = parseDecimal(account.available_balance?.value);
            const holdBalance = parseDecimal(account.hold?.value);
            const quantity = availableBalance + holdBalance;
            if (quantity <= 0) {
                continue;
            }

            const priceLookup = await this.pricingService.getPrice(account.currency, quoteCurrency, products);
            const estimatedValue = priceLookup.price === undefined ? undefined : quantity * priceLookup.price;

            assets.push({
                asset: account.currency,
                quantity,
                availableBalance,
                holdBalance,
                estimatedPrice: priceLookup.price,
                estimatedValue,
                portfolioWeightPercent: 0,
                productIdUsed: priceLookup.productIdUsed,
                valuationStatus: priceLookup.valuationStatus
            });
        }

        const totalEstimatedValue = assets.reduce((total, asset) => total + (asset.estimatedValue ?? 0), 0);
        for (const asset of assets) {
            asset.portfolioWeightPercent = totalEstimatedValue > 0 ? percent(((asset.estimatedValue ?? 0) / totalEstimatedValue) * 100) : 0;
        }

        return {
            totalEstimatedValue,
            quoteCurrency,
            assets,
            unvaluedAssets: assets.filter((asset) => asset.valuationStatus === "UNVALUED").map((asset) => asset.asset)
        };
    }

    private async tryGetPortfolioBreakdownSnapshot(quoteCurrency: string) {
        if (!this.client.listPortfolios || !this.client.getPortfolioBreakdown) {
            return undefined;
        }

        try {
            const portfolios = await this.client.listPortfolios();
            const portfolio = portfolios.portfolios.find((item) => item.deleted !== true) ?? portfolios.portfolios[0];
            const portfolioUuid = portfolio?.uuid ?? portfolio?.portfolio_uuid;
            if (!portfolioUuid) {
                return undefined;
            }

            const response = await this.client.getPortfolioBreakdown(portfolioUuid, quoteCurrency);
            return this.mapPortfolioBreakdown(response, quoteCurrency);
        } catch {
            return undefined;
        }
    }

    private mapPortfolioBreakdown(response: CoinbasePortfolioBreakdownResponse, quoteCurrency: string) {
        const breakdown = response.breakdown;
        const positions = breakdown?.spot_positions ?? [];
        const byAsset = new Map<string, PortfolioSnapshotAsset & { accountTypes: string[] }>();

        for (const position of positions) {
            const asset = position.asset;
            if (!asset) {
                continue;
            }

            const estimatedValue = moneyOrNumber(position.total_balance_fiat);
            const quantity = Number(position.total_balance_crypto ?? 0);
            if (estimatedValue === 0 && quantity === 0) {
                continue;
            }

            const existing = byAsset.get(asset);
            if (existing) {
                existing.quantity += quantity;
                existing.availableBalance += quantity;
                existing.estimatedValue = (existing.estimatedValue ?? 0) + estimatedValue;
                if (position.account_type && !existing.accountTypes.includes(position.account_type)) {
                    existing.accountTypes.push(position.account_type);
                }
            } else {
                byAsset.set(asset, {
                    asset,
                    quantity,
                    availableBalance: quantity,
                    holdBalance: 0,
                    estimatedValue,
                    portfolioWeightPercent: 0,
                    valuationStatus: "VALUED",
                    accountTypes: position.account_type ? [position.account_type] : []
                });
            }
        }

        const totalEstimatedValue = parseDecimal(breakdown?.portfolio_balances?.total_balance?.value);
        const assets = [...byAsset.values()].map((asset) => {
            asset.estimatedPrice = asset.quantity > 0 ? (asset.estimatedValue ?? 0) / asset.quantity : undefined;
            asset.portfolioWeightPercent =
                totalEstimatedValue > 0 ? percent(((asset.estimatedValue ?? 0) / totalEstimatedValue) * 100) : 0;
            return asset;
        });

        return {
            totalEstimatedValue,
            quoteCurrency: breakdown?.portfolio_balances?.total_balance?.currency ?? quoteCurrency,
            assets,
            unvaluedAssets: [],
            source: "coinbase_portfolio_breakdown"
        };
    }

    private async safeListProducts(quoteCurrency: string): Promise<CoinbaseProduct[] | undefined> {
        try {
            return await this.client.listProducts({ quoteCurrency });
        } catch {
            return undefined;
        }
    }
}

function moneyOrNumber(value: number | CoinbaseMoney | undefined): number {
    if (typeof value === "number") {
        return value;
    }

    return parseDecimal(value?.value);
}

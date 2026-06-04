import { describe, expect, it } from "vitest";
import { PortfolioService } from "../services/portfolioService.js";
import { PricingService } from "../services/pricingService.js";

describe("PortfolioService", () => {
    it("creates a snapshot with valued, quote, and unvalued assets", async () => {
        const client = {
            listAccounts: async () => ({
                accounts: [
                    {
                        uuid: "btc",
                        currency: "BTC",
                        available_balance: { value: "1", currency: "BTC" },
                        hold: { value: "0", currency: "BTC" }
                    },
                    {
                        uuid: "eur",
                        currency: "EUR",
                        available_balance: { value: "100", currency: "EUR" },
                        hold: { value: "0", currency: "EUR" }
                    },
                    {
                        uuid: "doge",
                        currency: "DOGE",
                        available_balance: { value: "10", currency: "DOGE" },
                        hold: { value: "0", currency: "DOGE" }
                    }
                ]
            }),
            listProducts: async () => [
                {
                    product_id: "BTC-EUR",
                    base_currency_id: "BTC",
                    quote_currency_id: "EUR",
                    price: "50000"
                }
            ],
            getProduct: async () => {
                throw new Error("Unexpected product fetch");
            },
            getProductTicker: async () => {
                throw new Error("Unexpected ticker fetch");
            }
        };

        const pricingService = new PricingService(client);
        const service = new PortfolioService(client, pricingService);
        const snapshot = await service.getSnapshot("EUR");

        expect(snapshot.totalEstimatedValue).toBe(50100);
        expect(snapshot.assets.find((asset) => asset.asset === "BTC")?.estimatedValue).toBe(50000);
        expect(snapshot.assets.find((asset) => asset.asset === "EUR")?.valuationStatus).toBe("QUOTE_CURRENCY");
        expect(snapshot.assets.find((asset) => asset.asset === "DOGE")?.valuationStatus).toBe("UNVALUED");
    });
});

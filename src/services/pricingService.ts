import type { CoinbaseClient } from "../coinbase/coinbaseClient.js";
import type { CoinbaseProduct } from "../coinbase/coinbaseTypes.js";
import { parseDecimal } from "../utils/numberFormat.js";

export type PriceLookup = {
    asset: string;
    quoteCurrency: string;
    productIdUsed?: string;
    price?: number;
    valuationStatus: "VALUED" | "QUOTE_CURRENCY" | "UNVALUED";
};

type PricingClient = Pick<CoinbaseClient, "listProducts" | "getProduct" | "getProductTicker">;

export class PricingService {
    constructor(private readonly client: PricingClient) {}

    async listProducts(params: { quoteCurrency?: string; productType?: string }) {
        const products = await this.client.listProducts(params);
        return products.map((product) => ({
            productId: product.product_id,
            baseCurrency: product.base_currency_id,
            quoteCurrency: product.quote_currency_id,
            status: product.status,
            tradingDisabled: product.trading_disabled ?? product.is_disabled,
            priceIncrement: product.price_increment,
            baseIncrement: product.base_increment,
            quoteIncrement: product.quote_increment,
            productType: product.product_type
        }));
    }

    async getProductTicker(productId: string) {
        const ticker = await this.client.getProductTicker(productId);
        const lastTrade = ticker.trades?.[0];
        return {
            productId,
            price: lastTrade?.price,
            bestBid: ticker.best_bid,
            bestAsk: ticker.best_ask,
            trade: lastTrade
        };
    }

    async getPrice(asset: string, quoteCurrency: string, products?: CoinbaseProduct[]): Promise<PriceLookup> {
        const normalizedAsset = asset.toUpperCase();
        const normalizedQuote = quoteCurrency.toUpperCase();

        if (normalizedAsset === normalizedQuote) {
            return {
                asset: normalizedAsset,
                quoteCurrency: normalizedQuote,
                price: 1,
                valuationStatus: "QUOTE_CURRENCY"
            };
        }

        const productId = `${normalizedAsset}-${normalizedQuote}`;
        const matchingProduct = products?.find((product) => product.product_id === productId);
        if (products && !matchingProduct) {
            return {
                asset: normalizedAsset,
                quoteCurrency: normalizedQuote,
                productIdUsed: productId,
                valuationStatus: "UNVALUED"
            };
        }

        try {
            const product = matchingProduct ?? (await this.client.getProduct(productId));
            const productPrice = parseDecimal(product.price);
            if (productPrice > 0) {
                return {
                    asset: normalizedAsset,
                    quoteCurrency: normalizedQuote,
                    productIdUsed: product.product_id,
                    price: productPrice,
                    valuationStatus: "VALUED"
                };
            }

            const ticker = await this.client.getProductTicker(productId);
            const tradePrice = parseDecimal(ticker.trades?.[0]?.price);
            const bid = parseDecimal(ticker.best_bid);
            const ask = parseDecimal(ticker.best_ask);
            const price = tradePrice > 0 ? tradePrice : bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;

            return price > 0
                ? {
                      asset: normalizedAsset,
                      quoteCurrency: normalizedQuote,
                      productIdUsed: productId,
                      price,
                      valuationStatus: "VALUED"
                  }
                : {
                      asset: normalizedAsset,
                      quoteCurrency: normalizedQuote,
                      productIdUsed: productId,
                      valuationStatus: "UNVALUED"
                  };
        } catch {
            return {
                asset: normalizedAsset,
                quoteCurrency: normalizedQuote,
                productIdUsed: productId,
                valuationStatus: "UNVALUED"
            };
        }
    }
}

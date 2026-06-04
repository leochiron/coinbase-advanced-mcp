import type { AppEnv } from "../config/env.js";
import { redactSecrets } from "../utils/redactSecrets.js";
import { createCoinbaseBearerToken } from "./coinbaseAuth.js";
import { CoinbaseApiError } from "./coinbaseErrors.js";
import type {
    CoinbaseAccountsResponse,
    CoinbaseCancelOrdersResponse,
    CoinbaseCreateOrderResponse,
    CoinbaseOrder,
    CoinbaseOrderPayload,
    CoinbaseOrdersResponse,
    CoinbasePortfolioBreakdownResponse,
    CoinbasePortfoliosResponse,
    CoinbaseProduct,
    CoinbaseProductsResponse,
    CoinbaseTickerResponse,
    HttpMethod
} from "./coinbaseTypes.js";

type QueryValue = string | number | boolean | string[] | undefined;

export class CoinbaseClient {
    constructor(private readonly env: AppEnv) {}

    async listAccounts(): Promise<CoinbaseAccountsResponse> {
        const accounts: CoinbaseAccountsResponse["accounts"] = [];
        let cursor: string | undefined;
        let hasNext = true;

        while (hasNext) {
            const response = await this.request<CoinbaseAccountsResponse>("GET", "/api/v3/brokerage/accounts", {
                limit: 250,
                cursor
            });
            accounts.push(...(response.accounts ?? []));
            cursor = response.cursor;
            hasNext = Boolean(response.has_next && cursor);
        }

        return { accounts, has_next: false, size: accounts.length };
    }

    async listProducts(params: { quoteCurrency?: string; productType?: string } = {}): Promise<CoinbaseProduct[]> {
        const response = await this.request<CoinbaseProductsResponse>("GET", "/api/v3/brokerage/products", {
            product_type: params.productType,
            get_tradability_status: true
        });

        const products = response.products ?? [];
        if (!params.quoteCurrency) {
            return products;
        }

        return products.filter((product) => product.quote_currency_id === params.quoteCurrency);
    }

    async getProduct(productId: string): Promise<CoinbaseProduct> {
        return this.request<CoinbaseProduct>("GET", `/api/v3/brokerage/products/${encodeURIComponent(productId)}`, {
            get_tradability_status: true
        });
    }

    async getProductTicker(productId: string): Promise<CoinbaseTickerResponse> {
        return this.request<CoinbaseTickerResponse>(
            "GET",
            `/api/v3/brokerage/products/${encodeURIComponent(productId)}/ticker`,
            { limit: 1 }
        );
    }

    async getOrder(orderId: string): Promise<CoinbaseOrder> {
        const response = await this.request<{ order?: CoinbaseOrder } & CoinbaseOrder>(
            "GET",
            `/api/v3/brokerage/orders/historical/${encodeURIComponent(orderId)}`
        );

        return response.order ?? response;
    }

    async listPortfolios(): Promise<CoinbasePortfoliosResponse> {
        return this.request<CoinbasePortfoliosResponse>("GET", "/api/v3/brokerage/portfolios");
    }

    async getPortfolioBreakdown(portfolioUuid: string, currency: string): Promise<CoinbasePortfolioBreakdownResponse> {
        return this.request<CoinbasePortfolioBreakdownResponse>(
            "GET",
            `/api/v3/brokerage/portfolios/${encodeURIComponent(portfolioUuid)}`,
            { currency }
        );
    }

    async createOrder(payload: CoinbaseOrderPayload): Promise<CoinbaseCreateOrderResponse> {
        return this.request<CoinbaseCreateOrderResponse>("POST", "/api/v3/brokerage/orders", undefined, payload);
    }

    async listOrders(params: {
        productId?: string;
        productIds?: string[];
        orderStatus?: string[];
        startDate?: string;
        endDate?: string;
        limit?: number;
    }): Promise<CoinbaseOrdersResponse> {
        return this.request<CoinbaseOrdersResponse>("GET", "/api/v3/brokerage/orders/historical/batch", {
            product_ids: params.productIds ?? (params.productId ? [params.productId] : undefined),
            order_status: params.orderStatus,
            start_date: params.startDate,
            end_date: params.endDate,
            limit: params.limit
        });
    }

    async cancelOrders(orderIds: string[]): Promise<CoinbaseCancelOrdersResponse> {
        return this.request<CoinbaseCancelOrdersResponse>("POST", "/api/v3/brokerage/orders/batch_cancel", undefined, {
            order_ids: orderIds
        });
    }

    private async request<T>(method: HttpMethod, path: string, query?: Record<string, QueryValue>, body?: unknown): Promise<T> {
        const requestPath = this.buildRequestPath(path, query);
        const token = await createCoinbaseBearerToken(this.env, method, path);
        const response = await fetch(`${this.env.coinbaseApiBaseUrl}${requestPath}`, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        const responseBody = await this.parseResponse(response);
        if (!response.ok) {
            throw new CoinbaseApiError(response.status, responseBody);
        }

        return redactSecrets(responseBody) as T;
    }

    private buildRequestPath(path: string, query?: Record<string, QueryValue>): string {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query ?? {})) {
            if (value === undefined) {
                continue;
            }

            if (Array.isArray(value)) {
                for (const item of value) {
                    params.append(key, item);
                }
            } else {
                params.set(key, String(value));
            }
        }

        const queryString = params.toString();
        return queryString ? `${path}?${queryString}` : path;
    }

    private async parseResponse(response: Response): Promise<unknown> {
        const text = await response.text();
        if (!text) {
            return {};
        }

        try {
            return JSON.parse(text) as unknown;
        } catch {
            return text;
        }
    }
}

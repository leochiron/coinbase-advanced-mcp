import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth module so the client never generates a real JWT and we can
// inspect exactly what gets signed.
vi.mock("../coinbase/coinbaseAuth.js", () => ({
    createCoinbaseBearerToken: vi.fn(async () => "test-token")
}));

import { CoinbaseClient } from "../coinbase/coinbaseClient.js";
import { createCoinbaseBearerToken } from "../coinbase/coinbaseAuth.js";
import { CoinbaseApiError } from "../coinbase/coinbaseErrors.js";
import type { AppEnv } from "../config/env.js";

const mockedAuth = vi.mocked(createCoinbaseBearerToken);

const env = {
    coinbaseApiBaseUrl: "https://api.coinbase.com",
    coinbaseApiKeyName: "organizations/test/apiKeys/test",
    coinbaseApiPrivateKey: "fake-key",
    coinbaseConfigured: true
} as unknown as AppEnv;

type FetchCall = { url: string; init: RequestInit };
let fetchCalls: FetchCall[];

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    const { ok = true, status = 200 } = init;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async (url: string, requestInit: RequestInit) => {
        fetchCalls.push({ url, init: requestInit });
        return { ok, status, text: async () => JSON.stringify(body) } as Response;
    });
}

beforeEach(() => {
    fetchCalls = [];
    mockedAuth.mockClear();
    mockedAuth.mockResolvedValue("test-token");
    vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("CoinbaseClient request building", () => {
    it("POSTs createOrder to the orders endpoint with a JSON body and Bearer token", async () => {
        mockFetchOnce({ success: true, success_response: { order_id: "cb-1" } });
        const client = new CoinbaseClient(env);

        const payload = {
            client_order_id: "codex-1",
            product_id: "BTC-EUR",
            side: "SELL" as const,
            order_configuration: { limit_limit_gtc: { base_size: "0.01", limit_price: "90000", post_only: false } }
        };
        const result = await client.createOrder(payload);

        expect(result.success_response?.order_id).toBe("cb-1");
        const call = fetchCalls[0];
        expect(call.url).toBe("https://api.coinbase.com/api/v3/brokerage/orders");
        expect(call.init.method).toBe("POST");
        expect((call.init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
        expect(JSON.parse(call.init.body as string)).toEqual(payload);
    });

    it("signs only the API path, never the query string", async () => {
        mockFetchOnce({ breakdown: {} });
        const client = new CoinbaseClient(env);

        await client.getPortfolioBreakdown("portfolio-uuid", "EUR");

        // The signed path must exclude the query string...
        expect(mockedAuth).toHaveBeenCalledWith(env, "GET", "/api/v3/brokerage/portfolios/portfolio-uuid");
        const signedPath = mockedAuth.mock.calls[0][2];
        expect(signedPath).not.toContain("?");
        // ...while the actual request URL still carries it.
        expect(fetchCalls[0].url).toBe("https://api.coinbase.com/api/v3/brokerage/portfolios/portfolio-uuid?currency=EUR");
    });

    it("paginates listAccounts across cursors and aggregates the results", async () => {
        mockFetchOnce({ accounts: [{ uuid: "a1", currency: "BTC" }], has_next: true, cursor: "cursor-2" });
        mockFetchOnce({ accounts: [{ uuid: "a2", currency: "ETH" }], has_next: false });
        const client = new CoinbaseClient(env);

        const result = await client.listAccounts();

        expect(result.accounts.map((a) => a.uuid)).toEqual(["a1", "a2"]);
        expect(result.has_next).toBe(false);
        expect(fetchCalls).toHaveLength(2);
        expect(fetchCalls[1].url).toContain("cursor=cursor-2");
    });

    it("filters listProducts by quote currency", async () => {
        mockFetchOnce({
            products: [
                { product_id: "BTC-EUR", quote_currency_id: "EUR" },
                { product_id: "BTC-USD", quote_currency_id: "USD" }
            ]
        });
        const client = new CoinbaseClient(env);

        const products = await client.listProducts({ quoteCurrency: "EUR" });

        expect(products.map((p) => p.product_id)).toEqual(["BTC-EUR"]);
    });

    it("encodes repeated query parameters such as order_status", async () => {
        mockFetchOnce({ orders: [] });
        const client = new CoinbaseClient(env);

        await client.listOrders({ productId: "BTC-EUR", orderStatus: ["OPEN", "PENDING"] });

        const url = fetchCalls[0].url;
        expect(url).toContain("order_status=OPEN");
        expect(url).toContain("order_status=PENDING");
        expect(url).toContain("product_ids=BTC-EUR");
    });

    it("sends the order ids when cancelling", async () => {
        mockFetchOnce({ results: [{ success: true, order_id: "cb-1" }] });
        const client = new CoinbaseClient(env);

        await client.cancelOrders(["cb-1", "cb-2"]);

        const call = fetchCalls[0];
        expect(call.url).toBe("https://api.coinbase.com/api/v3/brokerage/orders/batch_cancel");
        expect(JSON.parse(call.init.body as string)).toEqual({ order_ids: ["cb-1", "cb-2"] });
    });

    it("throws a CoinbaseApiError carrying the HTTP status on a non-ok response", async () => {
        mockFetchOnce({ error: "UNAUTHORIZED" }, { ok: false, status: 401 });
        const client = new CoinbaseClient(env);

        await expect(client.listAccounts()).rejects.toMatchObject({
            name: "CoinbaseApiError",
            status: 401
        });
    });

    it("exposes the failing status through the CoinbaseApiError instance", async () => {
        mockFetchOnce("plain text error", { ok: false, status: 500 });
        const client = new CoinbaseClient(env);

        const error = await client.getProductTicker("BTC-EUR").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(CoinbaseApiError);
        expect((error as CoinbaseApiError).status).toBe(500);
    });
});

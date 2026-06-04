import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCoinbaseBearerToken } from "../coinbase/coinbaseAuth.js";
import { CoinbaseConfigurationError } from "../coinbase/coinbaseErrors.js";

function generateEcKeyPem(): string {
    return generateKeyPairSync("ec", {
        namedCurve: "prime256v1",
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" }
    }).privateKey;
}

const baseEnv = {
    coinbaseApiKeyName: "organizations/test-org/apiKeys/test-key",
    coinbaseApiBaseUrl: "https://api.coinbase.com"
};

describe("createCoinbaseBearerToken", () => {
    it("throws a configuration error when Coinbase is not configured", async () => {
        await expect(
            createCoinbaseBearerToken(
                { ...baseEnv, coinbaseApiPrivateKey: "", coinbaseConfigured: false },
                "GET",
                "/api/v3/brokerage/accounts"
            )
        ).rejects.toBeInstanceOf(CoinbaseConfigurationError);
    });

    it("signs a request and returns a three-part JWT when configured", async () => {
        const token = await createCoinbaseBearerToken(
            { ...baseEnv, coinbaseApiPrivateKey: generateEcKeyPem(), coinbaseConfigured: true },
            "GET",
            "/api/v3/brokerage/accounts"
        );

        expect(typeof token).toBe("string");
        // A JWT is three base64url segments separated by dots.
        expect(token.split(".")).toHaveLength(3);
    });
});

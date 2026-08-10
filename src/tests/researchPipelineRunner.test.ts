import { describe, expect, it } from "vitest";
import { sanitizedResearchEnvironment } from "../research/researchPipelineRunner.js";

describe("research pipeline environment", () => {
    it("does not pass Coinbase or generic secret variables to Python", () => {
        const clean = sanitizedResearchEnvironment({
            PATH: "bin",
            COINBASE_API_PRIVATE_KEY: "secret",
            COINBASE_API_KEY_NAME: "secret-name",
            SOME_PASSWORD: "secret",
            CRYPTO_RESEARCH_PROVIDER: "binance"
        });
        expect(clean.PATH).toBe("bin");
        expect(clean.CRYPTO_RESEARCH_PROVIDER).toBe("binance");
        expect(clean.COINBASE_API_PRIVATE_KEY).toBeUndefined();
        expect(clean.COINBASE_API_KEY_NAME).toBeUndefined();
        expect(clean.SOME_PASSWORD).toBeUndefined();
    });
});

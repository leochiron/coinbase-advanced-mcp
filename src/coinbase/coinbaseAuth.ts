import { generateJwt } from "@coinbase/cdp-sdk/auth";
import type { AppEnv } from "../config/env.js";
import type { HttpMethod } from "./coinbaseTypes.js";
import { CoinbaseConfigurationError } from "./coinbaseErrors.js";

export async function createCoinbaseBearerToken(
    env: Pick<AppEnv, "coinbaseApiKeyName" | "coinbaseApiPrivateKey" | "coinbaseApiBaseUrl" | "coinbaseConfigured">,
    method: HttpMethod,
    requestPath: string
): Promise<string> {
    if (!env.coinbaseConfigured) {
        throw new CoinbaseConfigurationError();
    }

    const host = new URL(env.coinbaseApiBaseUrl).host;

    return generateJwt({
        apiKeyId: env.coinbaseApiKeyName,
        apiKeySecret: env.coinbaseApiPrivateKey,
        requestMethod: method,
        requestHost: host,
        requestPath,
        expiresIn: 120
    });
}

import { redactError, redactSecrets } from "../utils/redactSecrets.js";

export class CoinbaseConfigurationError extends Error {
    constructor() {
        super("Coinbase is not configured. Set COINBASE_API_KEY_NAME and COINBASE_API_PRIVATE_KEY.");
        this.name = "CoinbaseConfigurationError";
    }
}

export class CoinbaseApiError extends Error {
    readonly status: number;
    readonly responseBody: unknown;

    constructor(status: number, responseBody: unknown) {
        super(`Coinbase API request failed with HTTP ${status}: ${redactError(responseBody)}`);
        this.name = "CoinbaseApiError";
        this.status = status;
        this.responseBody = redactSecrets(responseBody);
    }
}

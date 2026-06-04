import type { CoinbaseOrderPayload } from "../coinbase/coinbaseTypes.js";
import { parseDecimal } from "./numberFormat.js";

type OrderConfigFields = {
    base_size?: string;
    quote_size?: string;
    limit_price?: string;
    stop_price?: string;
};

/**
 * Best-effort notional (in quote currency) for a prepared Coinbase order payload.
 *
 * - `quote_size` is the notional directly.
 * - Otherwise `base_size * limit_price` (limit / stop-limit orders).
 * - Returns `undefined` when it cannot be determined (e.g. a market order sized
 *   in base units with no price in the payload).
 */
export function estimateNotional(payload: CoinbaseOrderPayload): number | undefined {
    const config = Object.values(payload.order_configuration)[0] as OrderConfigFields | undefined;
    if (!config) {
        return undefined;
    }

    const quoteSize = parseDecimal(config.quote_size);
    if (quoteSize > 0) {
        return quoteSize;
    }

    const baseSize = parseDecimal(config.base_size);
    const limitPrice = parseDecimal(config.limit_price);
    if (baseSize > 0 && limitPrice > 0) {
        return baseSize * limitPrice;
    }

    return undefined;
}

/** UTC midnight (start of the current day) as an ISO string. */
export function startOfUtcDayIso(now: Date = new Date()): string {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

import type { AppEnv } from "../config/env.js";
import type { CoinbaseOrderPayload } from "../coinbase/coinbaseTypes.js";
import { estimateNotional, startOfUtcDayIso } from "../utils/notional.js";
import type { AuditService } from "./auditService.js";

type RiskEnv = Pick<AppEnv, "riskLimitsEnabled" | "maxDailyNotional">;

/**
 * Optional, opt-in risk guard. Disabled by default so the project keeps its
 * "you own the risk decisions" stance unless an operator explicitly turns it on.
 * v1 enforces a single rule: a maximum executed notional per UTC day.
 */
export class RiskLimitService {
    constructor(
        private readonly auditService: AuditService,
        private readonly env: RiskEnv
    ) {}

    /** Throws when the candidate order would breach a configured limit. No-op when disabled. */
    assertWithinLimits(payload: CoinbaseOrderPayload): void {
        if (!this.env.riskLimitsEnabled || this.env.maxDailyNotional <= 0) {
            return;
        }

        const candidate = estimateNotional(payload);
        if (candidate === undefined) {
            throw new Error(
                "Risk limits are enabled but this order's notional cannot be determined. Provide quote_size, or a base_size with a limit_price."
            );
        }

        const alreadyToday = this.auditService
            .listExecutedPayloadsSince(startOfUtcDayIso())
            .reduce((total, executed) => total + (estimateNotional(executed) ?? 0), 0);

        const projected = alreadyToday + candidate;
        if (projected > this.env.maxDailyNotional) {
            throw new Error(
                `Order rejected by risk limit: projected daily notional ${projected.toFixed(2)} would exceed MAX_DAILY_NOTIONAL ${this.env.maxDailyNotional.toFixed(2)} (already executed today: ${alreadyToday.toFixed(2)}).`
            );
        }
    }
}

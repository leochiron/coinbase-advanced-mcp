import type { CoinbaseOrderPayload } from "../coinbase/coinbaseTypes.js";
import { createClientOrderId } from "../utils/idempotency.js";
import type { LimitOrderIntent, OrderInput, StopLimitOrderIntent } from "../utils/validators.js";
import { requireExactlyOneSize } from "../utils/validators.js";
import type { AuditService } from "./auditService.js";

export class OrderProposalService {
    constructor(private readonly auditService: AuditService) {}

    proposeLimitOrders(ordersIntent: LimitOrderIntent[]) {
        const orders = ordersIntent.map((intent) =>
            this.buildOrderPayload({
                ...intent,
                orderType: "LIMIT"
            })
        );
        const proposal = this.auditService.saveProposal("LIMIT", orders);
        return {
            proposalId: proposal.proposalId,
            orders: proposal.orders,
            coinbasePayloads: proposal.orders,
            technicalWarnings: [],
            estimatedPortfolioImpact: "Not calculated from live fills; payloads are prepared only."
        };
    }

    proposeStopLimitOrders(ordersIntent: StopLimitOrderIntent[]) {
        const orders = ordersIntent.map((intent) =>
            this.buildOrderPayload({
                ...intent,
                orderType: "STOP_LIMIT"
            })
        );
        const proposal = this.auditService.saveProposal("STOP_LIMIT", orders);
        return {
            proposalId: proposal.proposalId,
            orders: proposal.orders,
            coinbasePayloads: proposal.orders,
            technicalWarnings: ["stop_direction is inferred from side: SELL -> STOP_DOWN, BUY -> STOP_UP."]
        };
    }

    createDryRun(input: OrderInput) {
        const payload = this.buildOrderPayload(input);
        const dryRun = this.auditService.saveDryRun(payload);
        return {
            dryRunId: dryRun.dryRunId,
            payload: dryRun.payload,
            clientOrderId: payload.client_order_id,
            summary: `${input.orderType} ${input.side} ${input.productId} prepared without execution.`,
            validationErrors: []
        };
    }

    buildOrderPayload(input: OrderInput): CoinbaseOrderPayload {
        const clientOrderId = createClientOrderId();
        const payload: CoinbaseOrderPayload = {
            client_order_id: clientOrderId,
            product_id: input.productId,
            side: input.side,
            order_configuration: this.buildOrderConfiguration(input)
        };
        const attachedOrderConfiguration = this.buildAttachedOrderConfiguration(input);
        if (attachedOrderConfiguration) {
            payload.attached_order_configuration = attachedOrderConfiguration;
        }
        return payload;
    }

    private buildOrderConfiguration(input: OrderInput): CoinbaseOrderPayload["order_configuration"] {
        switch (input.orderType) {
            case "MARKET":
                requireExactlyOneSize(input);
                return {
                    [input.timeInForce === "FOK" ? "market_market_fok" : "market_market_ioc"]: sizeFields(input)
                };
            case "LIMIT":
                requireExactlyOneSize(input);
                if (!input.limitPrice) {
                    throw new Error("limitPrice is required for LIMIT orders");
                }
                if (input.timeInForce === "GTD") {
                    throw new Error("GTD requires an end_time and is not supported in v1");
                }
                return {
                    [input.timeInForce === "IOC" ? "sor_limit_ioc" : input.timeInForce === "FOK" ? "limit_limit_fok" : "limit_limit_gtc"]: {
                        ...sizeFields(input),
                        limit_price: input.limitPrice,
                        post_only: false
                    }
                };
            case "STOP_LIMIT":
                if (!input.baseSize) {
                    throw new Error("baseSize is required for STOP_LIMIT orders");
                }
                if (!input.limitPrice || !input.stopPrice) {
                    throw new Error("limitPrice and stopPrice are required for STOP_LIMIT orders");
                }
                if (input.timeInForce !== "GTC") {
                    throw new Error("Only GTC stop-limit orders are supported in v1");
                }
                return {
                    stop_limit_stop_limit_gtc: {
                        base_size: input.baseSize,
                        limit_price: input.limitPrice,
                        stop_price: input.stopPrice,
                        stop_direction: input.side === "SELL" ? "STOP_DIRECTION_STOP_DOWN" : "STOP_DIRECTION_STOP_UP"
                    }
                };
            case "BRACKET":
                if (!input.baseSize) {
                    throw new Error("baseSize is required for BRACKET orders");
                }
                if (!input.limitPrice || !input.stopPrice) {
                    throw new Error("limitPrice and stopPrice are required for BRACKET orders");
                }
                return {
                    trigger_bracket_gtc: {
                        base_size: input.baseSize,
                        limit_price: input.limitPrice,
                        stop_trigger_price: input.stopPrice
                    }
                };
        }
    }

    private buildAttachedOrderConfiguration(input: OrderInput): CoinbaseOrderPayload["attached_order_configuration"] | undefined {
        if (!input.takeProfitPrice && !input.stopLossPrice) {
            return undefined;
        }
        if (!input.takeProfitPrice || !input.stopLossPrice) {
            throw new Error("takeProfitPrice and stopLossPrice must be provided together");
        }
        if (input.timeInForce !== "GTC") {
            throw new Error("Attached TP/SL is only supported for GTC orders in v1");
        }
        return {
            trigger_bracket_gtc: {
                limit_price: input.takeProfitPrice,
                stop_trigger_price: input.stopLossPrice
            }
        };
    }
}

function sizeFields(input: { baseSize?: string; quoteSize?: string }): Record<string, string> {
    return input.baseSize ? { base_size: input.baseSize } : { quote_size: input.quoteSize as string };
}

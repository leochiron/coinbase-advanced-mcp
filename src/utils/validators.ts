import { z } from "zod";

export const decimalStringSchema = z
    .string()
    .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Must be a positive decimal string without scientific notation")
    .refine((value) => Number(value) > 0, "Must be greater than zero");

export const productIdSchema = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]+-[A-Z0-9]+$/, "Must be a Coinbase product id such as BTC-EUR");

export const sideSchema = z.enum(["BUY", "SELL"]);
export const orderTypeSchema = z.enum(["MARKET", "LIMIT", "STOP_LIMIT", "BRACKET"]);
export const timeInForceSchema = z.enum(["GTC", "GTD", "IOC", "FOK"]).default("GTC");

export const orderInputSchema = z
    .object({
        productId: productIdSchema,
        side: sideSchema,
        orderType: orderTypeSchema,
        baseSize: decimalStringSchema.optional(),
        quoteSize: decimalStringSchema.optional(),
        limitPrice: decimalStringSchema.optional(),
        stopPrice: decimalStringSchema.optional(),
        takeProfitPrice: decimalStringSchema.optional(),
        stopLossPrice: decimalStringSchema.optional(),
        timeInForce: timeInForceSchema.optional().default("GTC")
    })
    .strict();

export const limitOrderIntentSchema = z
    .object({
        productId: productIdSchema,
        side: sideSchema,
        baseSize: decimalStringSchema.optional(),
        quoteSize: decimalStringSchema.optional(),
        limitPrice: decimalStringSchema,
        takeProfitPrice: decimalStringSchema.optional(),
        stopLossPrice: decimalStringSchema.optional(),
        timeInForce: timeInForceSchema.optional().default("GTC")
    })
    .strict();

export const stopLimitOrderIntentSchema = z
    .object({
        productId: productIdSchema,
        side: sideSchema,
        baseSize: decimalStringSchema,
        stopPrice: decimalStringSchema,
        limitPrice: decimalStringSchema,
        takeProfitPrice: decimalStringSchema.optional(),
        stopLossPrice: decimalStringSchema.optional(),
        timeInForce: timeInForceSchema.optional().default("GTC")
    })
    .strict();

export type OrderInput = z.infer<typeof orderInputSchema>;
export type LimitOrderIntent = z.infer<typeof limitOrderIntentSchema>;
export type StopLimitOrderIntent = z.infer<typeof stopLimitOrderIntentSchema>;

export function requireExactlyOneSize(input: { baseSize?: string; quoteSize?: string }) {
    if ((input.baseSize && input.quoteSize) || (!input.baseSize && !input.quoteSize)) {
        throw new Error("Exactly one of baseSize or quoteSize is required");
    }
}

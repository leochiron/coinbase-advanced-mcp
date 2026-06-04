import { randomUUID } from "node:crypto";

export function createId(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
}

export function createClientOrderId(): string {
    return `codex-${randomUUID()}`;
}

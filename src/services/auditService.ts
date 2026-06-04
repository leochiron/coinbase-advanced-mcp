import type Database from "better-sqlite3";
import type { CoinbaseOrderPayload } from "../coinbase/coinbaseTypes.js";
import { createId } from "../utils/idempotency.js";
import { redactSecrets } from "../utils/redactSecrets.js";

export type StoredOrderProposal = {
    proposalId: string;
    proposalType: "LIMIT" | "STOP_LIMIT";
    orders: CoinbaseOrderPayload[];
    createdAt: string;
};

export type StoredDryRun = {
    dryRunId: string;
    payload: CoinbaseOrderPayload;
    createdAt: string;
};

export class AuditService {
    constructor(private readonly db: Database.Database) {}

    isAvailable(): boolean {
        try {
            this.db.prepare("SELECT 1").get();
            return true;
        } catch {
            return false;
        }
    }

    append(action: string, status: string, payload?: unknown, response?: unknown): string {
        const id = createId("audit");
        this.db
            .prepare(
                "INSERT INTO audit_log (id, action, status, payload_json, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .run(
                id,
                action,
                status,
                JSON.stringify(redactSecrets(payload ?? null)),
                JSON.stringify(redactSecrets(response ?? null)),
                new Date().toISOString()
            );
        return id;
    }

    saveProposal(proposalType: "LIMIT" | "STOP_LIMIT", orders: CoinbaseOrderPayload[]): StoredOrderProposal {
        const proposal: StoredOrderProposal = {
            proposalId: createId("proposal"),
            proposalType,
            orders: redactSecrets(orders),
            createdAt: new Date().toISOString()
        };

        this.db
            .prepare("INSERT INTO order_proposals (proposal_id, proposal_type, payload_json, created_at) VALUES (?, ?, ?, ?)")
            .run(proposal.proposalId, proposalType, JSON.stringify(proposal.orders), proposal.createdAt);
        this.append("order_proposal", "saved", { proposalId: proposal.proposalId, proposalType, orders });
        return proposal;
    }

    getProposal(proposalId: string): StoredOrderProposal | undefined {
        const row = this.db
            .prepare("SELECT proposal_id, proposal_type, payload_json, created_at FROM order_proposals WHERE proposal_id = ?")
            .get(proposalId) as
            | { proposal_id: string; proposal_type: "LIMIT" | "STOP_LIMIT"; payload_json: string; created_at: string }
            | undefined;

        if (!row) {
            return undefined;
        }

        return {
            proposalId: row.proposal_id,
            proposalType: row.proposal_type,
            orders: JSON.parse(row.payload_json) as CoinbaseOrderPayload[],
            createdAt: row.created_at
        };
    }

    saveDryRun(payload: CoinbaseOrderPayload): StoredDryRun {
        const dryRun: StoredDryRun = {
            dryRunId: createId("dryrun"),
            payload: redactSecrets(payload),
            createdAt: new Date().toISOString()
        };

        this.db
            .prepare("INSERT INTO order_dry_runs (dry_run_id, payload_json, created_at) VALUES (?, ?, ?)")
            .run(dryRun.dryRunId, JSON.stringify(dryRun.payload), dryRun.createdAt);
        this.append("order_dry_run", "saved", { dryRunId: dryRun.dryRunId, payload });
        return dryRun;
    }

    getDryRun(dryRunId: string): StoredDryRun | undefined {
        const row = this.db.prepare("SELECT dry_run_id, payload_json, created_at FROM order_dry_runs WHERE dry_run_id = ?").get(dryRunId) as
            | { dry_run_id: string; payload_json: string; created_at: string }
            | undefined;

        if (!row) {
            return undefined;
        }

        return {
            dryRunId: row.dry_run_id,
            payload: JSON.parse(row.payload_json) as CoinbaseOrderPayload,
            createdAt: row.created_at
        };
    }

    saveExecution(sourceId: string, payload: CoinbaseOrderPayload, response: unknown): string {
        const id = createId("execution");
        const coinbaseOrderId = extractOrderId(response);
        this.db
            .prepare(
                "INSERT INTO executions (id, source_id, client_order_id, coinbase_order_id, payload_json, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .run(
                id,
                sourceId,
                payload.client_order_id,
                coinbaseOrderId,
                JSON.stringify(redactSecrets(payload)),
                JSON.stringify(redactSecrets(response)),
                new Date().toISOString()
            );
        this.append("order_execution", "sent", { sourceId, payload }, response);
        return id;
    }

    saveCancellation(orderId: string, response: unknown): string {
        const id = createId("cancellation");
        this.db
            .prepare("INSERT INTO cancellations (id, order_id, response_json, created_at) VALUES (?, ?, ?, ?)")
            .run(id, orderId, JSON.stringify(redactSecrets(response)), new Date().toISOString());
        this.append("order_cancellation", "sent", { orderId }, response);
        return id;
    }

    listExecutedPayloadsSince(isoDate: string): CoinbaseOrderPayload[] {
        return this.db
            .prepare("SELECT payload_json FROM executions WHERE created_at >= ? ORDER BY created_at ASC")
            .all(isoDate)
            .map((row) => JSON.parse((row as { payload_json: string }).payload_json) as CoinbaseOrderPayload);
    }

    listAuditLog(limit = 50): unknown[] {
        return this.db
            .prepare(
                "SELECT id, action, status, payload_json, response_json, created_at FROM audit_log ORDER BY created_at DESC LIMIT ?"
            )
            .all(limit)
            .map((row) => {
                const typed = row as {
                    id: string;
                    action: string;
                    status: string;
                    payload_json: string | null;
                    response_json: string | null;
                    created_at: string;
                };
                return {
                    id: typed.id,
                    action: typed.action,
                    status: typed.status,
                    payload: typed.payload_json ? parseJson(typed.payload_json) : null,
                    response: typed.response_json ? parseJson(typed.response_json) : null,
                    createdAt: typed.created_at
                };
            });
    }

    listLocalOrderHistory(limit = 50): unknown[] {
        type LocalHistoryRow = Record<string, unknown> & { created_at?: string };

        const executions: LocalHistoryRow[] = this.db
            .prepare("SELECT id, source_id, client_order_id, coinbase_order_id, response_json, created_at FROM executions ORDER BY created_at DESC LIMIT ?")
            .all(limit)
            .map((row) => ({ type: "execution", ...(row as Record<string, unknown>) }));
        const cancellations: LocalHistoryRow[] = this.db
            .prepare("SELECT id, order_id, response_json, created_at FROM cancellations ORDER BY created_at DESC LIMIT ?")
            .all(limit)
            .map((row) => ({ type: "cancellation", ...(row as Record<string, unknown>) }));

        return [...executions, ...cancellations].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
    }
}

function extractOrderId(response: unknown): string | undefined {
    if (!response || typeof response !== "object") {
        return undefined;
    }

    const record = response as Record<string, unknown>;
    if (typeof record.order_id === "string") {
        return record.order_id;
    }

    const success = record.success_response as Record<string, unknown> | undefined;
    return typeof success?.order_id === "string" ? success.order_id : undefined;
}

function parseJson(value: string): unknown {
    return JSON.parse(value) as unknown;
}

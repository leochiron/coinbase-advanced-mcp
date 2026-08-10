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

export type StoredResearchImport = {
    artifactId: string;
    dedupeKey: string;
    decision: "LONG" | "NO_TRADE";
    status: string;
    proposalId?: string;
    dryRunId?: string;
    payload: unknown;
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

    getResearchImportByDedupeKey(dedupeKey: string): StoredResearchImport | undefined {
        const row = this.db
            .prepare(
                "SELECT artifact_id, dedupe_key, decision, status, proposal_id, dry_run_id, payload_json, created_at FROM research_decision_imports WHERE dedupe_key = ?"
            )
            .get(dedupeKey) as
            | {
                  artifact_id: string;
                  dedupe_key: string;
                  decision: "LONG" | "NO_TRADE";
                  status: string;
                  proposal_id: string | null;
                  dry_run_id: string | null;
                  payload_json: string;
                  created_at: string;
              }
            | undefined;
        if (!row) {
            return undefined;
        }
        return {
            artifactId: row.artifact_id,
            dedupeKey: row.dedupe_key,
            decision: row.decision,
            status: row.status,
            proposalId: row.proposal_id ?? undefined,
            dryRunId: row.dry_run_id ?? undefined,
            payload: parseJson(row.payload_json),
            createdAt: row.created_at
        };
    }

    saveResearchImport(input: {
        artifactId: string;
        dedupeKey: string;
        decision: "LONG" | "NO_TRADE";
        status: string;
        proposalId?: string;
        dryRunId?: string;
        payload: unknown;
    }): StoredResearchImport {
        const createdAt = new Date().toISOString();
        this.db
            .prepare(
                "INSERT INTO research_decision_imports (artifact_id, dedupe_key, decision, status, proposal_id, dry_run_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .run(
                input.artifactId,
                input.dedupeKey,
                input.decision,
                input.status,
                input.proposalId ?? null,
                input.dryRunId ?? null,
                JSON.stringify(redactSecrets(input.payload)),
                createdAt
            );
        this.append("research_decision_import", input.status, {
            artifactId: input.artifactId,
            dedupeKey: input.dedupeKey,
            decision: input.decision,
            proposalId: input.proposalId,
            dryRunId: input.dryRunId
        });
        return { ...input, createdAt };
    }

    setAutomationState(key: string, value: string): void {
        this.db
            .prepare(
                "INSERT INTO automation_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
            )
            .run(key, value, new Date().toISOString());
    }

    getAutomationState(key: string): string | undefined {
        const row = this.db.prepare("SELECT value FROM automation_state WHERE key = ?").get(key) as { value: string } | undefined;
        return row?.value;
    }

    countPaperOrdersSince(isoDate: string): number {
        const row = this.db.prepare("SELECT COUNT(*) AS count FROM paper_orders WHERE created_at >= ?").get(isoDate) as { count: number };
        return row.count;
    }

    countOpenPaperOrders(): number {
        const row = this.db
            .prepare("SELECT COUNT(*) AS count FROM paper_orders WHERE status IN ('OPEN', 'PARTIALLY_FILLED')")
            .get() as { count: number };
        return row.count;
    }

    realizedPaperPnlSince(isoDate: string): number {
        const row = this.db
            .prepare("SELECT COALESCE(SUM(CAST(realized_pnl AS REAL)), 0) AS pnl FROM paper_realized_events WHERE created_at >= ?")
            .get(isoDate) as { pnl: number };
        return Number(row.pnl);
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

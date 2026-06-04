import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
            id TEXT PRIMARY KEY,
            action TEXT NOT NULL,
            status TEXT NOT NULL,
            payload_json TEXT,
            response_json TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS order_proposals (
            proposal_id TEXT PRIMARY KEY,
            proposal_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS order_dry_runs (
            dry_run_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS executions (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            client_order_id TEXT NOT NULL,
            coinbase_order_id TEXT,
            payload_json TEXT NOT NULL,
            response_json TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cancellations (
            id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL,
            response_json TEXT,
            created_at TEXT NOT NULL
        );
    `);
}

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

        CREATE TABLE IF NOT EXISTS paper_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS paper_balances (
            asset TEXT PRIMARY KEY,
            balance TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS paper_orders (
            paper_order_id TEXT PRIMARY KEY,
            client_order_id TEXT,
            product_id TEXT NOT NULL,
            side TEXT NOT NULL,
            order_type TEXT NOT NULL,
            base_size TEXT,
            quote_size TEXT,
            limit_price TEXT,
            stop_price TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            filled_at TEXT,
            fill_price TEXT,
            fill_size TEXT,
            fee TEXT,
            reason TEXT,
            source_id TEXT
        );

        CREATE TABLE IF NOT EXISTS paper_positions (
            position_id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            quantity TEXT NOT NULL,
            average_entry_price TEXT NOT NULL,
            realized_pnl TEXT NOT NULL DEFAULT '0',
            entry_fees TEXT NOT NULL DEFAULT '0',
            exit_fees TEXT NOT NULL DEFAULT '0',
            status TEXT NOT NULL,
            opened_at TEXT NOT NULL,
            closed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS paper_realized_events (
            event_id TEXT PRIMARY KEY,
            position_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            realized_pnl TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS research_decision_imports (
            artifact_id TEXT PRIMARY KEY,
            dedupe_key TEXT NOT NULL UNIQUE,
            decision TEXT NOT NULL,
            status TEXT NOT NULL,
            dry_run_id TEXT,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS research_automation_runs (
            run_id TEXT PRIMARY KEY,
            schedule_bucket TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL,
            decision_artifact_id TEXT,
            details_json TEXT,
            started_at TEXT NOT NULL,
            finished_at TEXT
        );

        CREATE TABLE IF NOT EXISTS automation_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    `);

    ensureColumn(db, "paper_orders", "take_profit_price", "TEXT");
    ensureColumn(db, "paper_orders", "stop_loss_price", "TEXT");
    ensureColumn(db, "paper_orders", "parent_paper_order_id", "TEXT");
    ensureColumn(db, "paper_orders", "remaining_size", "TEXT");
    ensureColumn(db, "research_decision_imports", "proposal_id", "TEXT");
}

function ensureColumn(db: Database.Database, table: string, column: string, type: string): void {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
}

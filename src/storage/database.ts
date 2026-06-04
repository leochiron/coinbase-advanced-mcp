import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export function createAuditDatabase(databasePath: string): Database.Database {
    if (databasePath !== ":memory:") {
        mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    }

    const db = new Database(databasePath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    return db;
}

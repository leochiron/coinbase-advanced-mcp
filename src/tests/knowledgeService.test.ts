import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditService } from "../services/auditService.js";
import { KnowledgeService } from "../services/knowledgeService.js";
import { createTestAuditService } from "./testHelpers.js";

let sourcesPath: string;
let audit: AuditService;

function service(): KnowledgeService {
    return new KnowledgeService({ knowledgeSourcesPath: sourcesPath }, audit);
}

function writeDoc(content: unknown): void {
    writeFileSync(sourcesPath, typeof content === "string" ? content : JSON.stringify(content), "utf8");
}

beforeEach(() => {
    sourcesPath = join(tmpdir(), `kb-${randomUUID()}.json`);
    audit = createTestAuditService();
});

afterEach(() => {
    if (existsSync(sourcesPath)) {
        rmSync(sourcesPath);
    }
});

describe("KnowledgeService.getKnowledgeBase", () => {
    it("returns available:false with guidance when the file is missing", () => {
        const result = service().getKnowledgeBase();
        expect(result.available).toBe(false);
        expect(result.message).toMatch(/sources\.example\.json/);
        expect(result.sources).toEqual([]);
    });

    it("returns only enabled sources with counts", () => {
        writeDoc({
            version: 1,
            sources: [
                { id: "a", title: "Macro feed", type: "url", url: "https://example.com/a", category: "macro", addedAt: "2026-01-01T00:00:00.000Z", enabled: true },
                { id: "b", title: "Parked", type: "principle", category: "risk", addedAt: "2026-01-01T00:00:00.000Z", enabled: false }
            ]
        });

        const result = service().getKnowledgeBase();
        expect(result.available).toBe(true);
        expect(result.totalCount).toBe(2);
        expect(result.enabledCount).toBe(1);
        expect(result.sources.map((s) => s.id)).toEqual(["a"]);
        expect(result.byCategory).toEqual({ macro: 1 });
    });

    it("returns available:false with a clear error on malformed JSON", () => {
        writeDoc("{ not valid json ");
        const result = service().getKnowledgeBase();
        expect(result.available).toBe(false);
        expect(result.message).toMatch(/not valid JSON/i);
    });
});

describe("KnowledgeService.addSource", () => {
    it("refuses to add without the exact confirmation phrase", () => {
        expect(() =>
            service().addSource({ title: "X", type: "principle", category: "risk" }, "please")
        ).toThrow(/CONFIRM_ADD_SOURCE/);
        expect(existsSync(sourcesPath)).toBe(false);
    });

    it("requires a url for url-type sources", () => {
        expect(() =>
            service().addSource({ title: "No url", type: "url", category: "macro" }, "CONFIRM_ADD_SOURCE")
        ).toThrow(/url is required/);
    });

    it("appends, persists to disk, and audits when confirmed", () => {
        const svc = service();
        const result = svc.addSource(
            { title: "Trusted Macro Calendar", type: "url", url: "https://example.com/cal", category: "macro", trust: "high" },
            "CONFIRM_ADD_SOURCE"
        );

        expect(result.added.id).toBe("trusted-macro-calendar");
        expect(result.added.addedBy).toBe("assistant");
        expect(result.totalCount).toBe(1);

        // Persisted on disk and visible on re-read.
        const onDisk = JSON.parse(readFileSync(sourcesPath, "utf8")) as { sources: Array<{ id: string }> };
        expect(onDisk.sources.map((s) => s.id)).toContain("trusted-macro-calendar");
        expect(svc.getKnowledgeBase().enabledCount).toBe(1);

        // Audited.
        const log = audit.listAuditLog();
        expect((log as Array<{ action: string }>).some((e) => e.action === "knowledge_source_added")).toBe(true);
    });

    it("refuses to overwrite an invalid existing file", () => {
        writeDoc("{ broken ");
        expect(() =>
            service().addSource({ title: "X", type: "principle", category: "risk" }, "CONFIRM_ADD_SOURCE")
        ).toThrow();
    });
});

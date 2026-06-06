import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { AppEnv } from "../config/env.js";
import { createId } from "../utils/idempotency.js";
import type { AuditService } from "./auditService.js";

const sourceTypeSchema = z.enum(["url", "dataset", "principle", "document"]);
const trustSchema = z.enum(["high", "medium", "low"]);

const sourceSchema = z
    .object({
        id: z.string().min(1),
        title: z.string().min(1),
        type: sourceTypeSchema,
        url: z.string().url().optional(),
        category: z.string().min(1),
        trust: trustSchema.default("medium"),
        notes: z.string().optional(),
        enabled: z.boolean().default(true),
        addedBy: z.enum(["user", "assistant"]).default("user"),
        addedAt: z.string()
    })
    .strip();

const knowledgeDocSchema = z.object({
    _readme: z.string().optional(),
    version: z.number().int().default(1),
    sources: z.array(sourceSchema).default([])
});

/** Shape the assistant proposes; id / provenance / timestamp are filled in by the service. */
export const sourceInputSchema = z
    .object({
        title: z.string().min(1),
        type: sourceTypeSchema,
        url: z.string().url().optional(),
        category: z.string().min(1),
        trust: trustSchema.optional(),
        notes: z.string().optional(),
        enabled: z.boolean().optional()
    })
    .strict()
    .refine((value) => value.type === "principle" || value.type === "document" || Boolean(value.url), {
        message: "url is required for sources of type 'url' or 'dataset'",
        path: ["url"]
    });

export type SourceInput = z.infer<typeof sourceInputSchema>;
type KnowledgeDoc = z.infer<typeof knowledgeDocSchema>;
type KnowledgeSource = z.infer<typeof sourceSchema>;

type KnowledgeEnv = Pick<AppEnv, "knowledgeSourcesPath">;

export class KnowledgeService {
    constructor(
        private readonly env: KnowledgeEnv,
        private readonly auditService: AuditService
    ) {}

    /** Read-only view consumed by the assistant before analysis / order proposals. */
    getKnowledgeBase() {
        const loaded = this.loadDoc();
        if (!loaded.ok) {
            return {
                available: false,
                path: this.env.knowledgeSourcesPath,
                sources: [],
                totalCount: 0,
                enabledCount: 0,
                message: loaded.message
            };
        }

        const all = loaded.doc.sources;
        const enabled = all.filter((source) => source.enabled);
        const byCategory: Record<string, number> = {};
        for (const source of enabled) {
            byCategory[source.category] = (byCategory[source.category] ?? 0) + 1;
        }

        return {
            available: true,
            path: this.env.knowledgeSourcesPath,
            version: loaded.doc.version,
            sources: enabled,
            totalCount: all.length,
            enabledCount: enabled.length,
            byCategory,
            note: "These are the operator's validated sources. Ground analysis and order proposals in them. Never add a source without explicit user confirmation (CONFIRM_ADD_SOURCE)."
        };
    }

    /** Append a source. Requires explicit user confirmation; never automatic. */
    addSource(input: SourceInput, confirmationText: string) {
        if (confirmationText !== "CONFIRM_ADD_SOURCE") {
            throw new Error('confirmationText must exactly equal "CONFIRM_ADD_SOURCE" to add a source.');
        }

        const source = sourceInputSchema.parse(input);
        const doc = this.loadWritableDoc();

        const entry: KnowledgeSource = {
            id: this.uniqueId(source.title, doc),
            title: source.title,
            type: source.type,
            url: source.url,
            category: source.category,
            trust: source.trust ?? "medium",
            notes: source.notes,
            enabled: source.enabled ?? true,
            addedBy: "assistant",
            addedAt: new Date().toISOString()
        };

        doc.sources.push(entry);
        this.writeDoc(doc);
        this.auditService.append("knowledge_source_added", "saved", {
            id: entry.id,
            title: entry.title,
            type: entry.type,
            category: entry.category,
            url: entry.url,
            enabled: entry.enabled
        });

        return { added: entry, totalCount: doc.sources.length };
    }

    private loadDoc(): { ok: true; doc: KnowledgeDoc } | { ok: false; message: string } {
        let raw: string;
        try {
            raw = readFileSync(this.env.knowledgeSourcesPath, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return {
                    ok: false,
                    message: `No knowledge sources file at ${this.env.knowledgeSourcesPath}. Copy knowledge/sources.example.json to knowledge/sources.json and curate your own reliable sources before trading.`
                };
            }
            return { ok: false, message: `Could not read knowledge sources file: ${(error as Error).message}` };
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return { ok: false, message: "Knowledge sources file is not valid JSON. Fix it before the assistant can use it." };
        }

        const result = knowledgeDocSchema.safeParse(parsed);
        if (!result.success) {
            return { ok: false, message: `Knowledge sources file failed schema validation: ${result.error.issues[0]?.message ?? "unknown error"}` };
        }

        return { ok: true, doc: result.data };
    }

    private loadWritableDoc(): KnowledgeDoc {
        let raw: string | undefined;
        try {
            raw = readFileSync(this.env.knowledgeSourcesPath, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return { version: 1, sources: [] };
            }
            throw error;
        }

        // Refuse to overwrite a file we cannot safely parse.
        const parsed = knowledgeDocSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
            throw new Error("Refusing to modify the knowledge sources file because it is invalid. Fix it manually first.");
        }
        return parsed.data;
    }

    private writeDoc(doc: KnowledgeDoc): void {
        mkdirSync(dirname(this.env.knowledgeSourcesPath), { recursive: true });
        writeFileSync(this.env.knowledgeSourcesPath, `${JSON.stringify(doc, null, 4)}\n`, "utf8");
    }

    private uniqueId(title: string, doc: KnowledgeDoc): string {
        const base =
            title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 48) || createId("src");
        if (!doc.sources.some((source) => source.id === base)) {
            return base;
        }
        return `${base}-${Date.now().toString(36)}`;
    }
}

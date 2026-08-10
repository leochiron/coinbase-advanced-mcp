import { describe, expect, it } from "vitest";
import { scheduleBucket } from "../research/researchScheduler.js";

describe("research scheduler", () => {
    it("deduplicates work into closed 15-minute schedule buckets", () => {
        expect(scheduleBucket(new Date("2026-01-01T12:14:59Z"))).toBe("2026-01-01T12:00:00.000Z");
        expect(scheduleBucket(new Date("2026-01-01T12:15:00Z"))).toBe("2026-01-01T12:15:00.000Z");
    });
});

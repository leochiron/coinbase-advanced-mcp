import { describe, expect, it } from "vitest";
import { createTestAuditService } from "./testHelpers.js";

describe("AuditService", () => {
    it("redacts secrets in audit entries and supports limits", () => {
        const audit = createTestAuditService();
        audit.append("test", "ok", {
            authorization: "Bearer abc.def.ghi",
            nested: {
                privateKey: "-----BEGIN EC PRIVATE KEY-----\nsecret\n-----END EC PRIVATE KEY-----"
            }
        });
        audit.append("test2", "ok", { value: 1 });

        const entries = audit.listAuditLog(1);

        expect(entries).toHaveLength(1);
        expect(JSON.stringify(entries)).not.toContain("abc.def.ghi");
        expect(JSON.stringify(audit.listAuditLog(10))).not.toContain("secret");
    });
});

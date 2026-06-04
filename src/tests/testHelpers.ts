import { AuditService } from "../services/auditService.js";
import { createAuditDatabase } from "../storage/database.js";

export function createTestAuditService(): AuditService {
    return new AuditService(createAuditDatabase(":memory:"));
}

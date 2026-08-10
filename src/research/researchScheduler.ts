import {
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { AppEnv } from "../config/env.js";
import type { AuditService } from "../services/auditService.js";
import type { ResearchAutomationService } from "./researchAutomationService.js";
import type { ResearchPipelineRunner } from "./researchPipelineRunner.js";

type SchedulerEnv = Pick<
    AppEnv,
    | "projectRoot"
    | "researchDecisionPath"
    | "researchSchedulerIntervalSeconds"
    | "researchRunPipeline"
    | "researchAutomationMode"
>;

export class ResearchScheduler {
    private readonly runtimeRoot: string;
    private readonly lockPath: string;
    private readonly heartbeatPath: string;
    private lockDescriptor?: number;
    private stopping = false;

    constructor(
        private readonly env: SchedulerEnv,
        private readonly auditService: AuditService,
        private readonly automation: ResearchAutomationService,
        private readonly pipeline: ResearchPipelineRunner
    ) {
        this.runtimeRoot = resolve(env.projectRoot, "data", "research-automation");
        this.lockPath = resolve(this.runtimeRoot, "scheduler.lock");
        this.heartbeatPath = resolve(this.runtimeRoot, "heartbeat.json");
    }

    async runOnce(now = new Date()) {
        const ownsLock = this.lockDescriptor === undefined;
        if (ownsLock) {
            this.acquireLock();
        }
        try {
            return await this.runCycle(now);
        } finally {
            if (ownsLock) {
                this.releaseLock();
            }
        }
    }

    private async runCycle(now: Date) {
        this.assertEnabled();
        this.writeHeartbeat("RUNNING", now);
        if (this.env.researchRunPipeline) {
            try {
                await this.pipeline.run();
            } catch (error) {
                this.recordExternalFailure("research_pipeline_failure", error);
                throw error;
            }
        }
        let artifact: unknown;
        try {
            artifact = JSON.parse(readFileSync(this.env.researchDecisionPath, "utf8")) as unknown;
        } catch (error) {
            this.recordExternalFailure("research_artifact_read_failure", error);
            throw error;
        }
        const result = await this.automation.runDecision(artifact, now);
        const bucket = scheduleBucket(now);
        this.auditService.setAutomationState("lastScheduleBucket", bucket);
        this.auditService.setAutomationState("lastSuccessfulCycle", now.toISOString());
        this.writeHeartbeat("IDLE", new Date(), { bucket, resultStatus: result.status });
        return result;
    }

    async runDaemon(): Promise<void> {
        this.assertEnabled();
        this.acquireLock();
        try {
            while (!this.stopping) {
                const now = new Date();
                const bucket = scheduleBucket(now);
                const previous = this.auditService.getAutomationState("lastScheduleBucket");
                if (previous !== bucket) {
                    try {
                        await this.runOnce(now);
                    } catch (error) {
                        if (this.auditService.getAutomationState("automationHalt") === "true") {
                            this.auditService.setAutomationState("lastScheduleBucket", bucket);
                        }
                        this.writeHeartbeat("ERROR", new Date(), {
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                } else {
                    this.writeHeartbeat("IDLE", now, { bucket });
                }
                await delay(this.env.researchSchedulerIntervalSeconds * 1000);
            }
        } finally {
            this.releaseLock();
        }
    }

    stop(): void {
        this.stopping = true;
    }

    private assertEnabled(): void {
        if (this.env.researchAutomationMode === "OFF") {
            throw new Error("RESEARCH_AUTOMATION_MODE is OFF");
        }
    }

    private recordExternalFailure(action: string, error: unknown): void {
        const failures = Number(this.auditService.getAutomationState("consecutiveFailures") ?? "0") + 1;
        this.auditService.setAutomationState("consecutiveFailures", String(failures));
        if (failures >= 3) {
            this.auditService.setAutomationState("automationHalt", "true");
        }
        this.auditService.append(action, failures >= 3 ? "HALTED" : "FAILED", {
            failures,
            error: error instanceof Error ? error.message : String(error)
        });
    }

    private acquireLock(): void {
        mkdirSync(this.runtimeRoot, { recursive: true });
        if (existsSync(this.lockPath)) {
            const stale = readLock(this.lockPath);
            if (stale && isProcessAlive(stale.pid)) {
                throw new Error(`Research scheduler is already running with PID ${stale.pid}`);
            }
            unlinkSync(this.lockPath);
        }
        this.lockDescriptor = openSync(this.lockPath, "wx");
        writeFileSync(this.lockDescriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    }

    private releaseLock(): void {
        if (this.lockDescriptor !== undefined) {
            closeSync(this.lockDescriptor);
            this.lockDescriptor = undefined;
        }
        if (existsSync(this.lockPath)) {
            unlinkSync(this.lockPath);
        }
    }

    private writeHeartbeat(status: string, now: Date, details: Record<string, unknown> = {}): void {
        mkdirSync(dirname(this.heartbeatPath), { recursive: true });
        const temporary = `${this.heartbeatPath}.tmp`;
        writeFileSync(
            temporary,
            `${JSON.stringify({ schemaVersion: "1.0", pid: process.pid, status, timestamp: now.toISOString(), ...details }, null, 2)}\n`,
            "utf8"
        );
        renameSync(temporary, this.heartbeatPath);
    }
}

export function scheduleBucket(now: Date): string {
    const intervalMs = 15 * 60_000;
    return new Date(Math.floor(now.getTime() / intervalMs) * intervalMs).toISOString();
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function readLock(path: string): { pid: number } | undefined {
    try {
        const value = JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown };
        return typeof value.pid === "number" ? { pid: value.pid } : undefined;
    } catch {
        return undefined;
    }
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

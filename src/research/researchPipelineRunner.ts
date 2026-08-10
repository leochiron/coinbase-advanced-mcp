import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AppEnv } from "../config/env.js";

type PipelineEnv = Pick<AppEnv, "projectRoot" | "researchPythonCommand" | "researchPipelineTimeoutSeconds">;

export class ResearchPipelineRunner {
    constructor(private readonly env: PipelineEnv) {}

    async run(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
        const args = ["-m", "crypto_research.cli", "--project-root", this.env.projectRoot, "run-all"];
        const bundledPython = resolve(
            this.env.projectRoot,
            ".venv",
            process.platform === "win32" ? "Scripts/python.exe" : "bin/python"
        );
        const pythonCommand =
            this.env.researchPythonCommand === "python" && existsSync(bundledPython)
                ? bundledPython
                : this.env.researchPythonCommand;
        const child = spawn(pythonCommand, args, {
            cwd: this.env.projectRoot,
            env: sanitizedResearchEnvironment(process.env),
            shell: false,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
            stdout = bounded(stdout + chunk.toString("utf8"));
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr = bounded(stderr + chunk.toString("utf8"));
        });
        const timeout = setTimeout(() => child.kill(), this.env.researchPipelineTimeoutSeconds * 1000);
        const exitCode = await new Promise<number>((resolve, reject) => {
            child.once("error", reject);
            child.once("close", (code) => resolve(code ?? 1));
        }).finally(() => clearTimeout(timeout));
        const result = { exitCode, stdout, stderr };
        if (exitCode !== 0) {
            throw new Error(`Python research pipeline failed with exit code ${exitCode}: ${stderr.slice(-2000)}`);
        }
        return result;
    }
}

export function sanitizedResearchEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const allowedNames = new Set([
        "PATH",
        "Path",
        "PATHEXT",
        "SYSTEMROOT",
        "SystemRoot",
        "WINDIR",
        "COMSPEC",
        "ComSpec",
        "TEMP",
        "TMP",
        "TMPDIR",
        "VIRTUAL_ENV",
        "PYTHONPATH",
        "PYTHONHOME",
        "LANG",
        "LC_ALL"
    ]);
    const result: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(source)) {
        if (allowedNames.has(key) || key.startsWith("CRYPTO_RESEARCH_")) {
            result[key] = value;
        }
    }
    return result;
}

function bounded(value: string): string {
    return value.length > 100_000 ? value.slice(-100_000) : value;
}

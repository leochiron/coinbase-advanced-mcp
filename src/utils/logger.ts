import type { AppEnv } from "../config/env.js";
import { redactSecrets } from "./redactSecrets.js";

const levelRank = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
} as const;

export type Logger = ReturnType<typeof createLogger>;

export function createLogger(env: Pick<AppEnv, "logLevel">) {
    function write(level: keyof typeof levelRank, message: string, data?: unknown) {
        if (levelRank[level] < levelRank[env.logLevel]) {
            return;
        }

        const entry = redactSecrets({
            level,
            time: new Date().toISOString(),
            message,
            data
        });

        // MCP stdio reserves stdout for protocol messages.
        console.error(JSON.stringify(entry));
    }

    return {
        debug: (message: string, data?: unknown) => write("debug", message, data),
        info: (message: string, data?: unknown) => write("info", message, data),
        warn: (message: string, data?: unknown) => write("warn", message, data),
        error: (message: string, data?: unknown) => write("error", message, data)
    };
}

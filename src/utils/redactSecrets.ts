const secretPatterns = [
    /-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g,
    /Bearer\s+[A-Za-z0-9._-]+/g,
    /"COINBASE_API_PRIVATE_KEY"\s*:\s*"[^"]*"/g,
    /"COINBASE_API_KEY_NAME"\s*:\s*"[^"]*"/g
];

export function redactSecrets<T>(value: T): T {
    if (typeof value === "string") {
        let redacted: string = value;
        for (const pattern of secretPatterns) {
            redacted = redacted.replace(pattern, "[REDACTED]");
        }
        return redacted as unknown as T;
    }

    if (Array.isArray(value)) {
        return (value as unknown[]).map((item) => redactSecrets(item)) as T;
    }

    if (value && typeof value === "object") {
        const output: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            if (/secret|private|token|authorization|api[_-]?key/i.test(key)) {
                output[key] = "[REDACTED]";
            } else {
                output[key] = redactSecrets(item);
            }
        }
        return output as T;
    }

    return value;
}

export function redactError(error: unknown): string {
    if (error instanceof Error) {
        return redactSecrets(error.message);
    }

    return redactSecrets(String(error));
}

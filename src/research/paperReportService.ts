import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class PaperReportService {
    constructor(private readonly reportsRoot: string) {}

    write(
        performance: Record<string, unknown>,
        automation: Record<string, unknown>,
        now = new Date()
    ): {
        currentJson: string;
        dailyMarkdown: string;
        weeklyMarkdown: string;
    } {
        const root = resolve(this.reportsRoot, "paper");
        mkdirSync(root, { recursive: true });
        const day = now.toISOString().slice(0, 10);
        const week = isoWeek(now);
        const payload = { generatedAt: now.toISOString(), automation, performance };
        const currentJson = resolve(root, "current.json");
        atomicWrite(currentJson, `${JSON.stringify(payload, null, 2)}\n`);
        const markdown = renderMarkdown(payload);
        const dailyMarkdown = resolve(root, `daily-${day}.md`);
        const weeklyMarkdown = resolve(root, `weekly-${week}.md`);
        atomicWrite(dailyMarkdown, markdown);
        atomicWrite(weeklyMarkdown, markdown);
        return { currentJson, dailyMarkdown, weeklyMarkdown };
    }
}

function renderMarkdown(payload: Record<string, unknown>): string {
    const automation = payload.automation as Record<string, unknown>;
    const performance = payload.performance as Record<string, unknown>;
    const positions = (performance.positions as unknown[] | undefined) ?? [];
    const portfolio = (performance.portfolio as Record<string, unknown> | undefined) ?? {};
    const openOrders = (portfolio.openOrders as unknown[] | undefined) ?? [];
    return [
        "# Paper Trading Report",
        "",
        `Generated: ${String(payload.generatedAt)}`,
        "",
        `Automation result: ${scalar(automation.status)}`,
        `Decision: ${scalar(automation.decision)}`,
        `Current equity: EUR ${number(performance.currentEquity)}`,
        `Realized P&L: EUR ${number(performance.realizedPnl)}`,
        `Drawdown: ${number(Number(performance.drawdown ?? 0) * 100)}%`,
        `Open positions: ${positions.filter((item) => (item as Record<string, unknown>).status === "OPEN").length}`,
        `Open orders: ${openOrders.length}`,
        "",
        "This is a deterministic paper simulation. It is not a performance guarantee or a live execution record.",
        ""
    ].join("\n");
}

function atomicWrite(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, content, { encoding: "utf8" });
    renameSync(temporary, path);
}

function number(value: unknown): string {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric.toFixed(2) : "n/a";
}

function scalar(value: unknown): string {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : "UNKNOWN";
}

function isoWeek(date: Date): string {
    const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = value.getUTCDay() || 7;
    value.setUTCDate(value.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((value.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

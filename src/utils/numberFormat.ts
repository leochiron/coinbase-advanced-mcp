export function parseDecimal(value: string | undefined): number {
    if (!value) {
        return 0;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function toDecimalString(value: number): string {
    if (!Number.isFinite(value)) {
        return "0";
    }

    return value.toFixed(12).replace(/\.?0+$/, "");
}

export function percent(value: number): number {
    return Number(value.toFixed(6));
}

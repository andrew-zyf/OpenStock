import { optionalNumber } from './contracts';

// Provider boundaries shared by the financial and company-profile readers.
export function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined;
}

export function records(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.flatMap((item) => record(item) ? [record(item)!] : []) : [];
}

export function text(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() && value.trim() !== '--' && value.trim() !== '—'
        ? value.trim() : undefined;
}

export function isoDate(value: unknown): string | undefined {
    const date = text(value)?.slice(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
    const timestamp = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? date : undefined;
}

export function numeric(value: unknown): number | undefined {
    return optionalNumber(typeof value === 'string' ? value.replace(/,/g, '') : value);
}

export async function fetchProviderJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            next: { revalidate: 86400 },
            signal: controller.signal,
        });
        return response.ok ? await response.json() : undefined;
    } catch {
        return undefined;
    } finally {
        clearTimeout(timer);
    }
}

export function percentage(value: unknown): string | undefined {
    const n = numeric(value);
    return n === undefined ? undefined : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function currencyUnit(currency: string | undefined): string {
    return ({ CNY: '人民币', RMB: '人民币', HKD: '港元', USD: '美元', TWD: '台币', NTD: '台币' } as Record<string, string>)[currency || '']
        || (currency ? ` ${currency}` : '（币种未提供）');
}

export function amount(value: unknown, currency: string | undefined, scale = 1): string | undefined {
    const n = numeric(value);
    if (n === undefined) return undefined;
    const scaled = n * scale;
    const unit = currencyUnit(currency);
    if (Math.abs(scaled) >= 1e8) return `${(scaled / 1e8).toFixed(2)}亿${unit}`;
    if (Math.abs(scaled) >= 1e4) return `${(scaled / 1e4).toFixed(2)}万${unit}`;
    return `${scaled.toFixed(2)}${unit}`;
}

export function perShare(value: unknown, currency: string | undefined): string | undefined {
    const n = numeric(value);
    return n === undefined ? undefined : `${n.toFixed(2)}${currencyUnit(currency)}`;
}

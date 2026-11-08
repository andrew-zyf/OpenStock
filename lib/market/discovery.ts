import { optionalNumber } from './contracts';

export type DiscoveryMember = {
    symbol: string; name: string; industry: string; price?: number; changePercent?: number; date?: string;
};
export type DiscoveryIndustry = {
    name: string; members: DiscoveryMember[]; averageChangePercent?: number;
};
export type DiscoveryData = {
    market: 'hk' | 'tw'; status: 'ready' | 'partial' | 'empty' | 'error';
    source: string; sourceUrl: string; fetchedAt: string; date?: string;
    received: number; total?: number; coverage: string; notes: string[];
    breadth: { up: number; down: number; flat: number; missing: number };
    industries: DiscoveryIndustry[];
};

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export function discoveryRows(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.filter(record) : [];
}
const numeric = (value: unknown) => optionalNumber(typeof value === 'string' ? value.replace(/,/g, '').trim() : value);

export function rocDate(value: unknown): string | undefined {
    if (typeof value !== 'string' || !/^\d{7}$/.test(value)) return undefined;
    const iso = `${Number(value.slice(0, 3)) + 1911}-${value.slice(3, 5)}-${value.slice(5, 7)}`;
    const timestamp = Date.parse(`${iso}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === iso ? iso : undefined;
}

export function parseTaiwanDiscovery(prices: unknown, companies: unknown): DiscoveryMember[] {
    const companyRows = discoveryRows(companies);
    const companyMap = new Map(companyRows.map((row) => [String(row['公司代號'] ?? ''), row]));
    return discoveryRows(prices).flatMap((row): DiscoveryMember[] => {
        const code = String(row.Code ?? '');
        if (!/^\d{4}$/.test(code)) return [];
        const company = companyMap.get(code);
        if (!company) return [];
        const close = numeric(row.ClosingPrice);
        const change = numeric(row.Change);
        const previous = close !== undefined && change !== undefined ? close - change : undefined;
        return [{
            symbol: `${code}.TW`, name: String(row.Name || company?.['公司簡稱'] || code),
            // Keep the official classification code; do not infer a sector from the company's name.
            industry: company?.['產業別'] ? `TWSE 产业代码 ${String(company['產業別'])}` : '未提供行业分类',
            price: close !== undefined && close > 0 ? close : undefined,
            changePercent: previous !== undefined && previous > 0 && close !== undefined && close > 0 ? change! / previous * 100 : undefined,
            date: rocDate(row.Date),
        }];
    });
}

export function parseHongKongDiscovery(value: unknown): DiscoveryMember[] {
    return discoveryRows(value).flatMap((row): DiscoveryMember[] => {
        const rawCode = String(row.f12 ?? '');
        if (!/^\d{1,5}$/.test(rawCode) || Number(rawCode) === 0) return [];
        const code = rawCode.padStart(5, '0');
        // This sample intentionally excludes RMB counters and other code ranges.
        if (!/^0\d{4}$/.test(code)) return [];
        const timestamp = numeric(row.f124);
        const date = timestamp !== undefined && timestamp > 0 && Number.isFinite(new Date(timestamp * 1000).getTime())
            ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp * 1000)) : undefined;
        const price = numeric(row.f2);
        return [{ symbol: `${code}.HK`, name: String(row.f14 || code),
            industry: typeof row.f100 === 'string' && row.f100.trim() && row.f100 !== '-' ? row.f100 : '未提供行业分类',
            price: price !== undefined && price > 0 ? price : undefined,
            changePercent: price !== undefined && price > 0 ? numeric(row.f3) : undefined,
            date,
        }];
    });
}

export function summarizeDiscovery(members: DiscoveryMember[]): Pick<DiscoveryData, 'date' | 'breadth' | 'industries'> {
    const unique = [...new Map(members.map((item) => [item.symbol, item])).values()];
    const date = unique.map((item) => item.date).filter((item): item is string => Boolean(item)).sort().at(-1);
    const breadth = { up: 0, down: 0, flat: 0, missing: 0 };
    const industries = new Map<string, DiscoveryMember[]>();
    for (const member of unique) {
        // A missing source date is not evidence that the observation belongs to the latest session.
        const current = Boolean(date) && member.date === date;
        const value = current ? member.changePercent : undefined;
        if (value === undefined || !Number.isFinite(value)) breadth.missing++;
        else if (value > 0) breadth.up++;
        else if (value < 0) breadth.down++;
        else breadth.flat++;
        const entry = { ...member, changePercent: value };
        industries.set(member.industry, [...(industries.get(member.industry) ?? []), entry]);
    }
    return { date, breadth, industries: [...industries].map(([name, group]) => {
        const values = group.flatMap((item) => item.changePercent !== undefined ? [item.changePercent] : []);
        return { name, members: group.sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity)),
            averageChangePercent: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined };
    }).sort((a, b) => (b.averageChangePercent ?? -Infinity) - (a.averageChangePercent ?? -Infinity)) };
}

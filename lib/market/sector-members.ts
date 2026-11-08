import { optionalNumber } from './contracts';
import { identifyMarketAndCode } from './instrument';

export const SECTOR_MEMBER_PAGE_SIZE = 100;
export const SECTOR_MEMBER_MAX_PAGES = 3;
export const SECTOR_MEMBER_SOURCE = 'https://push2.eastmoney.com/api/qt/clist/get';

export type ChinaSectorMember = {
    symbol: string; name: string; price?: number; changePercent?: number; asOf?: string; date?: string;
};
export type SectorMembersData = {
    sectorCode: string; status: 'ready' | 'partial' | 'unsupported' | 'empty' | 'error';
    source: string; sourceUrl: string; fetchedAt: string; date?: string; asOf?: string;
    total?: number; received: number; pages: number; failedPages: number; coverage: string; notes: string[];
    members: ChinaSectorMember[];
    breadth: { up: number; down: number; flat: number; missing: number };
    averageChangePercent?: number;
};

/** Reject foreign symbols rather than interpreting their numeric portion as an A-share. */
export function canonicalCNsymbol(value: string): string | undefined {
    const raw = value.trim().toUpperCase();
    if (!/^(?:\d{6}(?:\.(?:SS|SH|SZ|BJ))?|(?:SSE|SZSE|BSE):\d{6})$/.test(raw)) return undefined;
    const identity = identifyMarketAndCode(raw);
    return identity.market === 'cn' ? identity.normalizedSymbol : undefined;
}

export function isChinaIndustryCode(value: unknown): value is string {
    return typeof value === 'string' && /^BK\d{4}$/.test(value);
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function sectorMembersPage(value: unknown): { rows: Record<string, unknown>[]; total?: number } {
    if (!record(value) || (value.rc !== undefined && value.rc !== 0) || !record(value.data) || !Array.isArray(value.data.diff)
        || value.data.diff.length > SECTOR_MEMBER_PAGE_SIZE || !value.data.diff.every(record)) throw new Error('行业成员来源格式不可用');
    const total = optionalNumber(value.data.total);
    return { rows: value.data.diff, total: total !== undefined && Number.isSafeInteger(total) && total >= 0 ? total : undefined };
}

export function parseChinaSectorMembers(rows: Record<string, unknown>[]): ChinaSectorMember[] {
    const members = new Map<string, ChinaSectorMember>();
    for (const row of rows) {
        const code = String(row.f12 ?? '');
        const market = optionalNumber(row.f13);
        // EastMoney reports BSE securities with f13=0 too; preserve their own exchange identity.
        const bse = /^(?:[48]\d{5}|920\d{3})$/.test(code);
        const suffix = bse && market === 0 ? 'BJ'
            : /^6\d{5}$/.test(code) && market === 1 ? 'SS'
                : /^[03]\d{5}$/.test(code) && market === 0 ? 'SZ' : undefined;
        const symbol = suffix ? canonicalCNsymbol(`${code}.${suffix}`) : undefined;
        if (!symbol || members.has(symbol)) continue;
        const seconds = optionalNumber(row.f124);
        const timestamp = seconds !== undefined && seconds > 0 ? seconds * 1000 : NaN;
        const asOf = Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime()) ? new Date(timestamp).toISOString() : undefined;
        const date = asOf ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(asOf)) : undefined;
        const price = optionalNumber(row.f2);
        members.set(symbol, { symbol, name: typeof row.f14 === 'string' && row.f14.trim() ? row.f14.trim() : code,
            price, changePercent: price !== undefined && price > 0 ? optionalNumber(row.f3) : undefined, asOf, date });
    }
    return [...members.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function summarizeSectorMembers(members: ChinaSectorMember[]): Pick<SectorMembersData, 'members' | 'date' | 'asOf' | 'breadth' | 'averageChangePercent'> {
    const date = members.flatMap((member) => member.date ? [member.date] : []).sort().at(-1);
    const asOf = members.flatMap((member) => member.asOf ? [member.asOf] : []).sort().at(-1);
    const breadth = { up: 0, down: 0, flat: 0, missing: 0 };
    const values: number[] = [];
    const currentMembers = members.map((member) => {
        const value = date && member.date === date ? member.changePercent : undefined;
        if (value === undefined) breadth.missing++;
        else {
            values.push(value);
            if (value > 0) breadth.up++;
            else if (value < 0) breadth.down++;
            else breadth.flat++;
        }
        return { ...member, changePercent: value };
    });
    return { members: currentMembers, date, asOf, breadth,
        averageChangePercent: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined };
}

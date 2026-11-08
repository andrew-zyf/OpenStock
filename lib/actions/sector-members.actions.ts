'use server';

import {
    isChinaIndustryCode, parseChinaSectorMembers, sectorMembersPage, summarizeSectorMembers,
    SECTOR_MEMBER_MAX_PAGES, SECTOR_MEMBER_PAGE_SIZE, SECTOR_MEMBER_SOURCE, type SectorMembersData,
} from '@/lib/market/sector-members';

async function loadPage(sectorCode: string, page: number) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            (async () => {
                const query = new URLSearchParams({ pn: String(page), pz: String(SECTOR_MEMBER_PAGE_SIZE), po: '0', np: '1',
                    fltt: '2', invt: '2', fid: 'f12', fs: `b:${sectorCode}`, fields: 'f12,f13,f14,f2,f3,f124' });
                const response = await fetch(`${SECTOR_MEMBER_SOURCE}?${query}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' },
                    next: { revalidate: 300 }, signal: controller.signal,
                });
                if (!response.ok) throw new Error('行业成员来源响应失败');
                return sectorMembersPage(await response.json());
            })(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('行业成员来源超时')); }, 6_000); }),
        ]);
    } finally { clearTimeout(timer); }
}

export async function getChinaSectorMembers(sectorCode: string, market: string = 'cn'): Promise<SectorMembersData> {
    const base: SectorMembersData = {
        sectorCode: typeof sectorCode === 'string' ? sectorCode : '', status: 'error',
        source: '东方财富行业成员', sourceUrl: SECTOR_MEMBER_SOURCE, fetchedAt: new Date().toISOString(),
        received: 0, pages: 0, failedPages: 0, coverage: '尚未取得成员样本', notes: [], members: [],
        breadth: { up: 0, down: 0, flat: 0, missing: 0 },
    };
    // The caller supplies only a bounded board identifier, never a URL or arbitrary filter.
    if (market !== 'cn' || !isChinaIndustryCode(sectorCode)) return { ...base, status: 'unsupported', notes: ['仅支持 A股 BK 四位数字行业标识。'] };
    try {
        const first = await loadPage(sectorCode, 1);
        const pageCount = first.total !== undefined ? Math.min(SECTOR_MEMBER_MAX_PAGES, Math.max(1, Math.ceil(first.total / SECTOR_MEMBER_PAGE_SIZE)))
            : first.rows.length === SECTOR_MEMBER_PAGE_SIZE ? SECTOR_MEMBER_MAX_PAGES : 1;
        // First establish the source total, then read at most two additional pages concurrently.
        const results = await Promise.allSettled(Array.from({ length: pageCount - 1 }, (_, index) => loadPage(sectorCode, index + 2)));
        const pages = [first, ...results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])];
        const failedPages = results.filter((result) => result.status === 'rejected').length;
        const rows = pages.flatMap((page) => page.rows);
        const members = parseChinaSectorMembers(rows);
        const summary = summarizeSectorMembers(members);
        const totalsConsistent = pages.every((page) => page.total === first.total);
        const complete = first.total !== undefined && totalsConsistent && !failedPages && rows.length === first.total && members.length === first.total;
        const sample = !complete || summary.breadth.missing > 0;
        return { ...base, ...summary, total: first.total, received: rows.length, pages: pages.length, failedPages,
            fetchedAt: new Date().toISOString(),
            status: !members.length ? rows.length || failedPages || (first.total ?? 0) > 0 ? 'partial' : 'empty' : sample ? 'partial' : 'ready',
            coverage: `${complete ? '本次来源成员清单已覆盖' : '仅代表已取样本，不代表全行业'}：纳入 ${members.length} 只 / 来源总数 ${first.total ?? '未知'}；接收 ${rows.length} 条，成功 ${pages.length}/${pageCount} 页。按代码升序，每页最多 ${SECTOR_MEMBER_PAGE_SIZE} 条，最多 ${SECTOR_MEMBER_MAX_PAGES} 页。`,
            notes: [
                '上涨、下跌、平盘和等权均值仅使用样本最新来源日期且有有效价格与涨跌幅的成员；缺价、缺涨跌幅、无源时间或不同日计入缺失。',
                '来源时间为成员各自时间，汇总显示样本内最新时间；取回时间不是行情时间，不保证实时或全行业排名。',
                ...(failedPages ? [`${failedPages} 页请求失败，保留成功页面样本。`] : []),
                ...(!totalsConsistent ? ['分页来源总数发生变化，覆盖不完整。'] : []),
                ...(members.some((member) => member.symbol.endsWith('.BJ')) ? ['含北交所成员；本地详情保留 .BJ 身份，当前行情适配器覆盖有限。'] : []),
            ],
        };
    } catch {
        return { ...base, fetchedAt: new Date().toISOString(), failedPages: 1, notes: ['行业成员来源暂不可用，请稍后重试。'] };
    }
}

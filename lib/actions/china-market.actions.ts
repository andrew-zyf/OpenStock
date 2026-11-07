'use server';

export type ChinaMarketMacro = {
    totalTurnoverYi: number;
    totalTurnoverText: string;
    shTurnoverText: string;
    szTurnoverText: string;
    usdcnhRate?: number;
    usdcnhChangePercent?: number;
    updateTime: string;
};

export type ChineseNewsItem = {
    id: number;
    time: string;
    date: string;
    title: string;
    content: string;
    source?: string;
};

export async function getChinaMarketMacro(): Promise<ChinaMarketMacro | null> {
    try {
        const [sinaRes, yahooRes] = await Promise.all([
            fetch('http://hq.sinajs.cn/list=s_sh000001,s_sz399001', {
                headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' },
                next: { revalidate: 60 },
            }),
            fetch('https://query1.finance.yahoo.com/v8/finance/chart/USDCNH=X?interval=1d&range=1d', {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                next: { revalidate: 300 },
            }).catch(() => null),
        ]);

        if (!sinaRes.ok) return null;
        const buffer = await sinaRes.arrayBuffer();
        const text = new TextDecoder('gbk').decode(buffer);

        // Parse Shanghai & Shenzhen turnover
        // var hq_str_s_sh000001="上证指数,3649.1774,-40.7335,-1.10,4770425,77263457";
        const shMatch = text.match(/hq_str_s_sh000001="([^"]+)"/);
        const szMatch = text.match(/hq_str_s_sz399001="([^"]+)"/);

        let shWan = 0;
        let szWan = 0;
        if (shMatch) {
            const parts = shMatch[1].split(',');
            shWan = Number(parts[5]) || 0;
        }
        if (szMatch) {
            const parts = szMatch[1].split(',');
            szWan = Number(parts[5]) || 0;
        }

        const totalWan = shWan + szWan;
        const totalYi = Math.round(totalWan / 10000);
        const shYi = Math.round(shWan / 10000);
        const szYi = Math.round(szWan / 10000);

        let totalTurnoverText = '';
        if (totalYi >= 10000) {
            totalTurnoverText = `${(totalYi / 10000).toFixed(2)} 万亿元 (${totalYi.toLocaleString()} 亿)`;
        } else {
            totalTurnoverText = `${totalYi.toLocaleString()} 亿元`;
        }

        // Parse USD/CNH
        let usdcnhRate: number | undefined;
        let usdcnhChangePercent: number | undefined;
        if (yahooRes && yahooRes.ok) {
            const yahooJson = await yahooRes.json();
            const meta = yahooJson?.chart?.result?.[0]?.meta;
            if (meta?.regularMarketPrice) {
                usdcnhRate = meta.regularMarketPrice;
                usdcnhChangePercent = meta.regularMarketChangePercent;
            }
        }

        const now = new Date();
        const updateTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        return {
            totalTurnoverYi: totalYi,
            totalTurnoverText,
            shTurnoverText: `${shYi.toLocaleString()} 亿`,
            szTurnoverText: `${szYi.toLocaleString()} 亿`,
            usdcnhRate,
            usdcnhChangePercent,
            updateTime,
        };
    } catch (e) {
        console.error('China market macro error', e);
        return null;
    }
}

export async function getChineseLiveNews(): Promise<ChineseNewsItem[]> {
    try {
        const res = await fetch('https://zhibo.sina.com.cn/api/zhibo/feed?zhibo_id=152&type=0&page=1&page_size=30', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            next: { revalidate: 60 },
        });
        if (!res.ok) return [];

        const json = await res.json();
        const list = json?.result?.data?.feed?.list ?? [];

        return list.map((item: { id: number; create_time: string; rich_text: string }) => {
            const raw = (item.rich_text || '').trim();
            // Extract title if starts with 【...】
            const titleMatch = raw.match(/^【(.*?)】/);
            let title = '';
            let content = raw;
            if (titleMatch) {
                title = titleMatch[1];
                content = raw.replace(/^【.*?】/, '').trim();
            }

            // Extract source e.g. （新华社）or (央视新闻)
            const sourceMatch = content.match(/[（(]([^）)]+)[）)]\s*$/);
            let source = '';
            if (sourceMatch) {
                source = sourceMatch[1];
            }

            const dtParts = (item.create_time || '').split(' ');
            const date = dtParts[0] || '';
            const time = dtParts[1] ? dtParts[1].slice(0, 5) : '';

            return {
                id: item.id,
                time,
                date,
                title: title || (content.length > 30 ? content.slice(0, 30) + '...' : content),
                content,
                source,
            };
        });
    } catch (e) {
        console.error('Chinese live news error', e);
        return [];
    }
}

'use client';

import Link from 'next/link';
import { getMarketDiscovery } from '@/lib/actions/market-discovery.actions';
import { useMarketResource } from '@/hooks/useMarketResource';
import type { DiscoveryData } from '@/lib/market/discovery';

export default function MarketDiscoveryPanel({ market }: { market: 'hk' | 'tw' }) {
    const resource = useMarketResource<DiscoveryData>({ key: `discovery:${market}`, intervalMs: 300_000, loader: async () => {
        const result = await getMarketDiscovery(market);
        if (result.status === 'error') throw new Error(result.notes.join(' '));
        return result;
    } });
    const data = resource.data;
    return <section className="hatch min-w-0">
        <div className="section-head"><div>
            <h2 className="section-title">{market === 'hk' ? '港股' : '台股'}样本广度与行业</h2>
            <p className="section-sub">本市场证券下钻 · 行业数据为样本等权涨跌幅均值</p>
        </div></div>
        {resource.loading && <p className="text-xs text-faint" role="status">正在读取来源样本…</p>}
        {resource.error && <p className="text-xs text-amber-500" role="status">{data ? '刷新失败，保留上次样本。' : resource.error.message}</p>}
        {data && <div className="flex flex-col gap-3 text-xs">
            <p className="text-faint">{data.coverage}</p>
            <p>观察日期：{data.date ?? '来源未提供'} · 接收 {data.received} 条来源记录{data.total !== undefined ? ` · 来源清单 ${data.total} 条` : ''} · 纳入 {data.industries.reduce((sum, industry) => sum + industry.members.length, 0)} 只</p>
            <p>上涨 {data.breadth.up} · 下跌 {data.breadth.down} · 平盘 {data.breadth.flat} · 缺失或不同日 {data.breadth.missing}</p>
            {data.status === 'empty' && <p>当前来源没有可纳入的证券。</p>}
            <div className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto">
                {data.industries.map((industry) => <details key={industry.name} className="rounded border border-white/10 p-3">
                    <summary className="cursor-pointer">{industry.name} · {industry.members.length} 只 · 等权均值 {industry.averageChangePercent === undefined ? '—' : `${industry.averageChangePercent >= 0 ? '+' : ''}${industry.averageChangePercent.toFixed(2)}%`}</summary>
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {industry.members.map((member) => <li key={member.symbol} className="min-w-0">
                            <Link href={`/stocks/${encodeURIComponent(member.symbol)}`} className="flex flex-wrap justify-between gap-2 hover:underline">
                                <span className="break-words">{member.name} <span className="text-faint">{member.symbol}</span></span>
                                <span>{member.changePercent === undefined ? '涨跌幅未纳入' : `${member.changePercent >= 0 ? '+' : ''}${member.changePercent.toFixed(2)}%`}</span>
                            </Link>
                        </li>)}
                    </ul>
                </details>)}
            </div>
            {data.notes.map((note) => <p key={note} className="text-faint">{note}</p>)}
            <p className="text-faint">来源：<a href={data.sourceUrl} target="_blank" rel="noreferrer" className="underline">{data.source}</a> · 每 5 分钟检查来源，源数据频率另计</p>
        </div>}
    </section>;
}

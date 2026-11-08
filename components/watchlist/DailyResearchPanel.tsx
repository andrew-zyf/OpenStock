'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { getDailyResearch } from '@/lib/actions/relative-history.actions';
import { createPeerGroup, deletePeerGroup, getPeerGroups } from '@/lib/actions/peer-groups.actions';
import { canonicalPeerMember, DAILY_RESEARCH_LIMIT, type DailyResearchResult, type IntervalReturn, type PeerGroup } from '@/lib/market/daily-research';
import { getHistoricalBenchmarkOptions } from '@/lib/market/relative-history';

const BENCHMARKS = [...getHistoricalBenchmarkOptions('000001.SZ'), ...getHistoricalBenchmarkOptions('00700.HK')];
const percent = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
function IntervalCell({ value }: { value: IntervalReturn }) {
    if (value.status === 'unavailable') return <p className="text-xs text-faint">{value.reason}</p>;
    return <><p className="font-mono tabular-nums">{percent(value.stockReturn)}</p>
        <p className="text-xs">基准 {percent(value.benchmarkReturn)} · 差 {value.excessPercentagePoints.toFixed(2)} 个百分点</p>
        <p className="text-xs text-faint">{value.startDate} 至 {value.endDate} · {value.commonPoints} 点 / {value.intervals} 间隔</p></>;
}
export function DailyResearchTable({ data }: { data: DailyResearchResult }) {
    return <div className="space-y-3">
        <p className="text-xs text-faint">取回完成：{data.fetchedAt} · 基准 {data.benchmarkSymbol} · 当前可比 {data.rows.filter(row => row.comparison.status === 'available').length}/{data.rows.length} 个成员。
            {data.group && <> 固定成员保存于 {data.group.membershipSavedAt}；这是按保存名单回看价格，不代表当时成员或历史行业排名。</>}</p>
        <p className="text-xs text-faint">本次共同完成日样本：{data.commonDates.join('、') || '无'}。来源失败或口径不符的成员退出共同样本；没有自动补入其他成员。</p>
        {!!data.omittedMembers.length && <p className="text-xs text-warn">未纳入本次范围（市场不符、未支持或超过 {DAILY_RESEARCH_LIMIT} 只上限）：{data.omittedMembers.map(member => member.symbolId).join('、')}</p>}
        {!data.rows.length ? <p>该范围没有受支持的同市场自选。美股、台股实际复权口径未验证，北交所尚未支持。</p> :
            <div role="region" aria-label="日线与固定同业对照明细" tabIndex={0} className="max-h-[44rem] max-w-full overflow-auto rounded border border-line focus-visible:outline-2 focus-visible:outline-offset-2">
                <table className="w-full min-w-[64rem] border-separate border-spacing-0 text-left text-sm">
                    <caption className="p-3 text-left">完成日日线对照 · 同一可比成员集合的共同日期 · {data.group?.name ?? '关注中受支持自选'}</caption>
                    <thead className="sticky top-0 z-10 bg-surface"><tr>{['标的', '5 个交易间隔', '20 个交易间隔', '完整日成交量', '口径与原始样本'].map(label => <th scope="col" key={label} className="border-b border-line p-3">{label}</th>)}</tr></thead>
                    <tbody>{data.rows.map(row => <tr key={row.symbolId}>
                        <th scope="row" className="sticky left-0 border-b border-line bg-surface p-3 align-top"><Link className="underline" href={`/stocks/${row.symbol}`}>{row.symbol}</Link><p className="text-xs font-normal text-faint">{row.symbolId}</p></th>
                        {row.comparison.status === 'available' ? <><td className="border-b border-line p-3 align-top"><IntervalCell value={row.comparison.five} /></td><td className="border-b border-line p-3 align-top"><IntervalCell value={row.comparison.twenty} /></td></> : <td colSpan={2} className="border-b border-line p-3 align-top text-warn">{row.comparison.reason}</td>}
                        <td className="border-b border-line p-3 align-top">
                            <p>{row.volume.volume === undefined ? '最近完成日量缺失' : `${row.volume.volume.toLocaleString('zh-CN')} 股`} · {row.volume.date ?? '日期缺失'}</p>
                            <p>{row.volume.status === 'available' ? `相对前 20 完成日中位数 ${row.volume.ratio!.toFixed(2)} 倍` : row.volume.reason}</p>
                            <p className="text-xs text-faint">有效基线 {row.volume.sampleSize}/{row.volume.requiredSample} 日 · 中位数 {row.volume.median === undefined ? '未知' : `${row.volume.median.toLocaleString('zh-CN')} 股`}</p>
                            <p className="text-xs text-faint">量源 {row.volume.source ?? '未知'} · {row.volume.actualKey ?? '口径缺失'} · 取回 {row.volume.fetchedAt ?? '未知'}</p>
                        </td>
                        <td className="max-w-sm border-b border-line p-3 align-top text-xs">
                            {row.comparison.status === 'available' && <><p>{row.comparison.source} · {row.comparison.actualKey} · {row.comparison.adjustment === 'forward' ? '前复权' : '不复权（含除权除息影响）'} · {row.comparison.currency}</p>
                                <p>取回：标的 {row.comparison.fetchedAt.stock}；基准 {row.comparison.fetchedAt.benchmark}</p>
                                <p>缺失日：标的 {row.comparison.missingStockDates.join('、') || '无'}；基准 {row.comparison.missingBenchmarkDates.join('、') || '无'}</p>
                                <p>排除当日/未来日：{row.comparison.excludedCurrentDates.join('、') || '无'}</p></>}
                            <details className="mt-2"><summary className="cursor-pointer">查看原始价格与成交量样本</summary>
                                {row.comparison.status === 'available' && [row.comparison.five, row.comparison.twenty].map((value, index) => value.status === 'available' && <div key={index} className="mt-2"><p>{value.intervals} 间隔的完成日收盘（币种 {row.comparison.status === 'available' ? row.comparison.currency : ''}）：</p>{value.dates.map((date, i) => <p key={date}>{date} · 标的 {value.stockCloses[i]} / 基准 {value.benchmarkCloses[i]}</p>)}</div>)}
                                <p className="mt-2">成交量基线（股）：{row.volume.sampleDates.map((date, i) => `${date}: ${row.volume.sampleVolumes[i] ?? '缺失'}`).join('；') || '未取得样本'}</p>
                                <p>成交量缺失日期：{row.volume.missingDates.join('、') || '无'}；不足 20 个前置完成日不补样本，缺失不填 0。</p>
                            </details>
                        </td>
                    </tr>)}</tbody>
                </table>
            </div>}
    </div>;
}

export default function DailyResearchPanel({ watchedSymbols }: { watchedSymbols: { symbol: string; company?: string; symbolId?: string; market?: string }[] }) {
    const id = useId();
    const [scope, setScope] = useState<'watched' | 'group'>('watched');
    const [groups, setGroups] = useState<PeerGroup[]>([]);
    const [groupId, setGroupId] = useState('');
    const [benchmarkSymbol, setBenchmarkSymbol] = useState(BENCHMARKS[0].symbol);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [data, setData] = useState<DailyResearchResult | null>(null);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const members = [...new Map(watchedSymbols.flatMap(item => {
        try { const member = canonicalPeerMember(item.symbol); return [[member.symbolId, { ...member, company: item.company }] as const]; }
        catch { return []; }
    })).values()];
    const membershipKey = members.map(member => member.symbolId).sort().join(',');
    const [loadedMembershipKey, setLoadedMembershipKey] = useState('');
    const control = 'mt-1 min-h-12 w-full rounded border border-line bg-background px-3 py-2 text-base';
    async function run(task: () => Promise<void>) {
        if (pending.current) return;
        pending.current = true; setBusy(true); setMessage('');
        try { await task(); }
        catch (error) { setMessage(error instanceof Error ? error.message : '请求失败，请重试。'); }
        finally { pending.current = false; setBusy(false); }
    }
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const name = String(new FormData(form).get('name') ?? '');
        await run(async () => {
            const saved = await createPeerGroup({ name, symbolIds: selectedIds });
            setGroups(previous => [saved, ...previous]); setGroupId(saved.id); setScope('group'); setData(null);
            setMessage('固定成员已保存。成员变动请保存为新组，保存时间随新组记录。');
        });
    }
    return <section className="hatch min-w-0">
        <div className="section-head"><div><h2 className="section-title">盘后量价与我的同业组</h2><p className="section-sub">选择范围后按需读取 · 每次最多 20 只 · 无历史排名或回填行业成员</p></div></div>
        <div className="space-y-4 p-3 text-sm">
            <p className="text-xs text-faint">5/20 个交易间隔分别需要 6/21 个共同完成日收盘点。全部当天日K保守排除至下一交易所自然日；不计算盘中量比。收益为价格变化，不含股息再投资、费用或汇率变动。</p>
            <fieldset disabled={busy} className="flex flex-wrap gap-4"><legend className="mb-2 font-medium">比较范围</legend>
                {(['watched', 'group'] as const).map(value => <div key={value} className="flex min-h-12 items-center gap-2"><input id={`${id}-scope-${value}`} name={`${id}-scope`} type="radio" checked={scope === value} onChange={() => { setScope(value); setData(null); }} /><label htmlFor={`${id}-scope-${value}`}>{value === 'watched' ? '关注中受支持自选' : '我的固定同业组'}</label></div>)}
            </fieldset>
            <div className="grid items-end gap-3 sm:grid-cols-2">
                <div><label htmlFor={`${id}-benchmark`}>明确基准（ETF 仅为代理）</label><select id={`${id}-benchmark`} name="benchmark" disabled={busy} className={control} value={benchmarkSymbol} onChange={event => { setBenchmarkSymbol(event.target.value); setData(null); }}>{BENCHMARKS.map(option => <option key={option.symbol} value={option.symbol}>{option.label}</option>)}</select></div>
                {scope === 'group' && <div><label htmlFor={`${id}-group`}>固定名单</label><select id={`${id}-group`} name="group" disabled={busy} className={control} value={groupId} onChange={event => { setGroupId(event.target.value); setData(null); }}><option value="">请读取或新建分组</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}（{group.members.length} 只）</option>)}</select></div>}
            </div>
            <div className="flex flex-wrap gap-2">
                {scope === 'group' && <button type="button" className="btn min-h-12" disabled={busy} onClick={() => void run(async () => { const saved = await getPeerGroups(); setGroups(saved); setGroupId(previous => saved.some(group => group.id === previous) ? previous : saved[0]?.id ?? ''); setData(null); setMessage(`已读取 ${saved.length} 个固定组。`); })}>读取我的固定组</button>}
                <button type="button" className="btn btn-primary min-h-12" disabled={busy || (scope === 'group' && !groupId)} onClick={() => void run(async () => { const result = await getDailyResearch({ scope, groupId, benchmarkSymbol }); setData(result); setLoadedMembershipKey(membershipKey); })}>{busy ? '正在处理…' : '读取完成日日线对照'}</button>
                {scope === 'group' && groupId && <button type="button" className="btn min-h-12" disabled={busy} onClick={() => void run(async () => { await deletePeerGroup(groupId); setGroups(previous => previous.filter(group => group.id !== groupId)); setGroupId(''); setData(null); setMessage('已删除固定组。'); })}>删除所选固定组</button>}
            </div>
            <p className="text-xs text-faint">自选范围仅包含所选基准的同市场受支持成员，按加入自选时间取前 20 只；固定组保留保存名单，移出自选不会改写成员。所有可比成员使用同一共同日期集合；成员缺线可能使整个集合不足 6/21 点。成交量单独使用每只最近完成日及其前 20 日。</p>
            <p role="status" aria-live="polite">{message}</p>
            {data && (scope !== 'watched' || loadedMembershipKey === membershipKey) && <DailyResearchTable data={data} />}
            {data && scope === 'watched' && loadedMembershipKey !== membershipKey && <p role="status">自选成员已变更，请重新读取对照。</p>}
            <details className="rounded border border-line p-3"><summary className="cursor-pointer font-medium">保存我的固定同业组</summary>
                <form onSubmit={save} className="mt-3 space-y-3" aria-label="保存固定同业组">
                    <p id={`${id}-hint`} className="text-xs text-faint">手动选择当前关注中的 1–20 个成员；每账户最多 10 组。新组固定标的身份和保存日期，不会按当前行业名单自动改动。美股、台股可保存，实际复权未验证时退出比较。</p>
                    <div><label htmlFor={`${id}-name`}>组名</label><input id={`${id}-name`} name="name" required maxLength={60} disabled={busy} className={control} /></div>
                    <fieldset disabled={busy} aria-describedby={`${id}-hint`}><legend>固定成员（已选 {selectedIds.length}/20）</legend><div className="grid max-h-64 gap-1 overflow-auto sm:grid-cols-2">{members.map((member, index) => <div key={member.symbolId} className="flex min-h-12 items-center gap-2"><input id={`${id}-member-${index}`} name="member" type="checkbox" value={member.symbolId} checked={selectedIds.includes(member.symbolId)} onChange={event => { setSelectedIds(previous => event.target.checked ? [...previous, member.symbolId] : previous.filter(value => value !== member.symbolId)); }} /><label htmlFor={`${id}-member-${index}`}>{member.symbol} {member.company}</label></div>)}</div></fieldset>
                    <button type="submit" disabled={busy} className="btn min-h-12">保存为新的固定组</button>
                </form>
            </details>
        </div>
    </section>;
}

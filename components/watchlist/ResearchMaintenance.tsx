'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { getResearchMaintenanceStatus, type ResearchMaintenanceStatus } from '@/lib/actions/research-maintenance.actions';

const stateLabels = { idle: '协调空闲', busy: '其他研究请求处理中', maintenance: '需要管理员核查', unknown: '协调状态未知' };
const researchWriteLimit = 12 * 1024 * 1024;

function unknownStatus(): ResearchMaintenanceStatus {
    return { state: 'unknown', operationLabel: null, startedAt: null, checkedAt: '', capability: { transactions: null }, capacity: { state: 'unknown', documents: [], truncated: false } };
}

export default function ResearchMaintenance({ initialStatus }: { initialStatus?: ResearchMaintenanceStatus }) {
    const id = useId();
    const [status, setStatus] = useState<ResearchMaintenanceStatus>(initialStatus ?? unknownStatus);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const pending = useRef(false);
    const refresh = useCallback(async () => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true); setError('');
        try { setStatus(await getResearchMaintenanceStatus()); }
        catch {
            setStatus(unknownStatus());
            setError('状态读取未完成，请确认登录有效后重试；不能据此判断研究资料完整或保存成功。');
        } finally { pending.current = false; setBusy(false); }
    }, []);
    useEffect(() => {
        if (initialStatus) setStatus(initialStatus);
        else void refresh();
    }, [initialStatus, refresh]);

    const transactions = status.capability.transactions;
    return <section id="research-maintenance" className="rounded-xl border border-line bg-surface p-4 text-foreground sm:p-5" aria-labelledby={`${id}-title`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h2 id={`${id}-title`} className="text-lg font-semibold">资料与维护</h2>
                <p className="mt-2 text-sm leading-6">{stateLabels[status.state]}</p>
            </div>
            <button type="button" className="btn min-h-12 disabled:opacity-50" disabled={busy} onClick={() => void refresh()} aria-describedby={`${id}-scope`}>{busy ? '正在读取…' : '刷新维护状态'}</button>
        </div>
        <p id={`${id}-scope`} className="mt-2 text-sm leading-6 text-faint">仅检查当前账户；状态是读取时的协调信息，不代表刚才的保存已成功，也不会自动重试研究写入。</p>
        <dl className="mt-3 space-y-1 text-sm leading-6">
            {status.operationLabel && <div><dt className="inline text-faint">操作：</dt><dd className="inline">{status.operationLabel}</dd></div>}
            {status.startedAt && <div><dt className="inline text-faint">开始时间（UTC）：</dt><dd className="inline"><time dateTime={status.startedAt}>{status.startedAt}</time></dd></div>}
            {status.checkedAt && <div><dt className="inline text-faint">检查时间（UTC）：</dt><dd className="inline"><time dateTime={status.checkedAt}>{status.checkedAt}</time></dd></div>}
        </dl>
        {status.state !== 'idle' && <div className="mt-4 space-y-2 rounded-lg border border-line bg-background p-3 text-sm leading-6">
            <p>受影响的研究操作：关注与归档读取、新增关注、归档与恢复、观察保存、追加复核、研究变化读取、人工计划列表与到期读取、新建及修改计划、日期调整记录读取，以及研究备份导出、导入预览和导入。</p>
            <p>{status.state === 'busy' ? '其他请求尚未释放协调锁。稍后可刷新状态；等待时间长不能证明持有进程已停止。'
                : status.state === 'maintenance' ? '上一次写入结果未知：部分原始别名可能已经写入，其他部分可能尚未完成。当前不能把合并观点或缺失列表当作已核对的完整资料。'
                    : '尚不能确认协调状态，资料读取失败不等于没有研究记录；请保留当前草稿并检查服务状态。'}</p>
            <p>先把仍在编辑的草稿复制到本地文件；保留原页面，核查前不要重复提交同一保存请求。恢复后先比对已保存记录，再继续编辑。</p>
        </div>}
        <div className="mt-4 border-t border-line pt-4 text-sm leading-6">
            <h3 className="font-medium">备份导入能力</h3>
            <p className="mt-1">{transactions === true ? '数据库拓扑显示支持事务。实际导入仍需通过现有文件校验、冲突检查与事务执行；此检查不证明恢复已验收。'
                : transactions === false ? '当前数据库拓扑不支持安全事务导入；单机部署仅可使用现有导出与预览，不能改为部分写入。'
                    : '事务能力未知：只读 hello 检查未得到可确认的结果，不能据此承诺导入可用。'}</p>
            <p className="mt-1 text-faint">此处不会改写数据库配置。现有备份校验和协调限制继续生效；协调受阻时可能无法导出。未提供未经校验的原始恢复导出，请勿把状态说明视为完整备份。</p>
        </div>
        <details className="mt-4 border-t border-line pt-3">
            <summary className="min-h-12 cursor-pointer py-3 text-sm font-medium">容量取样与限制</summary>
            <div className="space-y-2 text-sm leading-6">
                <p className="text-faint">空闲时在研究只读协调锁内逐份读取 BSON 大小和数组条数，不读取笔记原文。最多取前 50 份原始研究记录及 1 份旧版人工计划书；不包含独立计划记录、日期调整记录及其分页历史，不涵盖全部工作台资料。取样不是最大记录排名，也不是同一时刻的完整快照；别名不会合并计算。</p>
                <p>单份研究记录现有写入保护线为 12 MiB；达到其 80% 时在此提前提示。原始条数不是合并后的历史总数；旧版计划书可能包含已被独立记录覆盖的原件，其条数不代表当前活动计划或可新建额度。</p>
                {status.capacity.state === 'skipped' && <p>协调未确认空闲，已跳过容量读取；未展示未经核对的合并记录。</p>}
                {status.capacity.state === 'unknown' && <p>容量未知：未能完成受协调保护的有界读取，不能按零条或零占用处理。</p>}
                {status.capacity.state === 'ready' && <>
                    {status.capacity.documents.length === 0 && <p>本次取样范围未找到原始研究记录或旧版人工计划书；独立计划及其他工作台资料仍可能存在。</p>}
                    <ul className="list-disc space-y-2 pl-5">
                        {status.capacity.documents.map((document) => <li key={`${document.kind}-${document.id}`} className="break-words">
                            {document.kind === 'research' ? `研究 ${document.symbol ?? '未识别代码'}` : '旧版人工计划书'} · 原始文档 <span className="break-all">{document.id}</span>：{document.bytes.toLocaleString('en-US')} 字节（{(document.bytes / (1024 * 1024)).toFixed(2)} MiB），{document.entries === null ? '数组条数未知' : `${document.entries} 条原始条目`}。
                            {document.kind === 'research' && document.bytes >= researchWriteLimit * 0.8 && <strong className="ml-1">接近或达到研究写入保护线，请在可用时先备份并联系管理员扩容；完成或归档不会释放这份历史的体积。</strong>}
                        </li>)}
                    </ul>
                    {status.capacity.truncated && <p>超过 50 份原始研究记录，仅显示前 50 份；未取样的记录仍可能接近容量上限。</p>}
                </>}
            </div>
        </details>
        <details className="mt-4 border-t border-line pt-3">
            <summary className="min-h-12 cursor-pointer py-3 text-sm font-medium">管理员人工恢复步骤</summary>
            <div className="space-y-2 text-sm leading-6">
                <p>仅供管理员执行已核验的恢复流程。页面不显示锁令牌，也不提供解锁操作。</p>
                <ol className="list-decimal space-y-2 pl-5">
                    <li>先停止并确认持锁进程不能恢复运行；不能仅凭锁的年龄判断进程已退出。</li>
                    <li>从受控数据库管理入口检查该账户的操作、标的、原始别名和历史，并记录精确的锁令牌，确认哪些写入已经生效。</li>
                    <li>完成或修复该操作，核对别名身份、观察与复核历史及相关资料；保留原文与草稿，不自动删除历史。</li>
                    <li>确认结果后，只按该账户与刚核对的精确令牌作为条件，清除对应的锁及意图、维护字段；令牌若已变化，应停止并重新检查，不能无条件解锁。</li>
                </ol>
                <p className="text-faint">恢复后重新读取维护状态并逐项核对资料，再决定是否重新保存草稿或执行现有备份；本页不会抢锁、续期或自动修复资料。</p>
            </div>
        </details>
        <p role="status" aria-live="polite" className="mt-3 text-sm leading-6">{error}</p>
    </section>;
}

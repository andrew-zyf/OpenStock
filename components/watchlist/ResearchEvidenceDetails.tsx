'use client';

import { useState } from 'react';
import { getResearchEvidence, type ResearchEvidenceView } from '@/lib/actions/research-evidence.actions';
import type { ResearchEvidenceReference } from '@/lib/watchlist-review';

export default function ResearchEvidenceDetails({ symbol, reference }: { symbol: string; reference: ResearchEvidenceReference }) {
    const [evidence, setEvidence] = useState<ResearchEvidenceView | null>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    async function load() {
        if (pending) return;
        setPending(true); setError('');
        try {
            const result = await getResearchEvidence(symbol, reference);
            if (result.success) setEvidence(result.evidence);
            else setError(result.error);
        } catch { setError('证据读取失败，当前复核记录仍保留。'); }
        finally { setPending(false); }
    }
    return <div className="min-w-0 space-y-2 rounded border border-line p-2 text-xs">
        <p className="break-all">{reference.kind === 'fact' ? '事实卡片' : '盘后对照'} · {reference.id}</p>
        <button type="button" className="btn min-h-12" disabled={pending} onClick={() => void load()}>{pending ? '正在读取证据…' : '读取已保存的原始证据'}</button>
        {error && <p role="status">{error}</p>}
        {evidence && <div className="space-y-2">
            <p className="font-medium">{evidence.title} · 留存 {evidence.recordedAt}</p>
            {evidence.kind === 'fact' && typeof evidence.data.factText === 'string' && <p className="whitespace-pre-wrap break-words">{evidence.data.factText}</p>}
            <p className="text-faint">以下为当时保存的资料。事实评价由用户填写；对照数据不会重新取回或改写本次记录。</p>
            <details><summary className="cursor-pointer">展开已保存的原始字段与样本</summary>
                <pre tabIndex={0} aria-label="已保存证据原始字段" className="mt-2 max-h-96 max-w-full overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2">{JSON.stringify(evidence.data, null, 2)}</pre>
            </details>
        </div>}
    </div>;
}

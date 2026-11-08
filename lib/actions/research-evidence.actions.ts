'use server';

import { connectToDatabase } from '@/database/mongoose';
import { requireUserId } from '@/lib/better-auth/auth';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { readResearchEvidence } from '@/lib/research-evidence';
import { validateEvidenceReferences, type ResearchEvidenceReference } from '@/lib/watchlist-review';

export type ResearchEvidenceView = { kind: 'fact' | 'comparison'; title: string; recordedAt: string; data: Record<string, unknown> };
export async function getResearchEvidence(symbol: string, reference: ResearchEvidenceReference): Promise<
    { success: true; evidence: ResearchEvidenceView } | { success: false; error: string }
> {
    const userId = await requireUserId();
    try {
        const checked = validateEvidenceReferences([reference])[0];
        if (typeof symbol !== 'string' || symbol.length > 40 || identifyMarketAndCode(symbol).kind === 'unknown') return { success: false, error: '无法识别研究标的' };
        await connectToDatabase();
        const record = await readResearchEvidence(userId, symbol, checked);
        if (!record) return { success: false, error: '未找到当前账户与这只标的关联的证据' };
        return { success: true, evidence: JSON.parse(JSON.stringify(record)) };
    } catch { return { success: false, error: '证据读取失败，已显示的研究与草稿仍保留，请稍后重试。' }; }
}

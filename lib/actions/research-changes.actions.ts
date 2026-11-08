'use server';

import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';
import { ResearchEventHistoryRecord, ResearchChangeStateRecord } from '@/database/models/research-change.model';
import { requireUserId } from '@/lib/better-auth/auth';
import { withWatchlistLifecycle } from '@/lib/watchlist-lifecycle';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { listDueManualPlans } from '@/lib/manual-plan-store';
import { getResearchFacts } from '@/lib/actions/research-facts.actions';
import { mergeWatchlistRecords, observationOwner, type SavedWatchlistRecord } from '@/lib/watchlist-observation';
import {
    CHANGE_LIMITATIONS, CHANGE_LIMITS, RESEARCH_CHANGE_CATEGORIES, applyResearchChangeState, eventResearchChanges, journalResearchChanges,
    manualFactResearchChanges, manualPlanResearchChanges, researchChangeCategory, sortResearchChanges, validateResearchChangeState,
    type ResearchChange, type ResearchChangeCategory, type ResearchChangeInbox, type ResearchChangeReadIssue,
    type ResearchChangeStateInput, type ResearchJournalRecord,
} from '@/lib/market/research-changes';

type CandidateResult = { entries: ResearchChange[]; truncated: boolean; readIssues: ResearchChangeReadIssue[]; successfulReads: number };
async function candidates(userId: string, now: Date, category?: ResearchChangeCategory): Promise<CandidateResult> {
    const result: CandidateResult = { entries: [], truncated: false, readIssues: [], successfulReads: 0 };
    const wants = (value: ResearchChangeCategory) => !category || category === value;
    async function read(scope: ResearchChangeReadIssue['scope'], message: string, callback: () => Promise<void>) {
        try { await callback(); result.successfulReads++; }
        catch { result.readIssues.push({ scope, message }); }
    }
    if (wants('external-fact') || wants('own-edit') || wants('review-due')) {
        await read('research', '活动研究读取失败或协调状态未核对；相关观点、复核与事件范围未确认，请刷新或核查维护状态。', async () => {
            const raw = await withWatchlistLifecycle(userId, { operation: 'research-changes-journal', readOnly: true }, async () => Watchlist.aggregate([
                { $match: { userId, archivedAt: null } }, { $sort: { addedAt: -1, _id: 1 } }, { $limit: CHANGE_LIMITS.records + 1 },
                { $project: { symbol: 1, company: 1, addedAt: 1, observationUpdatedAt: 1, nextReviewDate: 1,
                    group: 1, note: 1, invalidation: 1, targetPrice: 1, reviewStatus: 1, reviewedAt: 1, proximityPercent: 1,
                    journal: { $slice: [{ $ifNull: ['$journal', []] }, -CHANGE_LIMITS.journalTail] },
                    journalTruncated: { $gt: [{ $size: { $ifNull: ['$journal', []] } }, CHANGE_LIMITS.journalTail] } } },
            ]));
            const records: (SavedWatchlistRecord & { journalTruncated?: boolean })[] = JSON.parse(JSON.stringify(raw.slice(0, CHANGE_LIMITS.records)));
            const merged = mergeWatchlistRecords(records);
            result.truncated ||= raw.length > CHANGE_LIMITS.records;
            if (wants('own-edit') || wants('review-due')) {
                const journals: ResearchJournalRecord[] = merged.map((entry) => {
                    const aliases = records.filter((record) => identifyMarketAndCode(record.symbol).normalizedSymbol === entry.symbol);
                    return { ...entry, _id: observationOwner(aliases)._id,
                        journal: [...new Map(aliases.flatMap((record) => record.journal ?? []).map((revision) => [revision.id, revision])).values()],
                        journalTruncated: aliases.some((record) => record.journalTruncated) };
                });
                result.entries.push(...journalResearchChanges(journals, now).filter((entry) => wants(researchChangeCategory(entry))));
                if (wants('own-edit')) result.truncated ||= records.some((record) => record.journalTruncated);
            }
            if (wants('external-fact')) {
                await read('events', '已留存的事件版本读取失败；本次不能确认预约改期范围。', async () => {
                    const symbols = merged.map((entry) => entry.symbol);
                    const histories = symbols.length ? await ResearchEventHistoryRecord.find({ userId, symbol: { $in: symbols } })
                        .sort({ observedAt: -1, identity: 1 }).limit(CHANGE_LIMITS.histories + 1).lean() : [];
                    result.entries.push(...eventResearchChanges(histories.slice(0, CHANGE_LIMITS.histories)));
                    result.truncated ||= histories.length > CHANGE_LIMITS.histories || histories.some((history) => history.revision > CHANGE_LIMITS.versions);
                });
            }
        });
    }
    if (wants('plan-due')) await read('plans', '人工计划读取失败或协调状态未核对；本次不能确认计划到期范围。', async () => {
        const due = await listDueManualPlans(userId, now);
        result.entries.push(...manualPlanResearchChanges(due.plans, now)); result.truncated ||= due.truncated;
    });
    if (wants('external-fact')) await read('facts', '人工事实卡片读取失败；本次不能确认已登记事实范围。', async () => {
        const facts = await getResearchFacts({ limit: 50 });
        result.entries.push(...manualFactResearchChanges(facts.facts)); result.truncated ||= !!facts.nextCursor;
    });
    const entries = sortResearchChanges(result.entries);
    return { ...result, entries: entries.slice(0, CHANGE_LIMITS.candidates), truncated: result.truncated || entries.length > CHANGE_LIMITS.candidates };
}

export async function getResearchChanges(options: { limit?: number; includeHandled?: boolean; category?: ResearchChangeCategory } = {}): Promise<ResearchChangeInbox> {
    const userId = await requireUserId();
    const limit = options?.limit ?? 50;
    if (!options || !Number.isInteger(limit) || limit < 1 || limit > CHANGE_LIMITS.entries
        || (options.includeHandled !== undefined && typeof options.includeHandled !== 'boolean')
        || (options.category !== undefined && !RESEARCH_CHANGE_CATEGORIES.includes(options.category))) throw new Error('待办分页大小或分类无效');
    const failure = (readIssues: ResearchChangeReadIssue[]): ResearchChangeInbox => ({
        entries: [], limit, truncated: false, limitations: [...CHANGE_LIMITATIONS], readStatus: 'read-failed', readIssues,
    });
    try { await connectToDatabase(); }
    catch { return failure([{ scope: 'research', message: '研究资料数据库读取失败；本次尚未确认任何待办范围。' }]); }
    const now = new Date();
    const result = await candidates(userId, now, options.category);
    let states;
    try {
        states = result.entries.length ? await ResearchChangeStateRecord.find({ userId, changeId: { $in: result.entries.map((entry) => entry.id) } })
            .limit(CHANGE_LIMITS.candidates).lean() : [];
    } catch { return failure([...result.readIssues, { scope: 'handling', message: '待办处理状态读取失败；本次未展示无法确认处理状态的候选，请刷新核对。' }]); }
    const byId = new Map(states.map((state) => [state.changeId, state]));
    const entries = result.entries.map((entry) => applyResearchChangeState(entry, byId.get(entry.id), now))
        .filter((entry) => options.includeHandled || entry.status === 'pending');
    return { entries: entries.slice(0, limit), limit, truncated: result.truncated || entries.length > limit, limitations: [...CHANGE_LIMITATIONS],
        readStatus: result.readIssues.length ? (result.successfulReads ? 'partial' : 'read-failed') : 'read', readIssues: result.readIssues };
}

export async function setResearchChangeState(input: ResearchChangeStateInput): Promise<ResearchChange> {
    const userId = await requireUserId();
    const now = new Date();
    const value = validateResearchChangeState(input, now);
    await connectToDatabase();
    const kind = value.id.split(':')[0] as ResearchChange['kind'];
    // Re-derive only this category's concrete version from owner-scoped records; no plan/fact mutation.
    const entry = (await candidates(userId, now, researchChangeCategory({ kind }))).entries.find((change) => change.id === value.id);
    if (!entry) throw new Error('未找到当前账户可处理的变化或资料暂不可读，请刷新');
    const saved = { userId, changeId: value.id, status: value.status,
        snoozedUntil: value.snoozedUntil ? new Date(value.snoozedUntil) : null,
        revision: value.expectedStateVersion + 1, updatedAt: now };
    const conflict = () => new Error('待办已在其他页面更新，请刷新后重试');
    if (value.expectedStateVersion === 0) {
        try { await ResearchChangeStateRecord.create(saved); }
        catch (error) { if ((error as { code?: number }).code === 11000) throw conflict(); throw error; }
    } else {
        const result = await ResearchChangeStateRecord.updateOne({ userId, changeId: value.id, revision: value.expectedStateVersion }, { $set: saved });
        if (!result.matchedCount) throw conflict();
    }
    return applyResearchChangeState(entry, saved, now);
}

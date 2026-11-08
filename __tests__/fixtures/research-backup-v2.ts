import { createResearchBackupV2, WORKBENCH_COLLECTIONS, type ResearchBackup, type ResearchBackupV2, type WorkbenchCollection } from '@/lib/research-backup';
import { researchFactFingerprint, validateCreateResearchFact } from '@/lib/research-facts';
import { manualPlanFingerprint } from '@/lib/manual-plan';
import { DAILY_RESEARCH_ALGORITHM_VERSION } from '@/lib/research-comparisons';
import { createHash } from 'node:crypto';

export const backupTime = '2026-11-08T01:00:00.000Z';
export const planId = '11111111-1111-4111-8111-111111111111';
export const factId = '22222222-2222-4222-8222-222222222222';
export const rawId = '111111111111111111111111';
export const comparisonId = '333333333333333333333333';
export const groupId = '444444444444444444444444';
export function stateId(kind: string, identity: unknown) { return `${kind}:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`; }
export function v2Fixture(): ResearchBackupV2 {
    const revision = { kind: 'observation' as const, id: 'revision-1', recordedAt: backupTime, modifiedAt: backupTime, source: 'edit' as const, sourceSymbol: 'AAPL', observation: { note: '原判断', reviewStatus: 'watching' as const, nextReviewDate: '2026-11-08' } };
    const base: ResearchBackup = { format: 'openstock-research', version: 1, exportedAt: backupTime,
        research: [{ id: rawId, symbol: 'AAPL', company: 'Apple', addedAt: backupTime, observationUpdatedAt: backupTime, nextReviewDate: '2026-11-08', journalVersion: 2, journal: [revision,
            { kind: 'review', id: 'review-1', createdAt: backupTime, tradingDate: '2026-11-06', hypothesis: '原判断', changes: '变化', conclusion: '结论', verificationType: 'fact', evidenceURLs: [], evidenceReferences: [{ kind: 'fact', id: factId }, { kind: 'comparison', id: comparisonId }], clientRequestId: 'review-request' }] }],
        manualEvents: [], alertReferences: { referenceOnly: true, alerts: [] } };
    const planFields = { symbol: 'AAPL', waitingCondition: '核对', invalidation: '失效', nextAction: '行动', checkDate: '2026-11-07', clientRequestId: 'plan-request' };
    const factInput = validateCreateResearchFact({ symbol: 'AAPL', factType: 'earnings', reportingPeriod: 'FY2026', title: '业绩公告', factText: '人工登记原文', sourceUrl: 'https://example.com/report', sourcePublishedAt: null, assessment: 'undetermined', assessmentNote: '', clientRequestId: 'fact-request' });
    const { observationReference: _reference, ...factFields } = factInput; void _reference;
    const collections: Record<WorkbenchCollection, Record<string, unknown>[]> = {
        manualPlans: [{ ...planFields, id: planId, checkDate: '2026-11-08', manualState: 'completed', version: 3, scheduleRevision: 2, stateReason: '已核对', observationVersionId: revision.id, observationSnapshot: { recordedAt: backupTime, note: '原判断' }, createFingerprint: manualPlanFingerprint({ ...planFields, observationVersionId: revision.id }), createdAt: backupTime, updatedAt: backupTime }],
        planSchedules: [{ planId, revision: 2, fromDate: '2026-11-07', toDate: '2026-11-08', reason: '等待公告', changedAt: backupTime }],
        peerGroups: [{ id: groupId, slot: 0, name: '人工主题', purpose: 'theme', members: [{ symbolId: 'US:AAPL', symbol: 'AAPL' }], membershipSavedAt: backupTime }],
        eventHistories: [{ identity: 'source-event-AAPL', symbol: 'AAPL', revision: 105, observedAt: backupTime, versions: [{ id: 'event-version', date: '2026-11-09', previousDate: '2026-11-08', title: '日期变更', source: '已保存来源', discoveredAt: backupTime }] }],
        factCards: [{ ...factFields, id: factId, market: 'us', exchangeId: 'US', registrationMethod: 'manual', createdAt: backupTime, rootId: factId, version: 1, correctionOf: null, correctionReason: null,
            observationSnapshot: { recordId: rawId, sourceSymbol: 'AAPL', revisionId: revision.id, journalVersion: 2, observationUpdatedAt: backupTime, archivedAt: null, observation: revision.observation }, createFingerprint: researchFactFingerprint(factInput) }],
        comparisons: [{ id: comparisonId, requestId: 'comparison-request', draftId: 'saved-draft', savedAt: backupTime, createdAt: backupTime, caption: '样本不足，保留本次依据', algorithmVersion: DAILY_RESEARCH_ALGORITHM_VERSION,
            observationReference: { symbolId: 'US:AAPL', observationId: revision.id, version: backupTime }, originalObservation: revision,
            result: { scope: 'group', benchmarkSymbol: 'SPY', fetchedAt: backupTime, group: { id: groupId, name: '人工主题', purpose: 'theme', members: [{ symbolId: 'US:AAPL', symbol: 'AAPL' }], membershipSavedAt: backupTime },
                commonDates: [], omittedMembers: [], rows: [{ symbolId: 'US:AAPL', symbol: 'AAPL', comparison: { status: 'unavailable', reason: '共同样本不足' }, volume: { status: 'unavailable', reason: '样本不足', sampleDates: [], sampleVolumes: [], missingDates: [], sampleSize: 0, requiredSample: 20, volumeUnit: 'shares' } }] }, originalSeries: [{ symbol: 'AAPL', series: null }, { symbol: 'SPY', series: null }] }],
        changeStates: [
            ['review-due', [rawId, 'AAPL', '2026-11-08', backupTime]], ['manual-plan-due', [planId, 2]], ['manual-fact', [factId, 1]], ['event-date', ['source-event-AAPL', 'event-version']],
        ].map(([kind, identity]) => ({ changeId: stateId(kind as string, identity), status: 'processed', revision: 1, updatedAt: backupTime })),
    };
    const captureCollections = Object.fromEntries(['research', 'manualEvents', 'alertReferences', ...WORKBENCH_COLLECTIONS].map((name) => {
        const count = name === 'research' ? 1 : ['manualEvents', 'alertReferences'].includes(name) ? 0 : collections[name as WorkbenchCollection].length;
        return [name, { schemaVersion: 1, startedAt: backupTime, completedAt: backupTime, count, sourceCount: count, scope: '全部已留存记录', limitations: name === 'eventHistories' ? ['仅保留最近版本'] : [] }];
    })) as ResearchBackupV2['capture']['collections'];
    return createResearchBackupV2(base, collections, { consistency: 'independent-collection-reads', startedAt: backupTime, completedAt: backupTime, collections: captureCollections, unsupported: ['不保证跨集合同一时点'] });
}

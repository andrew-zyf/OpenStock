import { describe, expect, it } from 'vitest';
import { parseResearchBackup, planResearchImport, planWorkbenchImport, remapResearchEvidence, remapWorkbenchRow, researchAliasIds, researchImportId, WORKBENCH_COLLECTIONS, type WorkbenchCollection, type ResearchBackupV2 } from '@/lib/research-backup';
import { v2Fixture, planId, factId, rawId, comparisonId, groupId, stateId, backupTime } from './fixtures/research-backup-v2';

type Row = Record<string, unknown>;
const empty = () => Object.fromEntries(WORKBENCH_COLLECTIONS.map((name) => [name, [] as Row[]])) as Record<WorkbenchCollection, Row[]>;
const parse = (backup: ResearchBackupV2) => parseResearchBackup(JSON.stringify(backup));
function preview(backup: ResearchBackupV2, existing = empty(), symbols: string[] = []) { return planWorkbenchImport(backup, planResearchImport(backup, symbols, [], 'destination'), existing, 'destination'); }

describe('JSON v2 full retained workbench boundary', () => {
    it('roundtrips terminal plans, original request fingerprints, schedule history, themes, saved evidence and handling states', () => {
        const source = v2Fixture(); expect(parse(source)).toEqual(source);
        expect(source.manualPlans[0]).toMatchObject({ manualState: 'completed', scheduleRevision: 2, stateReason: '已核对' });
        expect(source.planSchedules[0]).toMatchObject({ planId, revision: 2 });
        expect(source.peerGroups[0].purpose).toBe('theme');
        expect(source.eventHistories[0]).toMatchObject({ revision: 105, versions: [expect.objectContaining({ previousDate: '2026-11-08' })] });
        expect(source.capture.consistency).toBe('independent-collection-reads');
        expect(preview(source).workbench?.every((item) => item.status === 'import')).toBe(true);
    });
    it('preserves long immutable legacy observation text without relaxing new-edit fields or BSON guards', () => {
        const source = v2Fixture(); const record = source.research[0];
        const revision = record.journal![0]; if (revision.kind !== 'observation') throw new Error('fixture');
        revision.observation.note = '历史原文'.repeat(1000); record.journal = [revision];
        const legacy = { format: source.format, version: 1, exportedAt: source.exportedAt, research: [record], manualEvents: [], alertReferences: source.alertReferences };
        expect(parseResearchBackup(JSON.stringify(legacy)).research[0].journal![0]).toEqual(revision);
        record.note = '新输入'.repeat(1000); expect(() => parseResearchBackup(JSON.stringify(legacy))).toThrow('观察字段');
    });
    it('rejects dishonest count/version/range and coherent snapshot claims', () => {
        for (const mutate of [
            (source: ResearchBackupV2) => { source.capture.collections.manualPlans.count++; },
            (source: ResearchBackupV2) => { source.capture.collections.comparisons.schemaVersion = 2 as 1; },
            (source: ResearchBackupV2) => { source.capture.collections.factCards.startedAt = '2026-11-07T00:00:00Z'; },
            (source: ResearchBackupV2) => { source.capture.consistency = 'transactional' as 'independent-collection-reads'; },
        ]) { const source = v2Fixture(); mutate(source); expect(() => parse(source)).toThrow(); }
    });
    it.each(WORKBENCH_COLLECTIONS)('rejects unknown ownership/action payload fields in %s', (collection) => {
        const source = v2Fixture(); Object.assign(source[collection][0], { userId: 'injected', $set: { active: true } }); expect(() => parse(source)).toThrow('不支持的字段');
    });
    it('rejects nested owner/action instructions in saved evidence, plan snapshots and member identities', () => {
        for (const mutate of [
            (source: ResearchBackupV2) => Object.assign(source.comparisons[0].result as Row, { ownerId: 'other' }),
            (source: ResearchBackupV2) => Object.assign(source.factCards[0].observationSnapshot as Row, { runAlerts: true }),
            (source: ResearchBackupV2) => Object.assign(source.manualPlans[0].observationSnapshot as Row, { userId: 'other' }),
            (source: ResearchBackupV2) => { (source.peerGroups[0].members as Row[])[0].symbolId = 'US:MSFT'; },
            (source: ResearchBackupV2) => { source.manualPlans[0].createFingerprint = JSON.stringify(['AAPL', {}, 'condition', 'action', '2026-11-08']); },
        ]) { const source = v2Fixture(); mutate(source); expect(() => parse(source)).toThrow(); }
    });
    it('rejects dangling and cross-symbol evidence/version references before a plan can be built', () => {
        for (const mutate of [
            (source: ResearchBackupV2) => { (source.factCards[0].observationSnapshot as Row).recordId = '999999999999999999999999'; },
            (source: ResearchBackupV2) => { source.manualPlans[0].observationVersionId = 'missing'; },
            (source: ResearchBackupV2) => { const entry = source.research[0].journal![1]; if (entry.kind === 'review') entry.evidenceReferences![0].id = 'missing'; },
            (source: ResearchBackupV2) => { source.factCards[0].correctionOf = factId; },
        ]) { const source = v2Fixture(); mutate(source); expect(() => parse(source)).toThrow(); }
    });
    it('remaps Mongo identities and references deterministically while preserving owner-scoped journal/plan/fact IDs', () => {
        const source = v2Fixture(); const aliasId = researchAliasIds(source, 'destination').get(rawId)!;
        expect(aliasId).toBe(`${researchImportId('destination', 'aliases:AAPL').slice(0, 18)}000000`);
        expect(remapWorkbenchRow(source, 'manualPlans', source.manualPlans[0], 'destination')).toMatchObject({ id: planId, userId: 'destination' });
        const fact = remapWorkbenchRow(source, 'factCards', source.factCards[0], 'destination');
        expect(fact).toMatchObject({ id: factId, rootId: factId, userId: 'destination', observationSnapshot: { recordId: aliasId, revisionId: 'revision-1' }, createFingerprint: source.factCards[0].createFingerprint });
        const comparison = remapWorkbenchRow(source, 'comparisons', source.comparisons[0], 'destination');
        expect(comparison).toMatchObject({ _id: researchImportId('destination', comparisonId), result: { group: { id: researchImportId('destination', groupId) } }, observationReference: { observationId: 'revision-1' } });
        const research = remapResearchEvidence(source.research[0], 'destination');
        expect(research.journal![0].id).toBe('revision-1');
        const review = research.journal![1]; if (review.kind !== 'review') throw new Error('fixture');
        expect(review.evidenceReferences).toEqual([{ kind: 'fact', id: factId }, { kind: 'comparison', id: researchImportId('destination', comparisonId) }]);
        const state = remapWorkbenchRow(source, 'changeStates', source.changeStates[0], 'destination');
        expect(state.changeId).toBe(stateId('review-due', [aliasId, 'AAPL', '2026-11-08', backupTime]));
        expect(source.factCards[0].observationSnapshot).toMatchObject({ recordId: rawId });
    });
    it('preserves complete immutable fact correction chains and skips both versions on a conflict', () => {
        const source = v2Fixture(); const id = '33333333-3333-4333-8333-333333333333';
        const correction: Row = { ...source.factCards[0], id, version: 2, correctionOf: factId, correctionReason: '修正原文', factText: '修正后的原文', clientRequestId: 'fact-correction-request' };
        const fingerprint = JSON.parse(correction.createFingerprint as string) as unknown[];
        fingerprint[4] = correction.factText; fingerprint[10] = factId; fingerprint[11] = correction.correctionReason;
        correction.createFingerprint = JSON.stringify(fingerprint); source.factCards.push(correction);
        source.capture.collections.factCards.count++; source.capture.collections.factCards.sourceCount++;
        expect(parse(source).version).toBe(2);
        expect(remapWorkbenchRow(source, 'factCards', correction, 'destination')).toMatchObject({ id, correctionOf: factId, rootId: factId, version: 2 });
        const existing = empty(); existing.factCards = [correction];
        expect(preview(source, existing).workbench!.filter((item) => item.collection === 'factCards').map((item) => item.status)).toEqual(['skip-related', 'skip-existing']);
    });
    it('skips a whole connected evidence group when research, fact, comparison or stable request already exists', () => {
        for (const collection of ['manualPlans', 'factCards', 'comparisons', 'peerGroups'] as const) {
            const source = v2Fixture(); const existing = empty(); existing[collection] = [source[collection][0]];
            const plan = preview(source, existing);
            expect(plan.research[0].status).toBe('skip-related');
            expect(plan.workbench!.filter((item) => !['eventHistories', 'changeStates'].includes(item.collection)).every((item) => item.status !== 'import')).toBe(true);
            expect(plan.workbench!.find((item) => item.collection === 'eventHistories')!.status).toBe('import');
        }
        const source = v2Fixture(); const plan = preview(source, empty(), ['AAPL']);
        expect(plan.workbench!.find((item) => item.collection === 'factCards')!.status).toBe('skip-related');
        expect(plan.workbench!.find((item) => item.collection === 'planSchedules')!.status).toBe('skip-related');
    });
    it('allocates remaining capacity only after conflicted evidence groups are removed', () => {
        const source = v2Fixture(); const existing = empty();
        source.peerGroups.push({ ...source.peerGroups[0], id: '555555555555555555555555', slot: 1, name: '独立组' });
        existing.peerGroups = Array.from({ length: 9 }, (_, slot) => ({ id: `existing-${slot}`, slot }));
        const groups = preview(source, existing, ['AAPL']).workbench!.filter((item) => item.collection === 'peerGroups');
        expect(groups.map((item) => item.status)).toEqual(['skip-related', 'import']);
        source.manualPlans[0].manualState = 'waiting';
        const independent: Row = { ...source.manualPlans[0], id: '33333333-3333-4333-8333-333333333333', scheduleRevision: 1, clientRequestId: 'independent-plan-request' };
        delete independent.observationVersionId; delete independent.observationSnapshot;
        independent.createFingerprint = JSON.stringify(['AAPL', '核对', '失效', '行动', '2026-11-07']);
        source.manualPlans.push(independent);
        existing.manualPlans = Array.from({ length: 99 }, (_, i) => ({ id: `existing-plan-${i}`, manualState: 'waiting' }));
        const plans = preview(source, existing, ['AAPL']).workbench!.filter((item) => item.collection === 'manualPlans');
        expect(plans.map((item) => item.status)).toEqual(['skip-related', 'import']);
    });
    it('retains opaque historical handling states in the file and explicitly skips unsupported restoration', () => {
        const source = v2Fixture(); source.changeStates.push({ changeId: stateId('review-due', ['old-deleted-version']), revision: 1, status: 'ignored', updatedAt: backupTime });
        source.capture.collections.changeStates.count++; source.capture.collections.changeStates.sourceCount++;
        expect(parse(source).version).toBe(2);
        expect(preview(source).workbench!.at(-1)).toMatchObject({ collection: 'comparisons', status: 'import' });
        expect(preview(source).workbench!.find((item) => item.id === source.changeStates.at(-1)!.changeId)?.status).toBe('skip-unsupported');
    });
    it('enforces waiting-plan/group capacity without discarding terminal history or silently splitting evidence', () => {
        const source = v2Fixture(); source.manualPlans[0].manualState = 'waiting';
        const existing = empty(); existing.manualPlans = Array.from({ length: 100 }, (_, i) => ({ id: `existing-${i}`, manualState: 'waiting' }));
        expect(preview(source, existing).workbench!.find((item) => item.collection === 'manualPlans')?.status).toBe('skip-capacity');
        source.manualPlans[0].manualState = 'completed'; expect(preview(source, existing).workbench!.find((item) => item.collection === 'manualPlans')?.status).toBe('import');
        existing.peerGroups = Array.from({ length: 10 }, (_, slot) => ({ id: `group-${slot}`, slot }));
        expect(preview(source, existing).workbench!.find((item) => item.collection === 'peerGroups')?.status).toBe('skip-capacity');
        expect(preview(source, existing).research[0].status).toBe('skip-related');
    });
});

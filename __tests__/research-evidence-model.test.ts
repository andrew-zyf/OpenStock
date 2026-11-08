import { describe, expect, it } from 'vitest';
import { ResearchFact } from '@/database/models/research-fact.model';
import { ResearchComparisonRecord } from '@/database/models/research-comparison.model';
import { Watchlist } from '@/database/models/watchlist.model';
import { validateEvidenceReferences, type WatchlistReview } from '@/lib/watchlist-review';

// Schema-only contract checks: no database connection, index creation or document writes.
describe('evidence identity and persistence field contracts', () => {
    it('keeps manual fact UUID identity separate from MongoDB document identity and registration time', () => {
        const factId = '11111111-1111-4111-8111-111111111111';
        const fact = new ResearchFact({ id: factId, userId: 'owner', symbol: 'AAPL', createdAt: new Date('2026-11-08T00:00:00Z'), registrationMethod: 'manual' });
        expect(fact.id).toBe(factId); expect(String(fact._id)).not.toBe(factId);
        for (const field of ['id', 'symbol', 'createdAt', 'sourcePublishedAt', 'registrationMethod', 'observationSnapshot', 'correctionOf', 'rootId', 'version']) expect(ResearchFact.schema.path(field).options.immutable).toBe(true);
        expect(ResearchFact.schema.path('createdAt').instance).toBe('Date');
        expect(ResearchFact.schema.path('sourcePublishedAt').instance).toBe('String');
        expect(ResearchFact.schema.path('sourcePublishedAt').options.default).toBeNull();
        expect(ResearchFact.schema.path('fetchedAt')).toBeUndefined();
        expect(validateEvidenceReferences([{ kind: 'fact', id: factId }])).toEqual([{ kind: 'fact', id: factId }]);
    });
    it('uses comparison MongoDB ID, savedAt and result.rows.symbol rather than a manual fact id field', () => {
        const record = new ResearchComparisonRecord({ userId: 'owner', savedAt: new Date('2026-11-08T01:00:00Z'), result: { rows: [{ symbol: 'AAPL' }] } });
        expect(String(record._id)).toMatch(/^[a-f0-9]{24}$/);
        expect(ResearchComparisonRecord.schema.path('id')).toBeUndefined();
        expect(ResearchComparisonRecord.schema.path('savedAt').instance).toBe('Date');
        for (const field of ['userId', 'savedAt', 'result', 'originalSeries', 'originalObservation', 'observationReference']) expect(ResearchComparisonRecord.schema.path(field).options.immutable).toBe(true);
        expect(validateEvidenceReferences([{ kind: 'comparison', id: String(record._id) }])).toHaveLength(1);
        expect(ResearchComparisonRecord.schema.indexes()).toEqual(expect.arrayContaining([
            [expect.objectContaining({ userId: 1, requestId: 1 }), expect.objectContaining({ unique: true })],
            [expect.objectContaining({ userId: 1, draftId: 1 }), expect.objectContaining({ unique: true })],
        ]));
    });
    it('round-trips both evidence kinds in the existing Mixed journal without altering historical refs', () => {
        const review: WatchlistReview = { kind: 'review', id: 'review-a', createdAt: '2026-11-08T01:00:00Z', tradingDate: '2026-11-08', hypothesis: '原假设', changes: '新证据', conclusion: '人工核查', verificationType: 'fact', evidenceURLs: [], clientRequestId: 'review-request', evidenceReferences: [
            { kind: 'fact', id: '11111111-1111-4111-8111-111111111111' },
            { kind: 'comparison', id: '111111111111111111111111' },
        ] };
        const record = new Watchlist({ userId: 'owner', symbol: 'AAPL', company: 'Apple', journal: [review] });
        expect(record.validateSync()).toBeUndefined();
        expect(record.toObject().journal?.[0]).toEqual(review);
        expect(Watchlist.schema.path('journal').options.select).toBe(false);
    });
});

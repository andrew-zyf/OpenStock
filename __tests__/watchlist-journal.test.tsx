import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WatchlistJournal, { JournalRecord, mergeJournalEntries, reviewInputFromDraft, safeEvidenceURL, validateReviewDraft, type ReviewDraft } from '@/components/watchlist/WatchlistJournal';
import type { WatchlistReview, ObservationRevision } from '@/lib/watchlist-review';

vi.mock('@/lib/actions/watchlist.actions', () => ({ appendWatchlistReview: vi.fn(), getWatchlistJournal: vi.fn(), updateWatchlistObservation: vi.fn() }));
const draft: ReviewDraft = { tradingDate: '2026-11-06', hypothesis: '原假设', changes: '已公布结果发生变化', conclusion: '仍需复核', verificationType: 'fact', evidenceURLs: 'https://example.com/source', nextReviewDate: '' };
const review: WatchlistReview = { kind: 'review', id: 'review-a', createdAt: '2026-11-07T03:00:00Z', tradingDate: '2026-11-06', hypothesis: '原文假设', changes: '原文变化', conclusion: '原文结论', verificationType: 'fact', evidenceURLs: ['https://example.com/source'], clientRequestId: 'request-a' };

describe('review journal form and append payload', () => {
    it('renders an SSR-safe form with explicit user-selected trading day, native constraints, labels and enabled submit', () => {
        const html = renderToStaticMarkup(<WatchlistJournal entry={{ symbol: 'AAPL', company: 'Apple', addedAt: '2026-11-01T00:00:00Z', reviewStatus: 'watching' }} onSaved={vi.fn()} onClose={vi.fn()} />);
        expect(html).toContain('method="post"');
        expect(html).toContain('正在加载历史');
        expect(html).toContain('America/New_York');
        for (const field of Object.keys(draft)) expect(html).toContain(`name="${field}"`);
        expect(html).toContain('type="date"');
        expect(html).toContain('value=""');
        expect(html).toContain('maxLength="2000"');
        expect(html).toContain('aria-live="polite"');
        expect(html).not.toContain('disabled=');
        expect(html).not.toContain('aria-invalid="true"');
    });
    it('rejects empty, invalid or future trading dates and requires all three texts after interaction', () => {
        expect(validateReviewDraft({ ...draft, tradingDate: '', hypothesis: ' ', changes: '', conclusion: '' }, '2026-11-06')).toHaveProperty('tradingDate');
        expect(validateReviewDraft({ ...draft, tradingDate: '2026-02-30' })).toHaveProperty('tradingDate');
        expect(validateReviewDraft({ ...draft, tradingDate: '2026-11-07' }, '2026-11-06')).toHaveProperty('tradingDate');
        expect(validateReviewDraft({ ...draft, changes: 'a'.repeat(2001), verificationType: 'unknown' })).toMatchObject({ changes: expect.any(String), verificationType: expect.any(String) });
        expect(validateReviewDraft(draft, '2026-11-06')).toEqual({});
    });
    it('keeps blank next date omitted and carries explicit dates, correction identity and stable retry identity', () => {
        const input = reviewInputFromDraft(draft, 'retry-id', 'review-a');
        expect(input).toMatchObject({ tradingDate: '2026-11-06', clientRequestId: 'retry-id', correctionOf: 'review-a', evidenceURLs: ['https://example.com/source'] });
        expect(input).not.toHaveProperty('nextReviewDate');
        expect(input).not.toHaveProperty('sourceQuote');
        expect(reviewInputFromDraft({ ...draft, nextReviewDate: '2026-11-10' }, 'next-id').nextReviewDate).toBe('2026-11-10');
    });
    it.each(['javascript:alert(1)', 'data:text/html,hello', 'file:///Users/test', 'https://user:password@example.com', '//example.com'])('does not expose unsafe evidence as a clickable link: %s', value => {
        expect(safeEvidenceURL(value)).toBeUndefined();
        expect(validateReviewDraft({ ...draft, evidenceURLs: value })).toHaveProperty('evidenceURLs');
        const html = renderToStaticMarkup(<JournalRecord entry={{ ...review, evidenceURLs: [value] }} onCorrect={vi.fn()} />);
        expect(html).not.toContain('href=');
        expect(html).toContain('无效链接');
    });
    it('shows the actual HTTP(S) destination and preserves original text in correction entries', () => {
        const corrected = { ...review, id: 'review-b', correctionOf: 'review-a', conclusion: '更正结论' };
        const html = renderToStaticMarkup(<><JournalRecord entry={review} onCorrect={vi.fn()} /><JournalRecord entry={corrected} onCorrect={vi.fn()} /></>);
        expect(html).toContain('原文结论');
        expect(html).toContain('更正结论');
        expect(html).toContain('更正原记录：review-a');
        expect(html).toContain('href="https://example.com/source"');
        expect(html).toContain('rel="noopener noreferrer nofollow"');
        expect(html).toContain('https://example.com/source</a>');
    });
    it('merges every revision returned by a plan-changing append, including retries and older pagination', () => {
        const prior: ObservationRevision = { kind: 'observation', id: 'prior', recordedAt: '2026-11-06T03:00:00Z', modifiedAt: '2026-11-06T03:00:00Z', source: 'edit', observation: { reviewStatus: 'watching', nextReviewDate: '2026-11-07' } };
        const before: ObservationRevision = { ...prior, id: 'before', recordedAt: review.createdAt };
        const after: ObservationRevision = { ...prior, id: 'after', recordedAt: review.createdAt, modifiedAt: review.createdAt, observation: { reviewStatus: 'watching', nextReviewDate: '2026-11-10' } };
        const batch = [before, after, { ...review, nextReviewDate: '2026-11-10' }];
        const appended = mergeJournalEntries([prior], batch);
        expect(appended.map(item => item.id).sort()).toEqual(['after', 'before', 'prior', 'review-a']);
        const retried = mergeJournalEntries(appended, batch);
        expect(retried).toEqual(appended);
        const older = { ...prior, id: 'older', recordedAt: '2026-11-05T03:00:00Z' };
        const paged = mergeJournalEntries(retried, [prior, older]);
        expect(paged).toHaveLength(5);
        const html = renderToStaticMarkup(<>{paged.map(item => <JournalRecord key={item.id} entry={item} onCorrect={vi.fn()} />)}</>);
        expect(html).toContain('2026-11-07');
        expect(html).toContain('2026-11-10');
        expect(html).toContain('复核记录');
    });
    it('merges overlapping pages without losing appended reviews or inventing legacy modification times', () => {
        const old: ObservationRevision = { kind: 'observation', id: 'old', recordedAt: '2026-11-06T03:00:00Z', modifiedAt: null, source: 'legacy-capture', observation: { reviewStatus: 'watching', note: '旧记录' } };
        expect(mergeJournalEntries([review], [review, old]).map(entry => entry.id)).toEqual(['review-a', 'old']);
        const html = renderToStaticMarkup(<JournalRecord entry={old} onCorrect={vi.fn()} />);
        expect(html).toContain('未知（不以加入时间代替）');
        expect(html).toContain('旧记录');
    });
});

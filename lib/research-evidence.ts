import { ResearchFact } from '@/database/models/research-fact.model';
import { ResearchComparisonRecord } from '@/database/models/research-comparison.model';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import type { ResearchEvidenceReference } from '@/lib/watchlist-review';

/** Callers supply the authenticated owner; never resolve an evidence ID across accounts. */
export async function readResearchEvidence(userId: string, symbol: string, reference: ResearchEvidenceReference) {
    const ticker = identifyMarketAndCode(symbol).normalizedSymbol;
    if (reference.kind === 'fact') {
        const fact = await ResearchFact.findOne({ userId, id: reference.id, symbol: ticker }).lean();
        if (!fact) return null;
        return {
            kind: 'fact' as const, title: fact.title, recordedAt: new Date(fact.createdAt).toISOString(),
            data: {
                id: fact.id, symbol: fact.symbol, factType: fact.factType, reportingPeriod: fact.reportingPeriod,
                title: fact.title, factText: fact.factText, sourceUrl: fact.sourceUrl,
                sourcePublishedAt: fact.sourcePublishedAt, registrationMethod: fact.registrationMethod,
                assessment: fact.assessment, assessmentNote: fact.assessmentNote,
                observationSnapshot: fact.observationSnapshot, correctionOf: fact.correctionOf,
                correctionReason: fact.correctionReason, rootId: fact.rootId, version: fact.version,
                createdAt: fact.createdAt,
            },
        };
    }
    if (!/^[a-f\d]{24}$/i.test(reference.id)) return null;
    const snapshot = await ResearchComparisonRecord.findOne({ userId, _id: reference.id }).lean();
    if (!snapshot || !snapshot.result.rows.some(row => identifyMarketAndCode(row.symbol).normalizedSymbol === ticker)) return null;
    return {
        kind: 'comparison' as const, title: snapshot.caption || '已保存的盘后对照', recordedAt: new Date(snapshot.savedAt).toISOString(),
        data: {
            id: String(snapshot._id), savedAt: snapshot.savedAt, caption: snapshot.caption,
            algorithmVersion: snapshot.algorithmVersion, result: snapshot.result,
            originalSeries: snapshot.originalSeries, observationReference: snapshot.observationReference,
            originalObservation: snapshot.originalObservation,
        },
    };
}

export async function researchEvidenceBelongsTo(userId: string, symbol: string, references: ResearchEvidenceReference[]) {
    const ticker = identifyMarketAndCode(symbol).normalizedSymbol;
    const records = await Promise.all(references.map(reference => {
        if (reference.kind === 'fact') return ResearchFact.exists({ userId, id: reference.id, symbol: ticker });
        if (!/^[a-f\d]{24}$/i.test(reference.id)) return null;
        return ResearchComparisonRecord.exists({ userId, _id: reference.id, 'result.rows.symbol': ticker });
    }));
    return records.every(Boolean);
}

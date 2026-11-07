/** All timestamps are ISO-8601. Missing asOf means the source supplied no verified time. */
export type SourceMetadata = {
    source: string;
    asOf?: string;
    fetchedAt: string;
};

/** Missing, blank and provider sentinel values are absent; a reported zero stays zero. */
export function optionalNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' && typeof value !== 'string') return undefined;
    if (typeof value === 'string' && !value.trim()) return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

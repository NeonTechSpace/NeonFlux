export function isFluxerGuildUnavailable(guild: unknown): boolean {
    return typeof guild === 'object' && guild !== null && (guild as { available?: unknown }).available === false;
}

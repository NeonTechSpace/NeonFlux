export type FluxerBotVoiceStateEvent = {
    guildId: string | null;
    userId: string | null;
    channelId: string | null;
    oldChannelId: string | null;
    oldChannelOccupancy: number | null;
};

export type VoiceStateCache = Map<string, Map<string, string>>;

type RawFluxerVoiceState = {
    guild_id?: string | null;
    guildId?: string | null;
    user_id?: string | null;
    userId?: string | null;
    channel_id?: string | null;
    channelId?: string | null;
};

export function normalizeVoiceStateEvent(
    event: RawFluxerVoiceState,
    voiceStateCache: VoiceStateCache
): FluxerBotVoiceStateEvent {
    const guildId = event.guild_id ?? event.guildId ?? null;
    const userId = event.user_id ?? event.userId ?? null;
    const channelId = event.channel_id ?? event.channelId ?? null;
    const guildVoiceState = guildId ? voiceStateCache.get(guildId) : undefined;
    const oldChannelId = userId ? (guildVoiceState?.get(userId) ?? null) : null;

    if (guildId && userId) {
        const nextGuildVoiceState = guildVoiceState ?? new Map<string, string>();

        if (channelId) {
            nextGuildVoiceState.set(userId, channelId);
        } else {
            nextGuildVoiceState.delete(userId);
        }

        voiceStateCache.set(guildId, nextGuildVoiceState);
    }

    return {
        guildId,
        userId,
        channelId,
        oldChannelId,
        oldChannelOccupancy:
            oldChannelId && guildVoiceState ? countVoiceChannelOccupancy(guildVoiceState, oldChannelId) : null,
    };
}

export function syncVoiceStateCache(
    voiceStateCache: VoiceStateCache,
    event: { guildId?: string | null; guild_id?: string | null; voiceStates?: RawFluxerVoiceState[] }
): void {
    const guildId = event.guild_id ?? event.guildId ?? null;

    if (!guildId) {
        return;
    }

    const guildVoiceState = new Map<string, string>();

    for (const voiceState of event.voiceStates ?? []) {
        const userId = voiceState.user_id ?? voiceState.userId ?? null;
        const channelId = voiceState.channel_id ?? voiceState.channelId ?? null;

        if (userId && channelId) {
            guildVoiceState.set(userId, channelId);
        }
    }

    voiceStateCache.set(guildId, guildVoiceState);
}

function countVoiceChannelOccupancy(guildVoiceState: Map<string, string>, channelId: string): number {
    let count = 0;

    for (const activeChannelId of guildVoiceState.values()) {
        if (activeChannelId === channelId) {
            count += 1;
        }
    }

    return count;
}

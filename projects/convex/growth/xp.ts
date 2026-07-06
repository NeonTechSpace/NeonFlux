import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import {
    applyXpGrant,
    buildGuildUserXpDocument,
    buildXpGrantDocument,
    buildXpRoleRewardDocument,
    buildXpSettingsDocument,
    calculateXpLevel,
    normalizeRequiredGuildId,
    normalizeRequiredRoleId,
    normalizeRequiredUserId,
    normalizeXpLimit,
    normalizeXpVoiceSeconds,
    toGuildUserXpRecord,
    toXpGrantRecord,
    toXpRoleRewardRecord,
    toXpSettingsRecord,
    type GuildUserXpDocument,
    type XpGrantDocument,
    type XpRoleRewardDocument,
    type XpSettingsDocument,
} from './xp_model.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
type XpQueryCtx = QueryCtx;
type XpMutationCtx = MutationCtx;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredXpSettingsDocument = XpSettingsDocument & { _id: GenericId<'xpSettings'> };
type StoredGuildUserXpDocument = GuildUserXpDocument & { _id: GenericId<'guildUserXp'> };
type StoredXpGrantDocument = XpGrantDocument & { _id: GenericId<'xpGrants'> };
type StoredXpRoleRewardDocument = XpRoleRewardDocument & { _id: GenericId<'xpRoleRewards'> };

const allowedXpServices = ['bot', 'web'] as const;
const nullableString = v.union(v.string(), v.null());
const settingsRecordValidator = v.object({
    config: v.any(),
    cooldownSeconds: v.number(),
    enabled: v.boolean(),
    guildId: v.string(),
    messageXpMax: v.number(),
    messageXpMin: v.number(),
    updatedAt: v.string(),
    voiceMinimumMinutes: v.number(),
    voiceXpPerMinute: v.number(),
});
const userXpRecordValidator = v.object({
    guildId: v.string(),
    id: v.string(),
    lastMessageXpAt: nullableString,
    lastVoiceXpAt: nullableString,
    level: v.number(),
    messageCount: v.number(),
    messageXp: v.number(),
    updatedAt: v.string(),
    userId: v.string(),
    voiceSeconds: v.number(),
    voiceXp: v.number(),
    xp: v.number(),
});
const grantRecordValidator = v.object({
    grantedAt: v.string(),
    guildId: v.string(),
    id: v.string(),
    idempotencyKey: v.string(),
    levelAfter: v.number(),
    levelBefore: v.number(),
    metadata: v.any(),
    source: v.union(v.literal('message'), v.literal('voice')),
    userId: v.string(),
    xp: v.number(),
});
const roleRewardRecordValidator = v.object({
    createdAt: v.string(),
    guildId: v.string(),
    id: v.string(),
    level: v.number(),
    roleId: v.string(),
    updatedAt: v.string(),
});
const grantResultValidator = v.union(
    v.object({ grant: grantRecordValidator, status: v.literal('granted'), userXp: userXpRecordValidator }),
    v.object({ status: v.literal('duplicate'), userXp: v.union(userXpRecordValidator, v.null()) })
);

export const upsertXpSettings = mutation({
    args: {
        config: v.optional(v.any()),
        cooldownSeconds: v.optional(v.number()),
        enabled: v.optional(v.boolean()),
        guildId: v.string(),
        messageXpMax: v.optional(v.number()),
        messageXpMin: v.optional(v.number()),
        updatedAt: v.optional(v.string()),
        voiceMinimumMinutes: v.optional(v.number()),
        voiceXpPerMinute: v.optional(v.number()),
    },
    returns: settingsRecordValidator,
    handler: async (ctx: XpMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedXpServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const existing = await findXpSettingsDocument(ctx, guildId);
        const document = unwrap(buildXpSettingsDocument({ ...args, guildId }, new Date().toISOString()));

        if (existing) {
            await ctx.db.patch(existing._id, document);
        } else {
            await ctx.db.insert('xpSettings', document);
        }

        return toXpSettingsRecord(document);
    },
});

export const findXpSettingsByGuildId = query({
    args: { guildId: v.string() },
    returns: v.union(settingsRecordValidator, v.null()),
    handler: async (ctx: XpQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedXpServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const settings = await findXpSettingsDocument(ctx, guildId);

        return settings ? toXpSettingsRecord(settings) : null;
    },
});

export const addGuildUserXp = mutation({
    args: {
        guildId: v.string(),
        level: v.number(),
        userId: v.string(),
        xp: v.number(),
    },
    returns: userXpRecordValidator,
    handler: async (ctx: XpMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedXpServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));

        await requireGuildDocument(ctx, guildId);

        const now = new Date().toISOString();
        const validatedInput = unwrap(buildGuildUserXpDocument({ ...args, guildId, userId }, now));
        const existing = await findGuildUserXpDocument(ctx, { guildId, userId });
        const base = existing ?? validatedInput;
        const document = existing
            ? {
                  ...existing,
                  lastMessageXpAt: now,
                  level: validatedInput.level,
                  messageCount: existing.messageCount + 1,
                  messageXp: existing.messageXp + validatedInput.xp,
                  updatedAt: now,
                  xp: existing.xp + validatedInput.xp,
              }
            : base;

        if (existing) {
            await ctx.db.patch(existing._id, {
                lastMessageXpAt: document.lastMessageXpAt,
                level: document.level,
                messageCount: document.messageCount,
                messageXp: document.messageXp,
                updatedAt: document.updatedAt,
                xp: document.xp,
            });
            return toGuildUserXpRecord({ ...document, _id: existing._id });
        } else {
            const id = await ctx.db.insert('guildUserXp', document);
            return toGuildUserXpRecord({ ...document, _id: id });
        }
    },
});

export const grantGuildUserXp = mutation({
    args: {
        guildId: v.string(),
        idempotencyKey: v.string(),
        metadata: v.optional(v.any()),
        occurredAt: v.optional(v.string()),
        source: v.union(v.literal('message'), v.literal('voice')),
        userId: v.string(),
        voiceSeconds: v.optional(v.number()),
        xp: v.number(),
    },
    returns: grantResultValidator,
    handler: async (ctx: XpMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedXpServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));

        await requireGuildDocument(ctx, guildId);

        const existingGrant = await findXpGrantByGuildKey(ctx, { guildId, idempotencyKey: args.idempotencyKey });
        const current = await findGuildUserXpDocument(ctx, { guildId, userId });

        if (existingGrant) {
            return { status: 'duplicate' as const, userXp: current ? toGuildUserXpRecord(current) : null };
        }

        const levelBefore = current?.level ?? 0;
        const levelAfter = calculateXpLevel((current?.xp ?? 0) + args.xp);
        const grant = unwrap(
            buildXpGrantDocument({ ...args, guildId, userId }, levelBefore, levelAfter, new Date().toISOString())
        );
        const aggregate = applyXpGrant(current, grant, unwrap(normalizeXpVoiceSeconds(args.voiceSeconds)));

        const grantId = await ctx.db.insert('xpGrants', grant);
        let userXpId: GenericId<'guildUserXp'>;

        if (current) {
            await ctx.db.patch(current._id, toGuildUserXpPatch(aggregate));
            userXpId = current._id;
        } else {
            userXpId = await ctx.db.insert('guildUserXp', aggregate);
        }

        return {
            grant: toXpGrantRecord({ ...grant, _id: grantId }),
            status: 'granted' as const,
            userXp: toGuildUserXpRecord({ ...aggregate, _id: userXpId }),
        };
    },
});

export const upsertXpRoleReward = mutation({
    args: { guildId: v.string(), level: v.number(), roleId: v.string() },
    returns: roleRewardRecordValidator,
    handler: async (ctx: XpMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedXpServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const roleId = unwrap(normalizeRequiredRoleId(args.roleId));

        await requireGuildDocument(ctx, guildId);

        const existing = await findXpRoleRewardDocument(ctx, { guildId, level: args.level, roleId });
        const document = unwrap(
            buildXpRoleRewardDocument({ ...args, guildId, roleId }, new Date().toISOString(), existing ?? undefined)
        );

        if (existing) {
            await ctx.db.patch(existing._id, { updatedAt: document.updatedAt });
            return toXpRoleRewardRecord({ ...document, _id: existing._id });
        } else {
            const id = await ctx.db.insert('xpRoleRewards', document);
            return toXpRoleRewardRecord({ ...document, _id: id });
        }
    },
});

export const findGuildUserXp = query({
    args: { guildId: v.string(), userId: v.string() },
    returns: v.union(userXpRecordValidator, v.null()),
    handler: async (ctx: XpQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedXpServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const userXp = await findGuildUserXpDocument(ctx, { guildId, userId });

        return userXp ? toGuildUserXpRecord(userXp) : null;
    },
});

export const findGuildUserXpRank = query({
    args: { guildId: v.string(), userId: v.string() },
    returns: v.union(v.object({ rank: v.number(), userXp: userXpRecordValidator }), v.null()),
    handler: async (ctx: XpQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedXpServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const userXp = await findGuildUserXpDocument(ctx, { guildId, userId });

        if (!userXp) return null;

        const rows = await ctx.db
            .query('guildUserXp')
            .withIndex('by_guild_xp_level_user', (query) => query.eq('guildId', guildId))
            .take(10000);
        const higherCount = rows.filter((row) => row.xp > userXp.xp).length;

        return { rank: higherCount + 1, userXp: toGuildUserXpRecord(userXp) };
    },
});

export const listGuildXpLeaderboard = query({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(userXpRecordValidator),
    handler: async (ctx: XpQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedXpServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const rows = await ctx.db
            .query('guildUserXp')
            .withIndex('by_guild_xp_level_user', (query) => query.eq('guildId', guildId))
            .order('desc')
            .take(1000);

        return rows
            .sort(
                (left, right) =>
                    right.xp - left.xp || right.level - left.level || left.userId.localeCompare(right.userId)
            )
            .slice(0, normalizeXpLimit(args.limit))
            .map(toGuildUserXpRecord);
    },
});

async function findXpSettingsDocument(
    ctx: XpQueryCtx | XpMutationCtx,
    guildId: string
): Promise<StoredXpSettingsDocument | null> {
    return await ctx.db
        .query('xpSettings')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();
}

async function findGuildUserXpDocument(
    ctx: XpQueryCtx | XpMutationCtx,
    input: { guildId: string; userId: string }
): Promise<StoredGuildUserXpDocument | null> {
    return await ctx.db
        .query('guildUserXp')
        .withIndex('by_guild_user', (query) => query.eq('guildId', input.guildId).eq('userId', input.userId))
        .unique();
}

async function findXpGrantByGuildKey(
    ctx: XpMutationCtx,
    input: { guildId: string; idempotencyKey: string }
): Promise<StoredXpGrantDocument | null> {
    return await ctx.db
        .query('xpGrants')
        .withIndex('by_guild_key', (query) =>
            query.eq('guildId', input.guildId).eq('idempotencyKey', input.idempotencyKey.trim())
        )
        .unique();
}

async function findXpRoleRewardDocument(
    ctx: XpMutationCtx,
    input: { guildId: string; level: number; roleId: string }
): Promise<StoredXpRoleRewardDocument | null> {
    return await ctx.db
        .query('xpRoleRewards')
        .withIndex('by_guild_level_role', (query) =>
            query.eq('guildId', input.guildId).eq('level', input.level).eq('roleId', input.roleId)
        )
        .unique();
}

async function requireGuildDocument(ctx: XpMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) throw new Error('guild-not-found');

    return guild;
}

function toGuildUserXpPatch(document: GuildUserXpDocument) {
    return {
        ...(document.lastMessageXpAt === undefined ? {} : { lastMessageXpAt: document.lastMessageXpAt }),
        ...(document.lastVoiceXpAt === undefined ? {} : { lastVoiceXpAt: document.lastVoiceXpAt }),
        level: document.level,
        messageCount: document.messageCount,
        messageXp: document.messageXp,
        updatedAt: document.updatedAt,
        voiceSeconds: document.voiceSeconds,
        voiceXp: document.voiceXp,
        xp: document.xp,
    };
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) throw new Error('invalid-input');

    return result.value;
}

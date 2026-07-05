import {
    mutationGeneric,
    queryGeneric,
    type DataModelFromSchemaDefinition,
    type GenericMutationCtx,
    type GenericQueryCtx,
} from 'convex/server';
import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import type schema from '../schema.js';
import {
    buildVcGeneratorControlRequestDocument,
    normalizeRequiredGuildId,
    normalizeRequiredLimit,
    toGeneratedVoiceChannelRecord,
    toVcGeneratorControlRequestRecord,
    type GeneratedVoiceChannelDocument,
    type VcGeneratorControlRequestDocument,
} from './vc_generator_model.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type ControlRequestQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type ControlRequestMutationCtx = GenericMutationCtx<NeonFluxDataModel>;
type StoredGeneratedChannelDocument = GeneratedVoiceChannelDocument & { _id: GenericId<'generatedVoiceChannels'> };
type StoredControlRequestDocument = VcGeneratorControlRequestDocument & {
    _id: GenericId<'vcGeneratorControlRequests'>;
};

const allowedVcGeneratorServices = ['bot', 'web'] as const;
const nullableString = v.union(v.string(), v.null());
const controlRequestStatuses = ['pending', 'applied', 'failed', 'cancelled', 'expired'] as const;
const generatedChannelRecordValidator = v.object({
    channelId: v.string(),
    createdAt: v.string(),
    guildId: v.string(),
    id: v.string(),
    lastSeenAt: v.string(),
    ownerUserId: nullableString,
    ruleId: nullableString,
    status: v.string(),
    updatedAt: v.string(),
});
const controlRequestRecordValidator = v.object({
    completedAt: nullableString,
    controlAction: v.string(),
    createdAt: v.string(),
    errorMessage: nullableString,
    expiresAt: v.string(),
    generatedChannelId: v.string(),
    guildId: v.string(),
    id: v.string(),
    panelChannelId: v.string(),
    promptMessageId: nullableString,
    requesterUserId: v.string(),
    status: v.string(),
    targetChannelId: v.string(),
    updatedAt: v.string(),
    value: nullableString,
});

export const findActiveGeneratedVoiceChannelByOwner = queryGeneric({
    args: { guildId: v.string(), ownerUserId: v.string(), ruleId: v.optional(v.string()) },
    returns: v.union(generatedChannelRecordValidator, v.null()),
    handler: async (ctx: ControlRequestQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const channels = await ctx.db
            .query('generatedVoiceChannels')
            .withIndex('by_guild_owner_status_created', (query) =>
                query.eq('guildId', guildId).eq('ownerUserId', args.ownerUserId).eq('status', 'active')
            )
            .order('desc')
            .take(20);
        const channel = args.ruleId ? channels.find((entry) => entry.ruleLegacyId === args.ruleId) : channels[0];

        return channel ? toGeneratedVoiceChannelRecord(channel) : null;
    },
});

export const createVcGeneratorControlRequest = mutationGeneric({
    args: {
        controlAction: v.string(),
        expiresAt: v.string(),
        generatedChannelId: v.string(),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        panelChannelId: v.string(),
        promptMessageId: v.optional(v.union(v.string(), v.null())),
        requesterUserId: v.string(),
        status: v.optional(v.string()),
        targetChannelId: v.string(),
    },
    returns: controlRequestRecordValidator,
    handler: async (ctx: ControlRequestMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGeneratedChannel(ctx, { generatedChannelId: args.generatedChannelId, guildId });

        const now = new Date().toISOString();
        const document = unwrap(buildVcGeneratorControlRequestDocument({ ...args, guildId }, now));

        if (document.status === 'pending') {
            const pending = await findPendingControlRequests(ctx, document);
            for (const request of pending) {
                await ctx.db.patch(request._id, {
                    completedAt: now,
                    errorMessage: 'replaced-by-new-request',
                    status: 'cancelled',
                    updatedAt: now,
                });
            }
        }

        await ctx.db.insert('vcGeneratorControlRequests', document);

        return toVcGeneratorControlRequestRecord(document);
    },
});

export const findPendingVcGeneratorControlRequest = queryGeneric({
    args: { guildId: v.string(), panelChannelId: v.string(), requesterUserId: v.string() },
    returns: v.union(controlRequestRecordValidator, v.null()),
    handler: async (ctx: ControlRequestQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        const requests = await findPendingControlRequests(ctx, args);

        return requests[0] ? toVcGeneratorControlRequestRecord(requests[0]) : null;
    },
});

export const updateVcGeneratorControlRequest = mutationGeneric({
    args: {
        errorMessage: v.optional(v.union(v.string(), v.null())),
        promptMessageId: v.optional(v.union(v.string(), v.null())),
        requestId: v.string(),
        status: v.optional(v.string()),
        value: v.optional(v.union(v.string(), v.null())),
    },
    returns: v.union(controlRequestRecordValidator, v.null()),
    handler: async (ctx: ControlRequestMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        assertStatus(args.status, controlRequestStatuses, 'status');
        const request = await findControlRequestByLegacyId(ctx, args.requestId);

        if (!request) return null;

        const now = new Date().toISOString();
        const patch: {
            completedAt?: string;
            errorMessage?: string | undefined;
            promptMessageId?: string | undefined;
            status?: string;
            updatedAt: string;
            value?: string | undefined;
        } = { updatedAt: now };
        if (args.status) {
            patch.status = args.status;
            if (args.status !== 'pending') patch.completedAt = now;
        }
        if (args.promptMessageId !== undefined) patch.promptMessageId = normalizeOptionalString(args.promptMessageId);
        if (args.value !== undefined) patch.value = normalizeOptionalString(args.value);
        if (args.errorMessage !== undefined) patch.errorMessage = normalizeOptionalString(args.errorMessage);

        await ctx.db.patch(request._id, patch);
        const updated = await findControlRequestByLegacyId(ctx, args.requestId);

        if (!updated) throw new Error('control-request-not-found');

        return toVcGeneratorControlRequestRecord(updated);
    },
});

export const expirePendingVcGeneratorControlRequests = mutationGeneric({
    args: { limit: v.optional(v.number()), now: v.string() },
    returns: v.array(controlRequestRecordValidator),
    handler: async (ctx: ControlRequestMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        const parsedNow = normalizeTimestamp(args.now, 'now');
        const due = await ctx.db
            .query('vcGeneratorControlRequests')
            .withIndex('by_status_expires', (query) => query.eq('status', 'pending').lte('expiresAt', parsedNow))
            .order('asc')
            .take(normalizeRequiredLimit(args.limit, 25));

        for (const request of due) {
            await ctx.db.patch(request._id, {
                completedAt: parsedNow,
                errorMessage: 'expired-by-maintenance',
                status: 'expired',
                updatedAt: parsedNow,
            });
        }

        return due.map((request) =>
            toVcGeneratorControlRequestRecord({
                ...request,
                completedAt: parsedNow,
                errorMessage: 'expired-by-maintenance',
                status: 'expired',
                updatedAt: parsedNow,
            })
        );
    },
});

async function findGeneratedByLegacyId(
    ctx: ControlRequestMutationCtx,
    legacyId: string
): Promise<StoredGeneratedChannelDocument | null> {
    return await ctx.db
        .query('generatedVoiceChannels')
        .withIndex('by_legacy', (query) => query.eq('legacyId', unwrapRequiredString(legacyId, 'generatedChannelId')))
        .unique();
}

async function findControlRequestByLegacyId(
    ctx: ControlRequestMutationCtx,
    requestId: string
): Promise<StoredControlRequestDocument | null> {
    return await ctx.db
        .query('vcGeneratorControlRequests')
        .withIndex('by_legacy', (query) => query.eq('legacyId', unwrapRequiredString(requestId, 'requestId')))
        .unique();
}

async function findPendingControlRequests(
    ctx: ControlRequestQueryCtx | ControlRequestMutationCtx,
    input: { guildId: string; panelChannelId: string; requesterUserId: string }
): Promise<StoredControlRequestDocument[]> {
    return await ctx.db
        .query('vcGeneratorControlRequests')
        .withIndex('by_guild_panel_requester', (query) =>
            query
                .eq('guildId', unwrapRequiredString(input.guildId, 'guildId'))
                .eq('panelChannelId', unwrapRequiredString(input.panelChannelId, 'panelChannelId'))
                .eq('requesterUserId', unwrapRequiredString(input.requesterUserId, 'requesterUserId'))
                .eq('status', 'pending')
        )
        .order('desc')
        .take(100);
}

async function requireGeneratedChannel(
    ctx: ControlRequestMutationCtx,
    input: { generatedChannelId: string; guildId: string }
): Promise<StoredGeneratedChannelDocument> {
    const channel = await findGeneratedByLegacyId(ctx, input.generatedChannelId);
    if (channel?.guildId !== input.guildId) throw new Error('generated-channel-not-found');
    return channel;
}

function assertStatus(value: string | undefined, allowed: readonly string[], field: string): void {
    if (value !== undefined && !allowed.includes(value)) throw new Error(`${field}-invalid-value`);
}

function normalizeTimestamp(value: string, field: string): string {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error(`${field}-invalid-value`);
    return new Date(parsed).toISOString();
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();
    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function unwrapRequiredString(value: string, field: string): string {
    const normalizedValue = normalizeOptionalString(value);
    if (!normalizedValue) throw new Error(`${field}-missing-input`);
    return normalizedValue;
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) {
        const error = result.error;
        if (typeof error === 'object' && error !== null && 'type' in error) throw new Error(String(error.type));
        throw new Error(String(error));
    }
    return result.value;
}

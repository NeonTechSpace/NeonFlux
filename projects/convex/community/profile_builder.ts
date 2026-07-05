import {
    mutationGeneric,
    queryGeneric,
    type DataModelFromSchemaDefinition,
    type GenericMutationCtx,
    type GenericQueryCtx,
} from 'convex/server';
import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import {
    buildProfileFieldDocument,
    buildProfileFormDocument,
    buildProfileSubmissionDocument,
    buildProfileSubmissionReviewDocument,
    buildSubmissionReviewPatch,
    normalizeProfileBuilderLimit,
    normalizeRequiredFieldKey,
    normalizeRequiredFormId,
    normalizeRequiredFormName,
    normalizeRequiredGuildId,
    normalizeRequiredSubmissionId,
    toProfileFieldRecord,
    toProfileFormRecord,
    toProfileSubmissionRecord,
    toProfileSubmissionReviewRecord,
    type ProfileFieldDocument,
    type ProfileFormDocument,
    type ProfileSubmissionDocument,
} from './profile_builder_model.js';
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type ProfileBuilderQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type ProfileBuilderMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredProfileFormDocument = ProfileFormDocument & { _id: GenericId<'profileForms'> };
type StoredProfileFieldDocument = ProfileFieldDocument & { _id: GenericId<'profileFields'> };
type StoredProfileSubmissionDocument = ProfileSubmissionDocument & { _id: GenericId<'profileSubmissions'> };

const allowedProfileBuilderServices = ['bot', 'web'] as const;
const nullableString = v.union(v.string(), v.null());
const formRecordValidator = v.object({
    approvalRequired: v.boolean(),
    config: v.any(),
    createdAt: v.string(),
    enabled: v.boolean(),
    guildId: v.string(),
    id: v.string(),
    name: v.string(),
    outputChannelId: nullableString,
    updatedAt: v.string(),
});
const fieldRecordValidator = v.object({
    createdAt: v.string(),
    fieldKey: v.string(),
    fieldType: v.string(),
    formId: v.string(),
    id: v.string(),
    label: v.string(),
    maxLength: v.union(v.number(), v.null()),
    position: v.number(),
    required: v.boolean(),
    updatedAt: v.string(),
});
const submissionRecordValidator = v.object({
    formId: v.string(),
    guildId: v.string(),
    id: v.string(),
    reviewedAt: nullableString,
    status: v.union(v.literal('approved'), v.literal('pending'), v.literal('rejected')),
    submittedAt: v.string(),
    updatedAt: v.string(),
    userId: v.string(),
    values: v.any(),
});
const reviewRecordValidator = v.object({
    createdAt: v.string(),
    decision: v.union(v.literal('approved'), v.literal('rejected')),
    id: v.string(),
    reason: nullableString,
    reviewerUserId: v.string(),
    submissionId: v.string(),
});

export const createProfileForm = mutationGeneric({
    args: {
        approvalRequired: v.optional(v.boolean()),
        config: v.optional(v.any()),
        createdAt: v.optional(v.string()),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        name: v.string(),
        outputChannelId: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    },
    returns: formRecordValidator,
    handler: async (ctx: ProfileBuilderMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);
        if (await findProfileFormByGuildNameDocument(ctx, { guildId, name: args.name })) {
            throw new Error('profile-form-conflict');
        }

        const document = unwrap(
            buildProfileFormDocument({ ...args, guildId }, new Date().toISOString(), undefined, () =>
                crypto.randomUUID()
            )
        );

        await ctx.db.insert('profileForms', document);

        return toProfileFormRecord(document);
    },
});

export const upsertProfileForm = mutationGeneric({
    args: {
        approvalRequired: v.optional(v.boolean()),
        config: v.optional(v.any()),
        createdAt: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        name: v.string(),
        outputChannelId: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    },
    returns: formRecordValidator,
    handler: async (ctx: ProfileBuilderMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const existingForm = await findProfileFormByGuildNameDocument(ctx, { guildId, name: args.name });
        const document = unwrap(
            buildProfileFormDocument({ ...args, guildId }, new Date().toISOString(), existingForm ?? undefined)
        );

        if (existingForm) {
            await ctx.db.patch(existingForm._id, toProfileFormPatch(document));
        } else {
            await ctx.db.insert('profileForms', document);
        }

        return toProfileFormRecord(document);
    },
});

export const listProfileFormsByGuildId = queryGeneric({
    args: { enabledOnly: v.optional(v.boolean()), guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(formRecordValidator),
    handler: async (ctx: ProfileBuilderQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const forms = args.enabledOnly
            ? await ctx.db
                  .query('profileForms')
                  .withIndex('by_guild_enabled_name', (query) => query.eq('guildId', guildId).eq('enabled', true))
                  .order('asc')
                  .take(normalizeProfileBuilderLimit(args.limit, 100))
            : await ctx.db
                  .query('profileForms')
                  .withIndex('by_guild_name', (query) => query.eq('guildId', guildId))
                  .order('asc')
                  .take(normalizeProfileBuilderLimit(args.limit, 100));

        return forms.map(toProfileFormRecord);
    },
});

export const findProfileFormByGuildName = queryGeneric({
    args: { enabledOnly: v.optional(v.boolean()), guildId: v.string(), name: v.string() },
    returns: v.union(formRecordValidator, v.null()),
    handler: async (ctx: ProfileBuilderQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const form = await findProfileFormByGuildNameDocument(ctx, { guildId, name: args.name });

        return form && (!args.enabledOnly || form.enabled) ? toProfileFormRecord(form) : null;
    },
});

export const findProfileFormById = queryGeneric({
    args: { enabledOnly: v.optional(v.boolean()), formId: v.string(), guildId: v.string() },
    returns: v.union(formRecordValidator, v.null()),
    handler: async (ctx: ProfileBuilderQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const formId = unwrap(normalizeRequiredFormId(args.formId));
        const form = await findProfileFormByLegacyId(ctx, formId);

        if (form?.guildId !== guildId) return null;
        if (args.enabledOnly && !form.enabled) return null;

        return toProfileFormRecord(form);
    },
});

export const upsertProfileField = mutationGeneric({
    args: {
        createdAt: v.optional(v.string()),
        fieldKey: v.string(),
        fieldType: v.string(),
        formId: v.string(),
        label: v.string(),
        legacyId: v.optional(v.string()),
        maxLength: v.optional(v.number()),
        position: v.optional(v.number()),
        required: v.optional(v.boolean()),
        updatedAt: v.optional(v.string()),
    },
    returns: fieldRecordValidator,
    handler: async (ctx: ProfileBuilderMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const formId = unwrap(normalizeRequiredFormId(args.formId));

        await requireProfileForm(ctx, formId);

        const existingField = await findProfileFieldByFormKey(ctx, { fieldKey: args.fieldKey, formId });
        const document = unwrap(
            buildProfileFieldDocument({ ...args, formId }, new Date().toISOString(), existingField ?? undefined)
        );

        if (existingField) {
            await ctx.db.patch(existingField._id, toProfileFieldPatch(document));
        } else {
            await ctx.db.insert('profileFields', document);
        }

        return toProfileFieldRecord(document);
    },
});

export const listProfileFieldsByFormId = queryGeneric({
    args: { formId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(fieldRecordValidator),
    handler: async (ctx: ProfileBuilderQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const formId = unwrap(normalizeRequiredFormId(args.formId));
        const fields = await ctx.db
            .query('profileFields')
            .withIndex('by_form_position_label', (query) => query.eq('formLegacyId', formId))
            .order('asc')
            .take(normalizeProfileBuilderLimit(args.limit, 100));

        return fields.map(toProfileFieldRecord);
    },
});

export const deleteProfileField = mutationGeneric({
    args: { fieldKey: v.string(), formId: v.string() },
    returns: v.union(fieldRecordValidator, v.null()),
    handler: async (ctx: ProfileBuilderMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const formId = unwrap(normalizeRequiredFormId(args.formId));
        const fieldKey = unwrap(normalizeRequiredFieldKey(args.fieldKey));
        const field = await findProfileFieldByFormKey(ctx, { fieldKey, formId });

        if (!field) return null;

        await ctx.db.delete(field._id);

        return toProfileFieldRecord(field);
    },
});

export const createProfileSubmission = mutationGeneric({
    args: {
        formId: v.string(),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        reviewedAt: v.optional(v.string()),
        status: v.optional(v.string()),
        submittedAt: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
        userId: v.string(),
        values: v.optional(v.any()),
    },
    returns: submissionRecordValidator,
    handler: async (ctx: ProfileBuilderMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const formId = unwrap(normalizeRequiredFormId(args.formId));
        const form = await findProfileFormByLegacyId(ctx, formId);

        if (form?.guildId !== guildId || !form.enabled) throw new Error('profile-form-not-found');

        const document = unwrap(
            buildProfileSubmissionDocument({ ...args, formId, guildId }, new Date().toISOString(), () =>
                crypto.randomUUID()
            )
        );

        await ctx.db.insert('profileSubmissions', document);

        return toProfileSubmissionRecord(document);
    },
});

export const listProfileSubmissionsByGuildId = queryGeneric({
    args: { guildId: v.string(), limit: v.optional(v.number()), status: v.optional(v.string()) },
    returns: v.array(submissionRecordValidator),
    handler: async (ctx: ProfileBuilderQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const limit = normalizeProfileBuilderLimit(args.limit);
        const status = args.status ? normalizeSubmissionStatusArg(args.status) : undefined;

        if (args.status && !status) return [];

        const submissions = status
            ? await ctx.db
                  .query('profileSubmissions')
                  .withIndex('by_guild_status_submitted', (query) => query.eq('guildId', guildId).eq('status', status))
                  .order('desc')
                  .take(limit)
            : await ctx.db
                  .query('profileSubmissions')
                  .withIndex('by_guild_submitted', (query) => query.eq('guildId', guildId))
                  .order('desc')
                  .take(limit);

        return submissions.map(toProfileSubmissionRecord);
    },
});

export const findProfileSubmissionById = queryGeneric({
    args: { guildId: v.string(), submissionId: v.string() },
    returns: v.union(submissionRecordValidator, v.null()),
    handler: async (ctx: ProfileBuilderQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const submissionId = unwrap(normalizeRequiredSubmissionId(args.submissionId));
        const submission = await findProfileSubmissionByLegacyId(ctx, submissionId);

        return submission?.guildId === guildId ? toProfileSubmissionRecord(submission) : null;
    },
});

export const reviewProfileSubmission = mutationGeneric({
    args: {
        createdAt: v.optional(v.string()),
        decision: v.string(),
        guildId: v.optional(v.string()),
        legacyId: v.optional(v.string()),
        reason: v.optional(v.string()),
        reviewerUserId: v.string(),
        submissionId: v.string(),
    },
    returns: reviewRecordValidator,
    handler: async (ctx: ProfileBuilderMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const submissionId = unwrap(normalizeRequiredSubmissionId(args.submissionId));
        const submission = await findProfileSubmissionByLegacyId(ctx, submissionId);

        if (!submission || (args.guildId && submission.guildId !== args.guildId.trim())) {
            throw new Error('profile-submission-not-found');
        }

        const review = unwrap(
            buildProfileSubmissionReviewDocument({ ...args, submissionId }, new Date().toISOString(), () =>
                crypto.randomUUID()
            )
        );
        const patch = unwrap(buildSubmissionReviewPatch(submission.status, review.decision, new Date().toISOString()));

        await ctx.db.patch(submission._id, patch);
        await ctx.db.insert('profileSubmissionReviews', review);

        return toProfileSubmissionReviewRecord(review);
    },
});

function toProfileFormPatch(document: ProfileFormDocument) {
    return {
        approvalRequired: document.approvalRequired,
        config: document.config,
        enabled: document.enabled,
        outputChannelId: document.outputChannelId,
        updatedAt: document.updatedAt,
    };
}

function toProfileFieldPatch(document: ProfileFieldDocument) {
    return {
        fieldType: document.fieldType,
        label: document.label,
        maxLength: document.maxLength,
        position: document.position,
        required: document.required,
        updatedAt: document.updatedAt,
    };
}

async function findProfileFormByGuildNameDocument(
    ctx: ProfileBuilderQueryCtx | ProfileBuilderMutationCtx,
    input: { guildId: string; name: string }
): Promise<StoredProfileFormDocument | null> {
    const name = unwrap(normalizeRequiredFormName(input.name));

    return await ctx.db
        .query('profileForms')
        .withIndex('by_guild_name', (query) => query.eq('guildId', input.guildId).eq('name', name))
        .unique();
}

async function findProfileFormByLegacyId(
    ctx: ProfileBuilderQueryCtx | ProfileBuilderMutationCtx,
    formId: string
): Promise<StoredProfileFormDocument | null> {
    return await ctx.db
        .query('profileForms')
        .withIndex('by_legacy', (query) => query.eq('legacyId', formId.trim()))
        .unique();
}

async function findProfileFieldByFormKey(
    ctx: ProfileBuilderQueryCtx | ProfileBuilderMutationCtx,
    input: { fieldKey: string; formId: string }
): Promise<StoredProfileFieldDocument | null> {
    return await ctx.db
        .query('profileFields')
        .withIndex('by_form_key', (query) =>
            query.eq('formLegacyId', input.formId).eq('fieldKey', input.fieldKey.trim())
        )
        .unique();
}

async function findProfileSubmissionByLegacyId(
    ctx: ProfileBuilderQueryCtx | ProfileBuilderMutationCtx,
    submissionId: string
): Promise<StoredProfileSubmissionDocument | null> {
    return await ctx.db
        .query('profileSubmissions')
        .withIndex('by_legacy', (query) => query.eq('legacyId', submissionId.trim()))
        .unique();
}

async function requireProfileForm(ctx: ProfileBuilderMutationCtx, formId: string): Promise<StoredProfileFormDocument> {
    const form = await findProfileFormByLegacyId(ctx, formId);

    if (!form) throw new Error('profile-form-not-found');

    return form;
}

async function requireGuildDocument(ctx: ProfileBuilderMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) throw new Error('guild-not-found');

    return guild;
}

function normalizeSubmissionStatusArg(status: string): 'approved' | 'pending' | 'rejected' | undefined {
    const normalized = status.trim();

    if (normalized === 'approved' || normalized === 'pending' || normalized === 'rejected') return normalized;

    return undefined;
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) {
        const error = result.error;

        if (typeof error === 'object' && error !== null && 'type' in error) {
            throw new Error(String(error.type));
        }

        throw new Error(String(error));
    }

    return result.value;
}

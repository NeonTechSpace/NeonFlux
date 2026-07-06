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
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
type ProfileBuilderQueryCtx = QueryCtx;
type ProfileBuilderMutationCtx = MutationCtx;

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

export const createProfileForm = mutation({
    args: {
        approvalRequired: v.optional(v.boolean()),
        config: v.optional(v.any()),
        createdAt: v.optional(v.string()),
        guildId: v.string(),
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

        const document = unwrap(buildProfileFormDocument({ ...args, guildId }, new Date().toISOString()));

        const id = await ctx.db.insert('profileForms', document);

        return toProfileFormRecord({ ...document, _id: id });
    },
});

export const upsertProfileForm = mutation({
    args: {
        approvalRequired: v.optional(v.boolean()),
        config: v.optional(v.any()),
        createdAt: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        guildId: v.string(),
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
            return toProfileFormRecord({ ...document, _id: existingForm._id });
        } else {
            const id = await ctx.db.insert('profileForms', document);
            return toProfileFormRecord({ ...document, _id: id });
        }
    },
});

export const listProfileFormsByGuildId = query({
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

export const findProfileFormByGuildName = query({
    args: { enabledOnly: v.optional(v.boolean()), guildId: v.string(), name: v.string() },
    returns: v.union(formRecordValidator, v.null()),
    handler: async (ctx: ProfileBuilderQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const form = await findProfileFormByGuildNameDocument(ctx, { guildId, name: args.name });

        return form && (!args.enabledOnly || form.enabled) ? toProfileFormRecord(form) : null;
    },
});

export const findProfileFormById = query({
    args: { enabledOnly: v.optional(v.boolean()), formId: v.string(), guildId: v.string() },
    returns: v.union(formRecordValidator, v.null()),
    handler: async (ctx: ProfileBuilderQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const formId = parseProfileFormId(args.formId);
        const form = await findProfileFormByIdDocument(ctx, formId);

        if (form?.guildId !== guildId) return null;
        if (args.enabledOnly && !form.enabled) return null;

        return toProfileFormRecord(form);
    },
});

export const upsertProfileField = mutation({
    args: {
        createdAt: v.optional(v.string()),
        fieldKey: v.string(),
        fieldType: v.string(),
        formId: v.string(),
        label: v.string(),
        maxLength: v.optional(v.number()),
        position: v.optional(v.number()),
        required: v.optional(v.boolean()),
        updatedAt: v.optional(v.string()),
    },
    returns: fieldRecordValidator,
    handler: async (ctx: ProfileBuilderMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const formId = unwrap(normalizeRequiredFormId(args.formId));

        await requireProfileForm(ctx, parseProfileFormId(formId));

        const existingField = await findProfileFieldByFormKey(ctx, { fieldKey: args.fieldKey, formId });
        const document = unwrap(
            buildProfileFieldDocument({ ...args, formId }, new Date().toISOString(), existingField ?? undefined)
        );

        if (existingField) {
            await ctx.db.patch(existingField._id, toProfileFieldPatch(document));
            return toProfileFieldRecord({ ...document, _id: existingField._id });
        } else {
            const id = await ctx.db.insert('profileFields', document);
            return toProfileFieldRecord({ ...document, _id: id });
        }
    },
});

export const listProfileFieldsByFormId = query({
    args: { formId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(fieldRecordValidator),
    handler: async (ctx: ProfileBuilderQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const formId = unwrap(normalizeRequiredFormId(args.formId));
        const fields = await ctx.db
            .query('profileFields')
            .withIndex('by_form_position_label', (query) => query.eq('formId', parseProfileFormId(formId)))
            .order('asc')
            .take(normalizeProfileBuilderLimit(args.limit, 100));

        return fields.map(toProfileFieldRecord);
    },
});

export const deleteProfileField = mutation({
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

export const createProfileSubmission = mutation({
    args: {
        formId: v.string(),
        guildId: v.string(),
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
        const formId = parseProfileFormId(args.formId);
        const form = await findProfileFormByIdDocument(ctx, formId);

        if (form?.guildId !== guildId || !form.enabled) throw new Error('profile-form-not-found');

        const document = unwrap(buildProfileSubmissionDocument({ ...args, formId, guildId }, new Date().toISOString()));

        const id = await ctx.db.insert('profileSubmissions', document);

        return toProfileSubmissionRecord({ ...document, _id: id });
    },
});

export const listProfileSubmissionsByGuildId = query({
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

export const findProfileSubmissionById = query({
    args: { guildId: v.string(), submissionId: v.string() },
    returns: v.union(submissionRecordValidator, v.null()),
    handler: async (ctx: ProfileBuilderQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const submissionId = parseProfileSubmissionId(args.submissionId);
        const submission = await findProfileSubmissionByIdDocument(ctx, submissionId);

        return submission?.guildId === guildId ? toProfileSubmissionRecord(submission) : null;
    },
});

export const reviewProfileSubmission = mutation({
    args: {
        createdAt: v.optional(v.string()),
        decision: v.string(),
        guildId: v.optional(v.string()),
        reason: v.optional(v.string()),
        reviewerUserId: v.string(),
        submissionId: v.string(),
    },
    returns: reviewRecordValidator,
    handler: async (ctx: ProfileBuilderMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedProfileBuilderServices);
        const submissionId = parseProfileSubmissionId(args.submissionId);
        const submission = await findProfileSubmissionByIdDocument(ctx, submissionId);

        if (!submission || (args.guildId && submission.guildId !== args.guildId.trim())) {
            throw new Error('profile-submission-not-found');
        }

        const review = unwrap(
            buildProfileSubmissionReviewDocument({ ...args, submissionId }, new Date().toISOString())
        );
        const patch = unwrap(buildSubmissionReviewPatch(submission.status, review.decision, new Date().toISOString()));

        await ctx.db.patch(submission._id, patch);
        const reviewId = await ctx.db.insert('profileSubmissionReviews', review);

        return toProfileSubmissionReviewRecord({ ...review, _id: reviewId });
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

async function findProfileFormByIdDocument(
    ctx: ProfileBuilderQueryCtx | ProfileBuilderMutationCtx,
    formId: GenericId<'profileForms'>
): Promise<StoredProfileFormDocument | null> {
    return await ctx.db.get(formId);
}

async function findProfileFieldByFormKey(
    ctx: ProfileBuilderQueryCtx | ProfileBuilderMutationCtx,
    input: { fieldKey: string; formId: string }
): Promise<StoredProfileFieldDocument | null> {
    return await ctx.db
        .query('profileFields')
        .withIndex('by_form_key', (query) =>
            query.eq('formId', parseProfileFormId(input.formId)).eq('fieldKey', input.fieldKey.trim())
        )
        .unique();
}

async function findProfileSubmissionByIdDocument(
    ctx: ProfileBuilderQueryCtx | ProfileBuilderMutationCtx,
    submissionId: GenericId<'profileSubmissions'>
): Promise<StoredProfileSubmissionDocument | null> {
    return await ctx.db.get(submissionId);
}

async function requireProfileForm(
    ctx: ProfileBuilderMutationCtx,
    formId: GenericId<'profileForms'>
): Promise<StoredProfileFormDocument> {
    const form = await findProfileFormByIdDocument(ctx, formId);

    if (!form) throw new Error('profile-form-not-found');

    return form;
}

function parseProfileFormId(formId: string): GenericId<'profileForms'> {
    return unwrap(normalizeRequiredFormId(formId)) as GenericId<'profileForms'>;
}

function parseProfileSubmissionId(submissionId: string): GenericId<'profileSubmissions'> {
    return unwrap(normalizeRequiredSubmissionId(submissionId)) as GenericId<'profileSubmissions'>;
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

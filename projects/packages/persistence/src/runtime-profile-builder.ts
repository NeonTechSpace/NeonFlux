import { api } from '@neonflux/convex/api';
import {
    createProfileSubmission as createProfileSubmissionPostgres,
    deleteProfileField as deleteProfileFieldPostgres,
    findProfileFormByGuildName as findProfileFormByGuildNamePostgres,
    findProfileSubmissionById as findProfileSubmissionByIdPostgres,
    listProfileFieldsByFormId as listProfileFieldsByFormIdPostgres,
    listProfileFormsByGuildId as listProfileFormsByGuildIdPostgres,
    listProfileSubmissionsByGuildId as listProfileSubmissionsByGuildIdPostgres,
    reviewProfileSubmission as reviewProfileSubmissionPostgres,
    upsertProfileField as upsertProfileFieldPostgres,
    upsertProfileForm as upsertProfileFormPostgres,
    type ProfileBuilderRepositoryError,
    type ProfileFieldRecord,
    type ProfileFormRecord,
    type ProfileSubmissionRecord,
    type ProfileSubmissionReviewRecord,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { isConvexPersistenceDatabase, type ConvexPersistenceDatabase } from './convex.js';
import {
    mapProfileBuilderConvexError,
    normalizeListLimit,
    normalizeNonNegativeInteger,
    normalizeOptionalText,
    normalizeRequiredText,
    normalizeReviewDecision,
    normalizeSubmissionCreateStatus,
    toProfileFieldRecord,
    toProfileFormRecord,
    toProfileSubmissionRecord,
    toProfileSubmissionReviewRecord,
    type ConvexProfileFieldRecord,
    type ConvexProfileFormRecord,
    type ConvexProfileSubmissionRecord,
    type ConvexProfileSubmissionReviewRecord,
} from './runtime-profile-builder-records.js';

type ConvexQueryReference = Parameters<ConvexPersistenceDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexPersistenceDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    profile_builder: {
        createProfileSubmission: ConvexMutationReference;
        deleteProfileField: ConvexMutationReference;
        findProfileFormByGuildName: ConvexQueryReference;
        findProfileSubmissionById: ConvexQueryReference;
        listProfileFieldsByFormId: ConvexQueryReference;
        listProfileFormsByGuildId: ConvexQueryReference;
        listProfileSubmissionsByGuildId: ConvexQueryReference;
        reviewProfileSubmission: ConvexMutationReference;
        upsertProfileField: ConvexMutationReference;
        upsertProfileForm: ConvexMutationReference;
    };
};

type PostgresProfileBuilderDb = Parameters<typeof upsertProfileFormPostgres>[0];
type ProfileBuilderDb = ConvexPersistenceDatabase | PostgresProfileBuilderDb;

const submissionStatusTransitions = new Map<string, readonly string[]>([
    ['pending', ['approved', 'rejected']],
    ['approved', []],
    ['rejected', []],
]);

export async function upsertProfileForm(
    db: ProfileBuilderDb,
    input: {
        approvalRequired?: boolean;
        config?: Record<string, unknown>;
        enabled?: boolean;
        guildId: string;
        name: string;
        outputChannelId?: string;
    }
): Promise<Result<ProfileFormRecord, ProfileBuilderRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return upsertProfileFormPostgres(db, input);

    const normalizedInput = normalizeFormInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const form = (await db.client.mutation(convexApi.profile_builder.upsertProfileForm, {
            ...normalizedInput.value,
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        })) as ConvexProfileFormRecord;

        return ok(toProfileFormRecord(form));
    } catch (error) {
        return err(mapProfileBuilderConvexError(error));
    }
}

export async function listProfileFormsByGuildId(
    db: ProfileBuilderDb,
    input: { enabledOnly?: boolean; guildId: string }
): Promise<Result<ProfileFormRecord[], ProfileBuilderRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listProfileFormsByGuildIdPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const forms = (await db.client.query(convexApi.profile_builder.listProfileFormsByGuildId, {
            ...(input.enabledOnly === undefined ? {} : { enabledOnly: input.enabledOnly }),
            guildId: guildId.value,
            limit: 100,
        })) as ConvexProfileFormRecord[];

        return ok(forms.map(toProfileFormRecord));
    } catch (error) {
        return err(mapProfileBuilderConvexError(error));
    }
}

export async function findProfileFormByGuildName(
    db: ProfileBuilderDb,
    input: { enabledOnly?: boolean; guildId: string; name: string }
): Promise<Result<ProfileFormRecord, ProfileBuilderRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return findProfileFormByGuildNamePostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const name = normalizeRequiredText(input.name, 'name');

    if (guildId.isErr()) return err(guildId.error);
    if (name.isErr()) return err(name.error);

    try {
        const form = (await db.client.query(convexApi.profile_builder.findProfileFormByGuildName, {
            ...(input.enabledOnly === undefined ? {} : { enabledOnly: input.enabledOnly }),
            guildId: guildId.value,
            name: name.value,
        })) as ConvexProfileFormRecord | null;

        return form ? ok(toProfileFormRecord(form)) : err({ type: 'not-found' });
    } catch (error) {
        return err(mapProfileBuilderConvexError(error));
    }
}

export async function upsertProfileField(
    db: ProfileBuilderDb,
    input: {
        fieldKey: string;
        fieldType: string;
        formId: string;
        label: string;
        maxLength?: number | null;
        position?: number;
        required?: boolean;
    }
): Promise<Result<ProfileFieldRecord, ProfileBuilderRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return upsertProfileFieldPostgres(db, input);

    const normalizedInput = normalizeFieldInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const field = (await db.client.mutation(
            convexApi.profile_builder.upsertProfileField,
            normalizedInput.value
        )) as ConvexProfileFieldRecord;

        return ok(toProfileFieldRecord(field));
    } catch (error) {
        return err(mapProfileBuilderConvexError(error));
    }
}

export async function listProfileFieldsByFormId(
    db: ProfileBuilderDb,
    input: { formId: string }
): Promise<Result<ProfileFieldRecord[], ProfileBuilderRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listProfileFieldsByFormIdPostgres(db, input);

    const formId = normalizeRequiredText(input.formId, 'formId');
    if (formId.isErr()) return err(formId.error);

    try {
        const fields = (await db.client.query(convexApi.profile_builder.listProfileFieldsByFormId, {
            formId: formId.value,
            limit: 100,
        })) as ConvexProfileFieldRecord[];

        return ok(fields.map(toProfileFieldRecord));
    } catch (error) {
        return err(mapProfileBuilderConvexError(error));
    }
}

export async function deleteProfileField(
    db: ProfileBuilderDb,
    input: { fieldKey: string; formId: string }
): Promise<Result<ProfileFieldRecord, ProfileBuilderRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return deleteProfileFieldPostgres(db, input);

    const fieldKey = normalizeRequiredText(input.fieldKey, 'fieldKey');
    const formId = normalizeRequiredText(input.formId, 'formId');

    if (fieldKey.isErr()) return err(fieldKey.error);
    if (formId.isErr()) return err(formId.error);

    try {
        const field = (await db.client.mutation(convexApi.profile_builder.deleteProfileField, {
            fieldKey: fieldKey.value,
            formId: formId.value,
        })) as ConvexProfileFieldRecord | null;

        return field ? ok(toProfileFieldRecord(field)) : err({ type: 'not-found' });
    } catch (error) {
        return err(mapProfileBuilderConvexError(error));
    }
}

export async function createProfileSubmission(
    db: ProfileBuilderDb,
    input: { formId: string; guildId: string; status?: string; userId: string; values?: Record<string, unknown> }
): Promise<Result<ProfileSubmissionRecord, ProfileBuilderRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return createProfileSubmissionPostgres(db, input);

    const normalizedInput = normalizeSubmissionInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const submission = (await db.client.mutation(
            convexApi.profile_builder.createProfileSubmission,
            normalizedInput.value
        )) as ConvexProfileSubmissionRecord;

        return ok(toProfileSubmissionRecord(submission));
    } catch (error) {
        return err(mapProfileBuilderConvexError(error));
    }
}

export async function listProfileSubmissionsByGuildId(
    db: ProfileBuilderDb,
    input: { guildId: string; limit?: number; status?: string }
): Promise<Result<ProfileSubmissionRecord[], ProfileBuilderRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listProfileSubmissionsByGuildIdPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const submissions = (await db.client.query(convexApi.profile_builder.listProfileSubmissionsByGuildId, {
            guildId: guildId.value,
            limit: normalizeListLimit(input.limit),
            ...(input.status === undefined ? {} : { status: input.status }),
        })) as ConvexProfileSubmissionRecord[];

        return ok(submissions.map(toProfileSubmissionRecord));
    } catch (error) {
        return err(mapProfileBuilderConvexError(error));
    }
}

export async function findProfileSubmissionById(
    db: ProfileBuilderDb,
    input: { guildId: string; submissionId: string }
): Promise<Result<ProfileSubmissionRecord, ProfileBuilderRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return findProfileSubmissionByIdPostgres(db, input);

    const normalizedInput = normalizeSubmissionLookupInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const submission = (await db.client.query(
            convexApi.profile_builder.findProfileSubmissionById,
            normalizedInput.value
        )) as ConvexProfileSubmissionRecord | null;

        return submission ? ok(toProfileSubmissionRecord(submission)) : err({ type: 'not-found' });
    } catch (error) {
        return err(mapProfileBuilderConvexError(error));
    }
}

export async function reviewProfileSubmission(
    db: ProfileBuilderDb,
    input: { decision: string; guildId?: string; reason?: string; reviewerUserId: string; submissionId: string }
): Promise<Result<ProfileSubmissionReviewRecord, ProfileBuilderRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return reviewProfileSubmissionPostgres(db, input);

    const normalizedInput = normalizeReviewInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    const scopedSubmission = input.guildId
        ? await findProfileSubmissionById(db, { guildId: input.guildId, submissionId: input.submissionId })
        : undefined;
    if (scopedSubmission) {
        if (scopedSubmission.isErr()) return err(scopedSubmission.error);

        const transition = assertAllowedStatusTransition(
            scopedSubmission._unsafeUnwrap().status,
            normalizedInput.value.decision
        );
        if (transition.isErr()) return err(transition.error);
    }

    try {
        const review = (await db.client.mutation(
            convexApi.profile_builder.reviewProfileSubmission,
            normalizedInput.value
        )) as ConvexProfileSubmissionReviewRecord;

        return ok(toProfileSubmissionReviewRecord(review));
    } catch (error) {
        return err(mapProfileBuilderConvexError(error));
    }
}

function normalizeFormInput(input: {
    approvalRequired?: boolean;
    config?: Record<string, unknown>;
    guildId: string;
    name: string;
    outputChannelId?: string;
}): Result<Record<string, unknown>, ProfileBuilderRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const name = normalizeRequiredText(input.name, 'name');
    const outputChannelId = normalizeOptionalText(input.outputChannelId);

    if (guildId.isErr()) return err(guildId.error);
    if (name.isErr()) return err(name.error);

    return ok({
        ...(input.approvalRequired === undefined ? {} : { approvalRequired: input.approvalRequired }),
        config: input.config ?? {},
        guildId: guildId.value,
        name: name.value,
        ...(outputChannelId ? { outputChannelId } : {}),
    });
}

function normalizeFieldInput(input: {
    fieldKey: string;
    fieldType: string;
    formId: string;
    label: string;
    maxLength?: number | null;
    position?: number;
    required?: boolean;
}): Result<Record<string, unknown>, ProfileBuilderRepositoryError> {
    const formId = normalizeRequiredText(input.formId, 'formId');
    const fieldKey = normalizeRequiredText(input.fieldKey, 'fieldKey');
    const label = normalizeRequiredText(input.label, 'label');
    const fieldType = normalizeRequiredText(input.fieldType, 'fieldType');
    const position = normalizeNonNegativeInteger(input.position ?? 0, 'position');

    if (formId.isErr()) return err(formId.error);
    if (fieldKey.isErr()) return err(fieldKey.error);
    if (label.isErr()) return err(label.error);
    if (fieldType.isErr()) return err(fieldType.error);
    if (position.isErr()) return err(position.error);

    return ok({
        fieldKey: fieldKey.value,
        fieldType: fieldType.value,
        formId: formId.value,
        label: label.value,
        ...(input.maxLength === null || input.maxLength === undefined ? {} : { maxLength: input.maxLength }),
        position: position.value,
        ...(input.required === undefined ? {} : { required: input.required }),
    });
}

function normalizeSubmissionInput(input: {
    formId: string;
    guildId: string;
    status?: string;
    userId: string;
    values?: Record<string, unknown>;
}): Result<Record<string, unknown>, ProfileBuilderRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const formId = normalizeRequiredText(input.formId, 'formId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const status = normalizeSubmissionCreateStatus(input.status);

    if (guildId.isErr()) return err(guildId.error);
    if (formId.isErr()) return err(formId.error);
    if (userId.isErr()) return err(userId.error);
    if (status.isErr()) return err(status.error);

    return ok({
        formId: formId.value,
        guildId: guildId.value,
        status: status.value,
        userId: userId.value,
        values: input.values ?? {},
    });
}

function normalizeSubmissionLookupInput(input: {
    guildId: string;
    submissionId: string;
}): Result<{ guildId: string; submissionId: string }, ProfileBuilderRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const submissionId = normalizeRequiredText(input.submissionId, 'submissionId');

    if (guildId.isErr()) return err(guildId.error);
    if (submissionId.isErr()) return err(submissionId.error);

    return ok({ guildId: guildId.value, submissionId: submissionId.value });
}

function normalizeReviewInput(input: {
    decision: string;
    guildId?: string;
    reason?: string;
    reviewerUserId: string;
    submissionId: string;
}): Result<Record<string, unknown> & { decision: 'approved' | 'rejected' }, ProfileBuilderRepositoryError> {
    const submissionId = normalizeRequiredText(input.submissionId, 'submissionId');
    const reviewerUserId = normalizeRequiredText(input.reviewerUserId, 'reviewerUserId');
    const decision = normalizeReviewDecision(input.decision);
    const guildId = normalizeOptionalText(input.guildId);
    const reason = normalizeOptionalText(input.reason);

    if (submissionId.isErr()) return err(submissionId.error);
    if (reviewerUserId.isErr()) return err(reviewerUserId.error);
    if (decision.isErr()) return err(decision.error);

    return ok({
        decision: decision.value,
        ...(guildId ? { guildId } : {}),
        ...(reason ? { reason } : {}),
        reviewerUserId: reviewerUserId.value,
        submissionId: submissionId.value,
    });
}

function assertAllowedStatusTransition(from: string, to: string): Result<void, ProfileBuilderRepositoryError> {
    if (from === to) return ok(undefined);
    if (!submissionStatusTransitions.get(from)?.includes(to)) {
        return err({ from, to, type: 'invalid-status-transition' });
    }

    return ok(undefined);
}

import { and, asc, desc, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    assertAllowedStatusTransition,
    normalizeNonNegativeInteger,
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { profileFields, profileForms, profileSubmissionReviews, profileSubmissions } from './schema.js';

export type ProfileFormRecord = typeof profileForms.$inferSelect;
export type ProfileFieldRecord = typeof profileFields.$inferSelect;
export type ProfileSubmissionRecord = typeof profileSubmissions.$inferSelect;
export type ProfileSubmissionReviewRecord = typeof profileSubmissionReviews.$inferSelect;
export type ProfileBuilderRepositoryError = GuildFeatureRepositoryError;

const submissionStatusTransitions = new Map<string, readonly string[]>([
    ['pending', ['approved', 'rejected']],
    ['approved', []],
    ['rejected', []],
]);

export async function createProfileForm(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        name: string;
        approvalRequired?: boolean;
        outputChannelId?: string;
        config?: Record<string, unknown>;
    }
): Promise<Result<ProfileFormRecord, ProfileBuilderRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const name = normalizeRequiredText(input.name, 'name');

    if (guildId.isErr()) return err(guildId.error);
    if (name.isErr()) return err(name.error);

    try {
        const rows = await db
            .insert(profileForms)
            .values({
                guildId: guildId.value,
                name: name.value,
                approvalRequired: input.approvalRequired ?? true,
                outputChannelId: normalizeOptionalText(input.outputChannelId),
                config: input.config ?? {},
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertProfileForm(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        name: string;
        approvalRequired?: boolean;
        outputChannelId?: string;
        enabled?: boolean;
        config?: Record<string, unknown>;
    }
): Promise<Result<ProfileFormRecord, ProfileBuilderRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const name = normalizeRequiredText(input.name, 'name');
    const updatedAt = new Date();

    if (guildId.isErr()) return err(guildId.error);
    if (name.isErr()) return err(name.error);

    try {
        const rows = await db
            .insert(profileForms)
            .values({
                guildId: guildId.value,
                name: name.value,
                approvalRequired: input.approvalRequired ?? true,
                outputChannelId: normalizeOptionalText(input.outputChannelId),
                enabled: input.enabled ?? true,
                config: input.config ?? {},
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [profileForms.guildId, profileForms.name],
                set: {
                    approvalRequired: input.approvalRequired ?? true,
                    outputChannelId: normalizeOptionalText(input.outputChannelId),
                    enabled: input.enabled ?? true,
                    config: input.config ?? {},
                    updatedAt,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listProfileFormsByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; enabledOnly?: boolean }
): Promise<Result<ProfileFormRecord[], ProfileBuilderRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .select()
            .from(profileForms)
            .where(
                input.enabledOnly
                    ? and(eq(profileForms.guildId, guildId.value), eq(profileForms.enabled, true))
                    : eq(profileForms.guildId, guildId.value)
            )
            .orderBy(asc(profileForms.name));

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findProfileFormByGuildName(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; name: string; enabledOnly?: boolean }
): Promise<Result<ProfileFormRecord, ProfileBuilderRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const name = normalizeRequiredText(input.name, 'name');

    if (guildId.isErr()) return err(guildId.error);
    if (name.isErr()) return err(name.error);

    try {
        const rows = await db
            .select()
            .from(profileForms)
            .where(
                and(
                    eq(profileForms.guildId, guildId.value),
                    eq(profileForms.name, name.value),
                    ...(input.enabledOnly ? [eq(profileForms.enabled, true)] : [])
                )
            )
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findProfileFormById(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; formId: string; enabledOnly?: boolean }
): Promise<Result<ProfileFormRecord, ProfileBuilderRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const formId = normalizeRequiredText(input.formId, 'formId');

    if (guildId.isErr()) return err(guildId.error);
    if (formId.isErr()) return err(formId.error);

    try {
        const rows = await db
            .select()
            .from(profileForms)
            .where(
                and(
                    eq(profileForms.guildId, guildId.value),
                    eq(profileForms.id, formId.value),
                    ...(input.enabledOnly ? [eq(profileForms.enabled, true)] : [])
                )
            )
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertProfileField(
    db: GuildFeatureRepositoryDatabase,
    input: {
        formId: string;
        fieldKey: string;
        label: string;
        fieldType: string;
        required?: boolean;
        maxLength?: number | null;
        position?: number;
    }
): Promise<Result<ProfileFieldRecord, ProfileBuilderRepositoryError>> {
    const formId = normalizeRequiredText(input.formId, 'formId');
    const fieldKey = normalizeRequiredText(input.fieldKey, 'fieldKey');
    const label = normalizeRequiredText(input.label, 'label');
    const fieldType = normalizeRequiredText(input.fieldType, 'fieldType');
    const position = normalizeNonNegativeInteger(input.position ?? 0, 'position');
    const updatedAt = new Date();

    if (formId.isErr()) return err(formId.error);
    if (fieldKey.isErr()) return err(fieldKey.error);
    if (label.isErr()) return err(label.error);
    if (fieldType.isErr()) return err(fieldType.error);
    if (position.isErr()) return err(position.error);

    try {
        const rows = await db
            .insert(profileFields)
            .values({
                formId: formId.value,
                fieldKey: fieldKey.value,
                label: label.value,
                fieldType: fieldType.value,
                required: input.required ?? false,
                maxLength: input.maxLength ?? null,
                position: position.value,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [profileFields.formId, profileFields.fieldKey],
                set: {
                    label: label.value,
                    fieldType: fieldType.value,
                    required: input.required ?? false,
                    maxLength: input.maxLength ?? null,
                    position: position.value,
                    updatedAt,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listProfileFieldsByFormId(
    db: GuildFeatureRepositoryDatabase,
    input: { formId: string }
): Promise<Result<ProfileFieldRecord[], ProfileBuilderRepositoryError>> {
    const formId = normalizeRequiredText(input.formId, 'formId');

    if (formId.isErr()) return err(formId.error);

    try {
        const rows = await db
            .select()
            .from(profileFields)
            .where(eq(profileFields.formId, formId.value))
            .orderBy(asc(profileFields.position), asc(profileFields.label));

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteProfileField(
    db: GuildFeatureRepositoryDatabase,
    input: { formId: string; fieldKey: string }
): Promise<Result<ProfileFieldRecord, ProfileBuilderRepositoryError>> {
    const formId = normalizeRequiredText(input.formId, 'formId');
    const fieldKey = normalizeRequiredText(input.fieldKey, 'fieldKey');

    if (formId.isErr()) return err(formId.error);
    if (fieldKey.isErr()) return err(fieldKey.error);

    try {
        const rows = await db
            .delete(profileFields)
            .where(and(eq(profileFields.formId, formId.value), eq(profileFields.fieldKey, fieldKey.value)))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createProfileSubmission(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; formId: string; userId: string; values?: Record<string, unknown>; status?: string }
): Promise<Result<ProfileSubmissionRecord, ProfileBuilderRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const formId = normalizeRequiredText(input.formId, 'formId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const status = input.status ?? 'pending';

    if (guildId.isErr()) return err(guildId.error);
    if (formId.isErr()) return err(formId.error);
    if (userId.isErr()) return err(userId.error);
    if (status !== 'pending' && status !== 'approved') {
        return err({ type: 'invalid-value', field: 'status' });
    }

    try {
        const formRows = await db
            .select({ id: profileForms.id })
            .from(profileForms)
            .where(
                and(
                    eq(profileForms.guildId, guildId.value),
                    eq(profileForms.id, formId.value),
                    eq(profileForms.enabled, true)
                )
            )
            .limit(1);

        if (!formRows[0]) {
            return err({ type: 'not-found' });
        }

        const rows = await db
            .insert(profileSubmissions)
            .values({
                guildId: guildId.value,
                formId: formId.value,
                userId: userId.value,
                status,
                values: input.values ?? {},
                reviewedAt: status === 'approved' ? new Date() : null,
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listProfileSubmissionsByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; status?: string; limit?: number }
): Promise<Result<ProfileSubmissionRecord[], ProfileBuilderRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const status = normalizeOptionalText(input.status);
    const limit = normalizeListLimit(input.limit ?? 25);

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .select()
            .from(profileSubmissions)
            .where(
                status
                    ? and(eq(profileSubmissions.guildId, guildId.value), eq(profileSubmissions.status, status))
                    : eq(profileSubmissions.guildId, guildId.value)
            )
            .orderBy(desc(profileSubmissions.submittedAt))
            .limit(limit);

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findProfileSubmissionById(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; submissionId: string }
): Promise<Result<ProfileSubmissionRecord, ProfileBuilderRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const submissionId = normalizeRequiredText(input.submissionId, 'submissionId');

    if (guildId.isErr()) return err(guildId.error);
    if (submissionId.isErr()) return err(submissionId.error);

    try {
        const rows = await db
            .select()
            .from(profileSubmissions)
            .where(and(eq(profileSubmissions.guildId, guildId.value), eq(profileSubmissions.id, submissionId.value)))
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function reviewProfileSubmission(
    db: GuildFeatureRepositoryDatabase,
    input: { submissionId: string; reviewerUserId: string; decision: string; reason?: string; guildId?: string }
): Promise<Result<ProfileSubmissionReviewRecord, ProfileBuilderRepositoryError>> {
    const submissionId = normalizeRequiredText(input.submissionId, 'submissionId');
    const reviewerUserId = normalizeRequiredText(input.reviewerUserId, 'reviewerUserId');
    const decision = normalizeRequiredText(input.decision, 'decision');

    if (submissionId.isErr()) return err(submissionId.error);
    if (reviewerUserId.isErr()) return err(reviewerUserId.error);
    if (decision.isErr()) return err(decision.error);

    try {
        const submissionRows = await db
            .select()
            .from(profileSubmissions)
            .where(eq(profileSubmissions.id, submissionId.value))
            .limit(1);
        const submission = submissionRows[0];

        if (!submission) {
            return err({ type: 'not-found' });
        }

        if (input.guildId && submission.guildId !== input.guildId.trim()) {
            return err({ type: 'not-found' });
        }

        const transition = assertAllowedStatusTransition(
            submission.status,
            decision.value,
            submissionStatusTransitions
        );

        if (transition.isErr()) {
            return err(transition.error);
        }

        const rows = await db.transaction(async (tx) => {
            await tx
                .update(profileSubmissions)
                .set({
                    status: decision.value,
                    reviewedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(profileSubmissions.id, submissionId.value));

            return tx
                .insert(profileSubmissionReviews)
                .values({
                    submissionId: submissionId.value,
                    reviewerUserId: reviewerUserId.value,
                    decision: decision.value,
                    reason: normalizeOptionalText(input.reason),
                })
                .returning();
        });
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeListLimit(limit: number): number {
    return Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 25;
}

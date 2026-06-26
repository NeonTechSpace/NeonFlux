import { eq } from 'drizzle-orm';
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

export async function createProfileSubmission(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; formId: string; userId: string; values?: Record<string, unknown> }
): Promise<Result<ProfileSubmissionRecord, ProfileBuilderRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const formId = normalizeRequiredText(input.formId, 'formId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (guildId.isErr()) return err(guildId.error);
    if (formId.isErr()) return err(formId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const rows = await db
            .insert(profileSubmissions)
            .values({
                guildId: guildId.value,
                formId: formId.value,
                userId: userId.value,
                values: input.values ?? {},
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function reviewProfileSubmission(
    db: GuildFeatureRepositoryDatabase,
    input: { submissionId: string; reviewerUserId: string; decision: string; reason?: string }
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

        const transition = assertAllowedStatusTransition(
            submission.status,
            decision.value,
            submissionStatusTransitions
        );

        if (transition.isErr()) {
            return err(transition.error);
        }

        await db
            .update(profileSubmissions)
            .set({
                status: decision.value,
                reviewedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(profileSubmissions.id, submissionId.value));

        const rows = await db
            .insert(profileSubmissionReviews)
            .values({
                submissionId: submissionId.value,
                reviewerUserId: reviewerUserId.value,
                decision: decision.value,
                reason: normalizeOptionalText(input.reason),
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

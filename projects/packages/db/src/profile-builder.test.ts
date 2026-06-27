import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { upsertGuild } from './guilds.js';
import {
    createProfileSubmission,
    deleteProfileField,
    findProfileFormByGuildName,
    findProfileFormById,
    findProfileSubmissionById,
    listProfileFieldsByFormId,
    listProfileFormsByGuildId,
    listProfileSubmissionsByGuildId,
    reviewProfileSubmission,
    upsertProfileField,
    upsertProfileForm,
} from './profile-builder.js';
import * as schema from './schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-profile-builder-test');

let testDatabase: TestDatabase | undefined;

describe('profile builder repository', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('upserts, lists, and finds guild-scoped profile forms', async () => {
        const defaultForm = await expectOk(
            upsertProfileForm(getDb(), {
                guildId: 'guild-1',
                name: 'default',
                approvalRequired: true,
                enabled: true,
                config: { intro: 'Tell the server about yourself.' },
            })
        );
        await expectOk(
            upsertProfileForm(getDb(), {
                guildId: 'guild-1',
                name: 'archived',
                enabled: false,
            })
        );
        await expectOk(
            upsertProfileForm(getDb(), {
                guildId: 'guild-2',
                name: 'default',
                enabled: true,
            })
        );

        const allForms = await expectOk(listProfileFormsByGuildId(getDb(), { guildId: 'guild-1' }));
        const enabledForms = await expectOk(
            listProfileFormsByGuildId(getDb(), { guildId: 'guild-1', enabledOnly: true })
        );
        const foundByName = await expectOk(
            findProfileFormByGuildName(getDb(), {
                guildId: 'guild-1',
                name: 'default',
                enabledOnly: true,
            })
        );
        const foundById = await expectOk(
            findProfileFormById(getDb(), {
                guildId: 'guild-1',
                formId: defaultForm.id,
            })
        );
        const missingDisabled = await findProfileFormByGuildName(getDb(), {
            guildId: 'guild-1',
            name: 'archived',
            enabledOnly: true,
        });

        expect(allForms.map((form) => form.name)).toStrictEqual(['archived', 'default']);
        expect(enabledForms.map((form) => form.name)).toStrictEqual(['default']);
        expect(foundByName.id).toBe(defaultForm.id);
        expect(foundById.config).toStrictEqual({ intro: 'Tell the server about yourself.' });
        expect(missingDisabled._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('upserts, orders, and deletes form fields', async () => {
        const form = await createDefaultForm();
        await expectOk(
            upsertProfileField(getDb(), {
                formId: form.id,
                fieldKey: 'bio',
                label: 'Bio',
                fieldType: 'textarea',
                required: true,
                maxLength: 500,
                position: 2,
            })
        );
        await expectOk(
            upsertProfileField(getDb(), {
                formId: form.id,
                fieldKey: 'name',
                label: 'Display name',
                fieldType: 'text',
                required: true,
                maxLength: 80,
                position: 1,
            })
        );
        await expectOk(
            upsertProfileField(getDb(), {
                formId: form.id,
                fieldKey: 'bio',
                label: 'About me',
                fieldType: 'textarea',
                required: false,
                maxLength: 400,
                position: 3,
            })
        );

        const fields = await expectOk(listProfileFieldsByFormId(getDb(), { formId: form.id }));
        const deleted = await expectOk(deleteProfileField(getDb(), { formId: form.id, fieldKey: 'name' }));

        expect(fields.map((field) => [field.fieldKey, field.label, field.position])).toStrictEqual([
            ['name', 'Display name', 1],
            ['bio', 'About me', 3],
        ]);
        expect(deleted.fieldKey).toBe('name');
    });

    it('creates and lists enabled-form submissions by guild and status', async () => {
        const form = await createDefaultForm();
        const submission = await expectOk(
            createProfileSubmission(getDb(), {
                guildId: 'guild-1',
                formId: form.id,
                userId: 'user-1',
                values: {
                    name: 'Neon',
                    bio: 'Flux enthusiast',
                },
            })
        );
        await expectOk(
            createProfileSubmission(getDb(), {
                guildId: 'guild-1',
                formId: form.id,
                userId: 'user-2',
                values: {
                    name: 'Flux',
                },
            })
        );

        const pending = await expectOk(
            listProfileSubmissionsByGuildId(getDb(), {
                guildId: 'guild-1',
                status: 'pending',
                limit: 1,
            })
        );
        const found = await expectOk(
            findProfileSubmissionById(getDb(), {
                guildId: 'guild-1',
                submissionId: submission.id,
            })
        );

        expect(pending).toHaveLength(1);
        expect(found.values).toStrictEqual({
            name: 'Neon',
            bio: 'Flux enthusiast',
        });
    });

    it('rejects submissions for disabled or wrong-guild forms', async () => {
        const disabledForm = await expectOk(
            upsertProfileForm(getDb(), {
                guildId: 'guild-1',
                name: 'disabled',
                enabled: false,
            })
        );
        const wrongGuild = await createProfileSubmission(getDb(), {
            guildId: 'guild-2',
            formId: disabledForm.id,
            userId: 'user-1',
        });
        const disabled = await createProfileSubmission(getDb(), {
            guildId: 'guild-1',
            formId: disabledForm.id,
            userId: 'user-1',
        });

        expect(wrongGuild._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(disabled._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('reviews submissions with guild scoping and legal status transitions', async () => {
        const form = await createDefaultForm();
        const submission = await expectOk(
            createProfileSubmission(getDb(), {
                guildId: 'guild-1',
                formId: form.id,
                userId: 'user-1',
            })
        );
        const wrongGuild = await reviewProfileSubmission(getDb(), {
            guildId: 'guild-2',
            submissionId: submission.id,
            reviewerUserId: 'reviewer-1',
            decision: 'approved',
        });
        const review = await expectOk(
            reviewProfileSubmission(getDb(), {
                guildId: 'guild-1',
                submissionId: submission.id,
                reviewerUserId: 'reviewer-1',
                decision: 'approved',
                reason: 'Looks good',
            })
        );
        const reviewedSubmission = await expectOk(
            findProfileSubmissionById(getDb(), {
                guildId: 'guild-1',
                submissionId: submission.id,
            })
        );
        const secondReview = await reviewProfileSubmission(getDb(), {
            guildId: 'guild-1',
            submissionId: submission.id,
            reviewerUserId: 'reviewer-1',
            decision: 'rejected',
        });

        expect(wrongGuild._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(review).toMatchObject({
            submissionId: submission.id,
            reviewerUserId: 'reviewer-1',
            decision: 'approved',
            reason: 'Looks good',
        });
        expect(reviewedSubmission.status).toBe('approved');
        expect(reviewedSubmission.reviewedAt).toBeInstanceOf(Date);
        expect(secondReview._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-status-transition',
            from: 'approved',
            to: 'rejected',
        });
    });

    it('rejects invalid form, field, and submission input', async () => {
        const missingForm = await upsertProfileForm(getDb(), {
            guildId: '',
            name: 'default',
        });
        const invalidField = await upsertProfileField(getDb(), {
            formId: 'form-1',
            fieldKey: 'bio',
            label: 'Bio',
            fieldType: 'textarea',
            position: -1,
        });
        const missingSubmission = await createProfileSubmission(getDb(), {
            guildId: 'guild-1',
            formId: '',
            userId: 'user-1',
        });

        expect(missingForm._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'guildId' });
        expect(invalidField._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-value', field: 'position' });
        expect(missingSubmission._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'formId' });
    });
});

async function createDefaultForm() {
    return expectOk(
        upsertProfileForm(getDb(), {
            guildId: 'guild-1',
            name: 'default',
            enabled: true,
        })
    );
}

async function createTestDatabase(): Promise<TestDatabase> {
    await mkdir(testDataRoot, { recursive: true });
    const dataDirectory = join(testDataRoot, randomUUID());
    const client = new PGlite(dataDirectory);
    const db = drizzle(client, { schema });

    await migrate(db, { migrationsFolder });

    return {
        db,
        async close() {
            await client.close();
            await rm(dataDirectory, { recursive: true, force: true });
        },
    };
}

function getDb() {
    if (!testDatabase) {
        throw new Error('Test database was not created.');
    }

    return testDatabase.db;
}

async function expectOk<T>(resultPromise: Promise<{ isOk(): boolean; _unsafeUnwrap(): T }>): Promise<T> {
    const result = await resultPromise;

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

type TestDatabase = {
    db: ReturnType<typeof drizzle<typeof schema>>;
    close: () => Promise<void>;
};

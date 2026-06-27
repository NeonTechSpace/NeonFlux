import {
    createProfileSubmission,
    findProfileFormByGuildName,
    listProfileFieldsByFormId,
    recordBotActionEvent,
} from '@neonflux/db';
import type {
    BotActionEventRecord,
    ProfileFieldRecord,
    ProfileFormRecord,
    ProfileSubmissionRecord,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { listFluxerCurrentUserGuilds } from '@neonflux/fluxer/guilds';
import type * as FluxerGuilds from '@neonflux/fluxer/guilds';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';
import { loadPublicProfileBuilderPage, submitPublicProfileBuilderForm } from './profile-builder.server.js';

const request = new Request('http://localhost:3000/profile-builder?guildId=guild-1&form=default');
const timestamp = new Date('2026-06-26T00:00:00.000Z');
const authContext = {
    session: {
        id: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG',
        fluxerUserId: 'user-1',
        createdAt: timestamp,
        expiresAt: new Date('2026-06-28T00:00:00.000Z'),
        revokedAt: null,
    },
    fluxerUserId: 'user-1',
    accessToken: 'fresh-access-token',
    scopes: ['identify', 'guilds'],
    accessTokenExpiresAt: new Date('2026-06-26T01:00:00.000Z'),
};

vi.mock('./database.server.js', () => ({
    getWebDatabaseClient: () => ({
        db: {},
    }),
}));

vi.mock('./fluxer-auth-context.server.js', () => ({
    readAuthenticatedFluxerContext: vi.fn(),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        createProfileSubmission: vi.fn(),
        findProfileFormByGuildName: vi.fn(),
        listProfileFieldsByFormId: vi.fn(),
        recordBotActionEvent: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/guilds', async (importActual) => {
    const actual = await importActual<typeof FluxerGuilds>();

    return {
        ...actual,
        listFluxerCurrentUserGuilds: vi.fn(),
    };
});

describe('public profile builder', () => {
    beforeEach(() => {
        vi.mocked(findProfileFormByGuildName).mockResolvedValue(ok(createForm()));
        vi.mocked(listProfileFieldsByFormId).mockResolvedValue(
            ok([createField(), createField({ fieldKey: 'site', fieldType: 'url', required: false })])
        );
        vi.mocked(readAuthenticatedFluxerContext).mockResolvedValue(ok(authContext));
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValue(
            ok([
                {
                    id: 'guild-1',
                    name: 'Guild One',
                    permissions: '0',
                },
            ])
        );
        vi.mocked(createProfileSubmission).mockResolvedValue(ok(createSubmission()));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEvent()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads enabled public form fields by guild and form handle', async () => {
        const result = await loadPublicProfileBuilderPage({
            guildId: ' guild-1 ',
            formName: 'default',
        });

        expect(result).toMatchObject({
            type: 'form',
            guildId: 'guild-1',
            formName: 'default',
            fields: [
                {
                    fieldKey: 'display_name',
                    label: 'Display name',
                    fieldType: 'text',
                    required: true,
                },
                {
                    fieldKey: 'site',
                    fieldType: 'url',
                    required: false,
                },
            ],
        });
        expect(findProfileFormByGuildName).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                name: 'default',
                enabledOnly: true,
            }
        );
    });

    it('requires authentication before submitting', async () => {
        vi.mocked(readAuthenticatedFluxerContext).mockResolvedValueOnce(err('missing-cookie'));

        const result = await submitPublicProfileBuilderForm(request, {
            guildId: 'guild-1',
            formName: 'default',
            values: {
                display_name: 'Neon',
            },
        });

        expect(result).toStrictEqual({ type: 'auth-required' });
        expect(createProfileSubmission).not.toHaveBeenCalled();
    });

    it('requires the submitting user to belong to the guild', async () => {
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValueOnce(ok([]));

        const result = await submitPublicProfileBuilderForm(request, {
            guildId: 'guild-1',
            formName: 'default',
            values: {
                display_name: 'Neon',
            },
        });

        expect(result).toStrictEqual({ type: 'not-member' });
        expect(createProfileSubmission).not.toHaveBeenCalled();
    });

    it('validates configured fields before storing a submission', async () => {
        const result = await submitPublicProfileBuilderForm(request, {
            guildId: 'guild-1',
            formName: 'default',
            values: {
                display_name: 'Neon',
                site: 'not-a-url',
            },
        });

        expect(result).toStrictEqual({ type: 'invalid-input', field: 'site' });
        expect(createProfileSubmission).not.toHaveBeenCalled();
    });

    it('creates pending submissions and records audit without raw profile values', async () => {
        const result = await submitPublicProfileBuilderForm(request, {
            guildId: 'guild-1',
            formName: 'default',
            values: {
                display_name: 'Neon',
                site: 'https://neonflux.example',
            },
        });

        expect(result).toStrictEqual({
            type: 'submitted',
            submissionId: 'submission-1',
            status: 'pending',
        });
        expect(createProfileSubmission).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                formId: 'form-1',
                userId: 'user-1',
                status: 'pending',
                values: {
                    display_name: 'Neon',
                    site: 'https://neonflux.example',
                },
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'profile_builder',
                action: 'submission.created',
                actorUserId: 'user-1',
                metadata: expect.not.objectContaining({
                    values: expect.anything(),
                    display_name: expect.anything(),
                    site: expect.anything(),
                }),
            })
        );
    });
});

function createForm(overrides: Partial<ProfileFormRecord> = {}): ProfileFormRecord {
    return {
        id: 'form-1',
        guildId: 'guild-1',
        name: 'default',
        approvalRequired: true,
        outputChannelId: null,
        enabled: true,
        config: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createField(overrides: Partial<ProfileFieldRecord> = {}): ProfileFieldRecord {
    return {
        id: `field-${overrides.fieldKey ?? 'display_name'}`,
        formId: 'form-1',
        fieldKey: 'display_name',
        label: 'Display name',
        fieldType: 'text',
        required: true,
        maxLength: 80,
        position: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createSubmission(overrides: Partial<ProfileSubmissionRecord> = {}): ProfileSubmissionRecord {
    return {
        id: 'submission-1',
        guildId: 'guild-1',
        formId: 'form-1',
        userId: 'user-1',
        status: 'pending',
        values: {
            display_name: 'Neon',
        },
        submittedAt: timestamp,
        reviewedAt: null,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createAuditEvent(overrides: Partial<BotActionEventRecord> = {}): BotActionEventRecord {
    return {
        id: 'audit-event-1',
        guildId: 'guild-1',
        feature: 'profile_builder',
        action: 'submission.created',
        actorUserId: 'user-1',
        targetId: 'submission-1',
        metadata: {
            source: 'public-profile-builder',
        },
        createdAt: timestamp,
        ...overrides,
    };
}

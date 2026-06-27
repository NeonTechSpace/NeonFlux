import {
    deleteProfileField,
    findDeploymentConfig,
    findProfileSubmissionById,
    listProfileFieldsByFormId,
    listProfileFormsByGuildId,
    listProfileSubmissionsByGuildId,
    recordBotActionEvent,
    reviewProfileSubmission,
    upsertProfileField,
    upsertProfileForm,
} from '@neonflux/db';
import type {
    BotActionEventRecord,
    DeploymentConfigRecord,
    ProfileFieldRecord,
    ProfileFormRecord,
    ProfileSubmissionRecord,
    ProfileSubmissionReviewRecord,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    loadDashboardProfileBuilderSettings,
    reviewDashboardProfileSubmission,
    updateDashboardProfileBuilderForm,
} from './dashboard-profile-builder.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1/community');
const timestamp = new Date('2026-06-26T00:00:00.000Z');
const authContext = {
    session: {
        id: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG',
        fluxerUserId: 'actor-1',
        createdAt: timestamp,
        expiresAt: new Date('2026-06-28T00:00:00.000Z'),
        revokedAt: null,
    },
    fluxerUserId: 'actor-1',
    accessToken: 'fresh-access-token',
    scopes: ['identify', 'guilds'],
    accessTokenExpiresAt: new Date('2026-06-26T01:00:00.000Z'),
};

vi.mock('./database.server.js', () => ({
    getWebDatabaseClient: () => ({
        db: {},
    }),
}));

vi.mock('./dashboard-guild-page.server.js', () => ({
    loadDashboardGuildPageData: vi.fn(),
}));

vi.mock('./fluxer-auth-context.server.js', () => ({
    readAuthenticatedFluxerContext: vi.fn(),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        deleteProfileField: vi.fn(),
        findDeploymentConfig: vi.fn(),
        findProfileSubmissionById: vi.fn(),
        listProfileFieldsByFormId: vi.fn(),
        listProfileFormsByGuildId: vi.fn(),
        listProfileSubmissionsByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        reviewProfileSubmission: vi.fn(),
        upsertProfileField: vi.fn(),
        upsertProfileForm: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/users', async (importActual) => {
    const actual = await importActual<typeof FluxerUsers>();

    return {
        ...actual,
        getFluxerCurrentUser: vi.fn(),
    };
});

describe('dashboard profile builder settings', () => {
    beforeEach(() => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValue({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'guild-1',
                name: 'Guild One',
            },
        });
        vi.mocked(readAuthenticatedFluxerContext).mockResolvedValue(ok(authContext));
        vi.mocked(getFluxerCurrentUser).mockResolvedValue(
            ok({
                id: 'actor-1',
                username: 'neonsy',
                discriminator: '0',
                globalName: 'Neonsy',
                avatar: null,
            })
        );
        vi.mocked(findDeploymentConfig).mockResolvedValue(ok(createDeploymentConfig()));
        vi.mocked(listProfileFormsByGuildId).mockResolvedValue(ok([createForm()]));
        vi.mocked(listProfileFieldsByFormId).mockResolvedValue(ok([createField()]));
        vi.mocked(listProfileSubmissionsByGuildId).mockResolvedValue(ok([createSubmission()]));
        vi.mocked(upsertProfileForm).mockResolvedValue(ok(createForm()));
        vi.mocked(upsertProfileField).mockResolvedValue(ok(createField()));
        vi.mocked(deleteProfileField).mockResolvedValue(ok(createField({ fieldKey: 'old_key' })));
        vi.mocked(reviewProfileSubmission).mockResolvedValue(ok(createReview()));
        vi.mocked(findProfileSubmissionById).mockResolvedValue(ok(createSubmission({ status: 'approved' })));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEvent()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads forms, public links, and recent submissions through the authorized guild scope', async () => {
        const result = await loadDashboardProfileBuilderSettings(request, 'requested-guild');

        expect(result).toStrictEqual({
            type: 'settings',
            publicUrlStatus: 'available',
            forms: [
                {
                    id: 'form-1',
                    name: 'default',
                    approvalRequired: true,
                    enabled: true,
                    publicUrl: 'https://neonflux.example/profile-builder?guildId=guild-1&form=default',
                    publicPath: '/profile-builder?guildId=guild-1&form=default',
                    fields: [
                        {
                            id: 'field-1',
                            fieldKey: 'display_name',
                            label: 'Display name',
                            fieldType: 'text',
                            required: true,
                            maxLength: 80,
                            position: 0,
                        },
                    ],
                    updatedAt: '2026-06-26T00:00:00.000Z',
                },
            ],
            submissions: [
                {
                    id: 'submission-1',
                    formId: 'form-1',
                    formName: 'default',
                    userId: 'user-1',
                    status: 'pending',
                    values: {
                        display_name: 'Neon',
                    },
                    submittedAt: '2026-06-26T00:00:00.000Z',
                },
            ],
        });
        expect(listProfileFormsByGuildId).toHaveBeenCalledWith({}, { guildId: 'guild-1' });
    });

    it('updates forms, replaces stale fields, and records dashboard audit', async () => {
        vi.mocked(listProfileFieldsByFormId)
            .mockResolvedValueOnce(ok([createField({ fieldKey: 'old_key' })]))
            .mockResolvedValueOnce(ok([createField()]));

        const result = await updateDashboardProfileBuilderForm(request, {
            guildId: 'requested-guild',
            name: 'default',
            approvalRequired: false,
            enabled: true,
            fields: [
                {
                    fieldKey: 'display_name',
                    label: 'Display name',
                    fieldType: 'text',
                    required: true,
                    maxLength: 80,
                },
            ],
        });

        expect(result).toMatchObject({
            type: 'updated',
            form: {
                name: 'default',
            },
        });
        expect(upsertProfileForm).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                name: 'default',
                approvalRequired: false,
                enabled: true,
            }
        );
        expect(upsertProfileField).toHaveBeenCalledWith(
            {},
            {
                formId: 'form-1',
                fieldKey: 'display_name',
                label: 'Display name',
                fieldType: 'text',
                required: true,
                maxLength: 80,
                position: 0,
            }
        );
        expect(deleteProfileField).toHaveBeenCalledWith({}, { formId: 'form-1', fieldKey: 'old_key' });
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'guild-1',
                feature: 'profile_builder',
                action: 'form.updated',
                actorUserId: 'actor-1',
                targetId: 'form-1',
                metadata: expect.objectContaining({
                    formName: 'default',
                    fieldCount: 1,
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                }),
            })
        );
    });

    it('reviews submissions through guild scope and records audit without raw values', async () => {
        const result = await reviewDashboardProfileSubmission(request, {
            guildId: 'guild-1',
            submissionId: 'submission-1',
            decision: 'approved',
        });

        expect(result).toMatchObject({
            type: 'reviewed',
            submission: {
                id: 'submission-1',
                status: 'approved',
            },
        });
        expect(reviewProfileSubmission).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                submissionId: 'submission-1',
                reviewerUserId: 'actor-1',
                decision: 'approved',
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'profile_builder',
                action: 'submission.reviewed',
                metadata: expect.not.objectContaining({
                    values: expect.anything(),
                    display_name: expect.anything(),
                }),
            })
        );
    });

    it('denies unavailable guilds before writing', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'not-found' });

        const result = await updateDashboardProfileBuilderForm(request, {
            guildId: 'guild-1',
            name: 'default',
        });

        expect(result).toStrictEqual({ type: 'not-found' });
        expect(upsertProfileForm).not.toHaveBeenCalled();
    });

    it('maps invalid form input without writing', async () => {
        const result = await updateDashboardProfileBuilderForm(request, {
            guildId: 'guild-1',
            name: 'Default Form',
        });

        expect(result).toStrictEqual({ type: 'invalid-input', field: 'name' });
        expect(upsertProfileForm).not.toHaveBeenCalled();
    });
});

function createDeploymentConfig(): DeploymentConfigRecord {
    return {
        instanceMode: 'multi',
        publicWebUrl: 'https://neonflux.example',
        ownerIds: [],
    };
}

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
        id: 'field-1',
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

function createReview(overrides: Partial<ProfileSubmissionReviewRecord> = {}): ProfileSubmissionReviewRecord {
    return {
        id: 'review-1',
        submissionId: 'submission-1',
        reviewerUserId: 'actor-1',
        decision: 'approved',
        reason: null,
        createdAt: timestamp,
        ...overrides,
    };
}

function createAuditEvent(overrides: Partial<BotActionEventRecord> = {}): BotActionEventRecord {
    return {
        id: 'audit-event-1',
        guildId: 'guild-1',
        feature: 'profile_builder',
        action: 'form.updated',
        actorUserId: 'actor-1',
        targetId: 'form-1',
        metadata: {
            source: 'dashboard',
        },
        createdAt: timestamp,
        ...overrides,
    };
}

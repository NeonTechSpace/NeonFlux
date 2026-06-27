import {
    deleteMessageTemplate,
    listMessageTemplatesByGuildId,
    recordBotActionEvent,
    upsertMessageTemplate,
} from '@neonflux/db';
import type { BotActionEventRecord, MessageTemplateRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    deleteDashboardMessageTemplate,
    loadDashboardMessageTemplates,
    saveDashboardMessageTemplate,
} from './dashboard-posting-templates.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1/messaging');
const authContext = {
    session: {
        id: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG',
        fluxerUserId: 'actor-1',
        createdAt: new Date('2026-06-21T00:00:00.000Z'),
        expiresAt: new Date('2026-06-28T00:00:00.000Z'),
        revokedAt: null,
    },
    fluxerUserId: 'actor-1',
    accessToken: 'fresh-access-token',
    scopes: ['identify', 'guilds'],
    accessTokenExpiresAt: new Date('2026-06-21T01:00:00.000Z'),
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
        deleteMessageTemplate: vi.fn(),
        listMessageTemplatesByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        upsertMessageTemplate: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/users', async (importActual) => {
    const actual = await importActual<typeof FluxerUsers>();

    return {
        ...actual,
        getFluxerCurrentUser: vi.fn(),
    };
});

describe('dashboard posting templates', () => {
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
        vi.mocked(listMessageTemplatesByGuildId).mockResolvedValue(ok([createTemplateRecord()]));
        vi.mocked(upsertMessageTemplate).mockResolvedValue(ok(createTemplateRecord()));
        vi.mocked(deleteMessageTemplate).mockResolvedValue(ok(createTemplateRecord()));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('lists templates through the authorized guild scope', async () => {
        await expect(loadDashboardMessageTemplates(request, 'guild-1')).resolves.toStrictEqual({
            type: 'templates',
            templates: [
                {
                    id: 'template-1',
                    guildId: 'guild-1',
                    name: 'Release update',
                    content: 'Ship it',
                    embeds: [{ title: 'Release' }],
                    createdByUserId: 'actor-1',
                    updatedAt: '2026-06-26T00:00:00.000Z',
                },
            ],
        });
        expect(listMessageTemplatesByGuildId).toHaveBeenCalledWith({}, { guildId: 'guild-1' });
    });

    it('saves templates and records dashboard audit metadata', async () => {
        const result = await saveDashboardMessageTemplate(request, {
            guildId: 'guild-1',
            name: 'Release update',
            content: 'Ship it',
            embeds: [{ title: 'Release' }],
        });

        expect(result).toMatchObject({
            type: 'saved',
            template: {
                id: 'template-1',
                name: 'Release update',
            },
        });
        expect(upsertMessageTemplate).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                name: 'Release update',
                content: 'Ship it',
                embeds: [{ title: 'Release' }],
                createdByUserId: 'actor-1',
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'guild-1',
                feature: 'posting',
                action: 'template.saved',
                actorUserId: 'actor-1',
                targetId: 'template-1',
                metadata: expect.objectContaining({
                    templateName: 'Release update',
                    embedCount: 1,
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                }),
            })
        );
    });

    it('deletes templates and records dashboard audit metadata', async () => {
        await expect(
            deleteDashboardMessageTemplate(request, {
                guildId: 'guild-1',
                templateId: 'template-1',
            })
        ).resolves.toStrictEqual({
            type: 'deleted',
            templateId: 'template-1',
        });
        expect(deleteMessageTemplate).toHaveBeenCalledWith({}, { guildId: 'guild-1', templateId: 'template-1' });
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'guild-1',
                feature: 'posting',
                action: 'template.deleted',
                actorUserId: 'actor-1',
                targetId: 'template-1',
            })
        );
    });

    it('does not write templates when the guild is inaccessible', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'not-found' });

        await expect(
            saveDashboardMessageTemplate(request, {
                guildId: 'guild-1',
                name: 'Release update',
                content: 'Ship it',
            })
        ).resolves.toStrictEqual({ type: 'not-found' });
        expect(upsertMessageTemplate).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('returns a validation result for empty template payloads', async () => {
        vi.mocked(upsertMessageTemplate).mockResolvedValueOnce(err({ type: 'missing-input', field: 'message' }));

        await expect(
            saveDashboardMessageTemplate(request, {
                guildId: 'guild-1',
                name: 'Release update',
            })
        ).resolves.toStrictEqual({
            type: 'invalid-template',
            message: 'Add message content or at least one embed before saving.',
        });
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });
});

function createTemplateRecord(overrides: Partial<MessageTemplateRecord> = {}): MessageTemplateRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'template-1',
        guildId: 'guild-1',
        name: 'Release update',
        content: 'Ship it',
        embeds: [{ title: 'Release' }],
        createdByUserId: 'actor-1',
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createAuditEventRecord(overrides: Partial<BotActionEventRecord> = {}): BotActionEventRecord {
    return {
        id: 'audit-event-1',
        guildId: 'guild-1',
        feature: 'posting',
        action: 'template.saved',
        actorUserId: 'actor-1',
        targetId: 'template-1',
        metadata: {},
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
        ...overrides,
    };
}

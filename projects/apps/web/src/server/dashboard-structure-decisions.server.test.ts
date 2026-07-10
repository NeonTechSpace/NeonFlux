import { findStructureImportRunByGuildId, listStructureImportDecisionsPage } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getWebDb } from './db.server.js';
import { loadAuthorizedStructureContext } from './dashboard-structure-context.server.js';
import { readDashboardStructureImportDecisionPage } from './dashboard-structure-plan-persistence.server.js';

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    findStructureImportRunByGuildId: vi.fn(),
    listStructureImportDecisionsPage: vi.fn(),
}));
vi.mock('./db.server.js', () => ({ getWebDb: vi.fn() }));
vi.mock('./dashboard-structure-context.server.js', () => ({ loadAuthorizedStructureContext: vi.fn() }));

describe('Server Blueprint decision paging', () => {
    beforeEach(() => {
        vi.mocked(getWebDb).mockResolvedValue({ db: {} } as never);
        vi.mocked(loadAuthorizedStructureContext).mockResolvedValue({
            type: 'authorized',
            guild: { id: 'guild-1' },
            actor: { actorUserId: 'user-1', metadata: {} },
        } as never);
        vi.mocked(findStructureImportRunByGuildId).mockResolvedValue(ok({ id: 'run-1' } as never));
    });

    it('returns a scoped, bounded decision page and cursor', async () => {
        vi.mocked(listStructureImportDecisionsPage).mockResolvedValue(
            ok({
                decisions: [
                    {
                        id: 'decision-1',
                        runId: 'run-1',
                        sequence: 0,
                        targetType: 'role',
                        classification: 'no-op',
                        sourceId: 'source-role',
                        targetId: 'target-role',
                        logicalId: 'source-role',
                        name: 'Admin',
                        details: { fields: ['name'] },
                        createdAt: new Date(),
                    },
                ],
                nextCursor: 0,
            })
        );

        const result = await readDashboardStructureImportDecisionPage(new Request('http://localhost'), {
            guildId: 'guild-1',
            importRunId: 'run-1',
            limit: 50,
        });

        expect(result).toMatchObject({
            type: 'decision-page',
            nextCursor: 0,
            decisions: [{ logicalId: 'source-role', classification: 'no-op', fields: ['name'] }],
        });
        expect(listStructureImportDecisionsPage).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ guildId: 'guild-1', runId: 'run-1', limit: 50 })
        );
    });
});

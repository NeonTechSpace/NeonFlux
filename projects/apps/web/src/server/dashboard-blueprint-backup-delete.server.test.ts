import { deleteStructureBackup } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getWebDb } from './db.server.js';
import { loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import { deleteDashboardBlueprintBackup } from './dashboard-blueprint-backups.server.js';

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    deleteStructureBackup: vi.fn(),
}));
vi.mock('./db.server.js', () => ({ getWebDb: vi.fn() }));
vi.mock('./dashboard-blueprint-context.server.js', () => ({ loadAuthorizedBlueprintContext: vi.fn() }));

describe('Server Blueprint restore-point retention', () => {
    beforeEach(() => {
        vi.mocked(getWebDb).mockResolvedValue({ db: {} } as never);
        vi.mocked(loadAuthorizedBlueprintContext).mockResolvedValue({
            type: 'authorized',
            guild: { id: 'guild-1' },
            actor: { actorUserId: 'user-1', metadata: {} },
        } as never);
    });

    it('deletes an eligible restore point through the authoritative Convex policy', async () => {
        vi.mocked(deleteStructureBackup).mockResolvedValue(ok(true));

        await expect(
            deleteDashboardBlueprintBackup(new Request('http://localhost'), {
                backupId: 'backup-1',
                guildId: 'guild-1',
            })
        ).resolves.toEqual({ type: 'backup-deleted', backupId: 'backup-1' });
        expect(deleteStructureBackup).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ backupId: 'backup-1', guildId: 'guild-1' })
        );
    });

    it.each([
        ['blueprint-restore-point-recovery-window-active', 'restore-point-recovery-window-active'],
        ['blueprint-restore-point-run-active', 'restore-point-run-active'],
    ] as const)('returns the precise restore-point protection reason for %s', async (repositoryType, resultType) => {
        vi.mocked(deleteStructureBackup).mockResolvedValue(err({ type: repositoryType }));

        await expect(
            deleteDashboardBlueprintBackup(new Request('http://localhost'), {
                backupId: 'backup-1',
                guildId: 'guild-1',
            })
        ).resolves.toEqual({ type: resultType });
    });
});

import { deleteStructureBackup, findStructureBackupByGuildId } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getWebDb } from './db.server.js';
import { loadAuthorizedStructureContext } from './dashboard-structure-context.server.js';
import { deleteDashboardStructureBackup } from './dashboard-structure-backups.server.js';

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    deleteStructureBackup: vi.fn(),
    findStructureBackupByGuildId: vi.fn(),
}));
vi.mock('./db.server.js', () => ({ getWebDb: vi.fn() }));
vi.mock('./dashboard-structure-context.server.js', () => ({ loadAuthorizedStructureContext: vi.fn() }));

describe('Server Blueprint restore-point retention', () => {
    beforeEach(() => {
        vi.mocked(getWebDb).mockResolvedValue({ db: {} } as never);
        vi.mocked(loadAuthorizedStructureContext).mockResolvedValue({
            type: 'authorized',
            guild: { id: 'guild-1' },
            actor: { actorUserId: 'user-1', metadata: {} },
        } as never);
    });

    it('rejects manual deletion of a deployment restore point clearly', async () => {
        vi.mocked(findStructureBackupByGuildId).mockResolvedValue(
            ok({ id: 'backup-1', source: 'restore_point' } as never)
        );

        await expect(
            deleteDashboardStructureBackup(new Request('http://localhost'), {
                backupId: 'backup-1',
                guildId: 'guild-1',
            })
        ).resolves.toEqual({ type: 'restore-point-protected' });
        expect(deleteStructureBackup).not.toHaveBeenCalled();
    });
});

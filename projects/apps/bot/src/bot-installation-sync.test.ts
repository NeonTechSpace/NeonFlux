import type { AppMode } from '@neonflux/config';
import { deleteBotInstallation, upsertBotInstallation, type BotInstallationRecord } from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recordBotInstallationEvent, removeBotInstallationEvent } from './bot-installation-sync.js';

vi.mock('@neonflux/db', () => {
    return {
        deleteBotInstallation: vi.fn(),
        upsertBotInstallation: vi.fn(),
    };
});

const upsertBotInstallationMock = vi.mocked(upsertBotInstallation);
const deleteBotInstallationMock = vi.mocked(deleteBotInstallation);

const testDb = {} as Parameters<typeof recordBotInstallationEvent>[0];

describe('recordBotInstallationEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('records the target guild in single mode', async () => {
        upsertBotInstallationMock.mockResolvedValue(ok(createInstallation({ guildId: 'target', mode: 'single' })));

        const result = await recordBotInstallationEvent(testDb, createSingleMode(), {
            guildId: ' target ',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'recorded',
            guildId: 'target',
        });
        expect(upsertBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'target',
            mode: 'single',
        });
    });

    it('ignores non-target guilds in single mode before DB access', async () => {
        const result = await recordBotInstallationEvent(testDb, createSingleMode(), {
            guildId: 'other',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({ status: 'ignored' });
        expect(upsertBotInstallationMock).not.toHaveBeenCalled();
    });

    it('records any guild in multi mode', async () => {
        upsertBotInstallationMock.mockResolvedValue(ok(createInstallation({ guildId: 'guild-1', mode: 'multi' })));

        const result = await recordBotInstallationEvent(testDb, createMultiMode(), {
            guildId: 'guild-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'recorded',
            guildId: 'guild-1',
        });
        expect(upsertBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            mode: 'multi',
        });
    });

    it('ignores missing guild ids before DB access', async () => {
        const missingIdResults = await Promise.all([
            recordBotInstallationEvent(testDb, createMultiMode(), { guildId: undefined }),
            recordBotInstallationEvent(testDb, createMultiMode(), { guildId: null }),
            recordBotInstallationEvent(testDb, createMultiMode(), { guildId: '   ' }),
        ]);

        expect(missingIdResults.every((result) => result.isOk())).toBe(true);
        expect(missingIdResults.map((result) => result._unsafeUnwrap())).toStrictEqual([
            { status: 'ignored' },
            { status: 'ignored' },
            { status: 'ignored' },
        ]);
        expect(upsertBotInstallationMock).not.toHaveBeenCalled();
    });

    it('returns database-error when recording fails in the repository', async () => {
        upsertBotInstallationMock.mockResolvedValue(err('database-error'));

        const result = await recordBotInstallationEvent(testDb, createMultiMode(), {
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });
});

describe('removeBotInstallationEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('removes the target guild in single mode', async () => {
        deleteBotInstallationMock.mockResolvedValue(ok(createInstallation({ guildId: 'target', mode: 'single' })));

        const result = await removeBotInstallationEvent(testDb, createSingleMode(), {
            guildId: ' target ',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'removed',
            guildId: 'target',
        });
        expect(deleteBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'target',
        });
    });

    it('ignores non-target guilds in single mode before DB access', async () => {
        const result = await removeBotInstallationEvent(testDb, createSingleMode(), {
            guildId: 'other',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({ status: 'ignored' });
        expect(deleteBotInstallationMock).not.toHaveBeenCalled();
    });

    it('removes any guild in multi mode', async () => {
        deleteBotInstallationMock.mockResolvedValue(ok(createInstallation({ guildId: 'guild-1', mode: 'multi' })));

        const result = await removeBotInstallationEvent(testDb, createMultiMode(), {
            guildId: 'guild-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'removed',
            guildId: 'guild-1',
        });
        expect(deleteBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
        });
    });

    it('ignores missing guild ids before DB access', async () => {
        const missingIdResults = await Promise.all([
            removeBotInstallationEvent(testDb, createMultiMode(), { guildId: undefined }),
            removeBotInstallationEvent(testDb, createMultiMode(), { guildId: null }),
            removeBotInstallationEvent(testDb, createMultiMode(), { guildId: '   ' }),
        ]);

        expect(missingIdResults.every((result) => result.isOk())).toBe(true);
        expect(missingIdResults.map((result) => result._unsafeUnwrap())).toStrictEqual([
            { status: 'ignored' },
            { status: 'ignored' },
            { status: 'ignored' },
        ]);
        expect(deleteBotInstallationMock).not.toHaveBeenCalled();
    });

    it('returns database-error when removing fails in the repository', async () => {
        deleteBotInstallationMock.mockResolvedValue(err('database-error'));

        const result = await removeBotInstallationEvent(testDb, createMultiMode(), {
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });

    it('ignores not-found deletes for stale guild delete events', async () => {
        deleteBotInstallationMock.mockResolvedValue(err('not-found'));

        const result = await removeBotInstallationEvent(testDb, createMultiMode(), {
            guildId: 'guild-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({ status: 'ignored' });
    });
});

function createSingleMode(): AppMode {
    return {
        instanceMode: 'single',
        singleGuildId: 'target',
    };
}

function createMultiMode(): AppMode {
    return {
        instanceMode: 'multi',
    };
}

function createInstallation(input: { guildId: string; mode: BotInstallationRecord['mode'] }): BotInstallationRecord {
    const timestamp = new Date('2026-06-21T00:00:00.000Z');

    return {
        guildId: input.guildId,
        mode: input.mode,
        installedAt: timestamp,
        updatedAt: timestamp,
    };
}

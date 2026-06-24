import type { AppMode } from '@neonflux/config';
import {
    deleteBotInstallation,
    listBotInstallationGuildIds,
    upsertBotInstallation,
    type BotInstallationRecord,
} from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    reconcileBotInstallations,
    recordBotInstallationEvent,
    removeBotInstallationEvent,
} from './bot-installation-sync.js';

vi.mock('@neonflux/db', () => {
    return {
        deleteBotInstallation: vi.fn(),
        listBotInstallationGuildIds: vi.fn(),
        upsertBotInstallation: vi.fn(),
    };
});

const upsertBotInstallationMock = vi.mocked(upsertBotInstallation);
const deleteBotInstallationMock = vi.mocked(deleteBotInstallation);
const listBotInstallationGuildIdsMock = vi.mocked(listBotInstallationGuildIds);

const testDb = {} as Parameters<typeof recordBotInstallationEvent>[0];

describe('recordBotInstallationEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('records the target guild in single mode', async () => {
        upsertBotInstallationMock.mockResolvedValue(ok(createInstallation('target')));

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
        upsertBotInstallationMock.mockResolvedValue(ok(createInstallation('guild-1')));

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

describe('reconcileBotInstallations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        upsertBotInstallationMock.mockImplementation((_db, input) =>
            Promise.resolve(ok(createInstallation(input.guildId)))
        );
        deleteBotInstallationMock.mockImplementation((_db, input) =>
            Promise.resolve(ok(createInstallation(input.guildId)))
        );
        listBotInstallationGuildIdsMock.mockResolvedValue(ok([]));
    });

    it('upserts current guilds and removes stale guilds in multi mode', async () => {
        listBotInstallationGuildIdsMock.mockResolvedValueOnce(ok(['guild-1', 'stale-guild']));

        const result = await reconcileBotInstallations(testDb, createMultiMode(), {
            guildIds: ['guild-1', 'guild-2', 'guild-2', ' '],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'reconciled',
            recordedGuildIds: ['guild-1', 'guild-2'],
            removedGuildIds: ['stale-guild'],
        });
        expect(upsertBotInstallationMock).toHaveBeenCalledTimes(2);
        expect(deleteBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'stale-guild',
        });
    });

    it('only reconciles the configured guild in single mode', async () => {
        listBotInstallationGuildIdsMock.mockResolvedValueOnce(ok(['target', 'other']));

        const result = await reconcileBotInstallations(testDb, createSingleMode(), {
            guildIds: ['target', 'other'],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'reconciled',
            recordedGuildIds: ['target'],
            removedGuildIds: [],
        });
        expect(upsertBotInstallationMock).toHaveBeenCalledTimes(1);
        expect(upsertBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'target',
        });
        expect(deleteBotInstallationMock).not.toHaveBeenCalled();
    });

    it('removes the configured single guild when it is no longer present', async () => {
        listBotInstallationGuildIdsMock.mockResolvedValueOnce(ok(['target', 'other']));

        const result = await reconcileBotInstallations(testDb, createSingleMode(), {
            guildIds: ['other'],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'reconciled',
            recordedGuildIds: [],
            removedGuildIds: ['target'],
        });
        expect(deleteBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'target',
        });
    });

    it('returns database-error when current guild reconciliation fails', async () => {
        upsertBotInstallationMock.mockResolvedValueOnce(err('database-error'));

        const result = await reconcileBotInstallations(testDb, createMultiMode(), {
            guildIds: ['guild-1'],
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
        deleteBotInstallationMock.mockResolvedValue(ok(createInstallation('target')));

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
        deleteBotInstallationMock.mockResolvedValue(ok(createInstallation('guild-1')));

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

function createInstallation(guildId: string): BotInstallationRecord {
    const timestamp = new Date('2026-06-21T00:00:00.000Z');

    return {
        guildId,
        installedAt: timestamp,
        updatedAt: timestamp,
    };
}

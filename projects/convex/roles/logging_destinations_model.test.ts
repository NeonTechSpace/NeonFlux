import { describe, expect, it } from 'vitest';
import type { GenericId } from 'convex/values';

import {
    buildGuildLoggingDestinationDocument,
    isServerLogEventGroup,
    normalizeLoggingDestinationLimit,
    normalizeLoggingDestinationLookupInput,
    normalizeRequiredGuildId,
    toGuildLoggingDestinationRecord,
} from './logging_destinations_model.js';

const destinationId = 'destination-1' as GenericId<'guildLoggingDestinations'>;

describe('logging destination model', () => {
    it('normalizes logging destination input to the app-facing contract', () => {
        const document = buildGuildLoggingDestinationDocument(
            {
                channelId: ' channel-1 ',
                eventGroup: ' messages ',
                guildId: ' guild-1 ',
            },
            '2026-07-03T08:00:00.000Z'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                channelId: 'channel-1',
                createdAt: '2026-07-03T08:00:00.000Z',
                enabled: true,
                eventGroup: 'messages',
                guildId: 'guild-1',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });

        if (!document.ok) {
            throw new Error('Expected normalized logging destination.');
        }

        expect(toGuildLoggingDestinationRecord({ ...document.value, _id: destinationId })).toEqual({
            channelId: 'channel-1',
            createdAt: '2026-07-03T08:00:00.000Z',
            enabled: true,
            eventGroup: 'messages',
            guildId: 'guild-1',
            id: destinationId,
            updatedAt: '2026-07-03T08:00:00.000Z',
        });
    });

    it('preserves created timestamp on update', () => {
        expect(
            buildGuildLoggingDestinationDocument(
                {
                    channelId: 'channel-2',
                    enabled: false,
                    eventGroup: 'members',
                    guildId: 'guild-1',
                },
                '2026-07-03T08:00:00.000Z',
                {
                    createdAt: '2026-07-02T08:00:00.000Z',
                }
            )
        ).toEqual({
            ok: true,
            value: {
                channelId: 'channel-2',
                createdAt: '2026-07-02T08:00:00.000Z',
                enabled: false,
                eventGroup: 'members',
                guildId: 'guild-1',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });
    });

    it('preserves imported timestamps', () => {
        expect(
            buildGuildLoggingDestinationDocument(
                {
                    channelId: 'channel-1',
                    createdAt: '2026-07-02 09:30:00+02',
                    eventGroup: 'voice',
                    guildId: 'guild-1',
                    updatedAt: '2026-07-03 09:30:00+02',
                },
                '2026-07-03T08:00:00.000Z'
            )
        ).toMatchObject({
            ok: true,
            value: {
                createdAt: '2026-07-02T07:30:00.000Z',
                updatedAt: '2026-07-03T07:30:00.000Z',
            },
        });
    });

    it('rejects invalid logging destination input', () => {
        expect(buildGuildLoggingDestinationDocument({ eventGroup: 'messages' }, '2026-07-03T08:00:00.000Z')).toEqual({
            error: { field: 'guildId', type: 'missing-input' },
            ok: false,
        });
        expect(
            buildGuildLoggingDestinationDocument(
                { eventGroup: 'posting', guildId: 'guild-1' },
                '2026-07-03T08:00:00.000Z'
            )
        ).toEqual({
            error: { field: 'eventGroup', type: 'invalid-value' },
            ok: false,
        });
        expect(
            buildGuildLoggingDestinationDocument(
                { eventGroup: 'messages', guildId: 'guild-1' },
                '2026-07-03T08:00:00.000Z'
            )
        ).toEqual({
            error: { field: 'channelId', type: 'missing-input' },
            ok: false,
        });
        expect(
            buildGuildLoggingDestinationDocument(
                { channelId: 'channel-1', createdAt: 'nope', eventGroup: 'messages', guildId: 'guild-1' },
                '2026-07-03T08:00:00.000Z'
            )
        ).toEqual({
            error: { field: 'createdAt', type: 'invalid-value' },
            ok: false,
        });
    });

    it('normalizes lookup and limit helpers', () => {
        expect(normalizeLoggingDestinationLookupInput({ eventGroup: ' roles ', guildId: ' guild-1 ' })).toEqual({
            ok: true,
            value: {
                eventGroup: 'roles',
                guildId: 'guild-1',
            },
        });
        expect(normalizeLoggingDestinationLookupInput({ guildId: 'guild-1' })).toEqual({
            error: { field: 'eventGroup', type: 'missing-input' },
            ok: false,
        });
        expect(normalizeRequiredGuildId(' guild-1 ')).toEqual({ ok: true, value: 'guild-1' });
        expect(normalizeRequiredGuildId(' ')).toEqual({
            error: { field: 'guildId', type: 'missing-input' },
            ok: false,
        });
        expect(normalizeLoggingDestinationLimit(undefined)).toBe(50);
        expect(normalizeLoggingDestinationLimit(0)).toBe(1);
        expect(normalizeLoggingDestinationLimit(500)).toBe(50);
        expect(isServerLogEventGroup('messages')).toBe(true);
        expect(isServerLogEventGroup('posting')).toBe(false);
    });
});

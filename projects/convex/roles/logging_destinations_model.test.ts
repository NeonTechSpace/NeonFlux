import { describe, expect, it } from 'vitest';

import {
    buildGuildLoggingDestinationDocument,
    isServerLogEventGroup,
    normalizeLoggingDestinationLimit,
    normalizeLoggingDestinationLookupInput,
    normalizeRequiredGuildId,
    toGuildLoggingDestinationRecord,
} from './logging_destinations_model.js';

describe('logging destination model', () => {
    it('normalizes logging destination input to the app-facing contract', () => {
        const document = buildGuildLoggingDestinationDocument(
            {
                channelId: ' channel-1 ',
                eventGroup: ' messages ',
                guildId: ' guild-1 ',
            },
            '2026-07-03T08:00:00.000Z',
            undefined,
            () => 'destination-1'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                channelId: 'channel-1',
                createdAt: '2026-07-03T08:00:00.000Z',
                enabled: true,
                eventGroup: 'messages',
                guildId: 'guild-1',
                legacyId: 'destination-1',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });

        if (!document.ok) {
            throw new Error('Expected normalized logging destination.');
        }

        expect(toGuildLoggingDestinationRecord(document.value)).toEqual({
            channelId: 'channel-1',
            createdAt: '2026-07-03T08:00:00.000Z',
            enabled: true,
            eventGroup: 'messages',
            guildId: 'guild-1',
            id: 'destination-1',
            updatedAt: '2026-07-03T08:00:00.000Z',
        });
    });

    it('preserves legacy identity and created timestamp on update', () => {
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
                    legacyId: 'existing-destination',
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
                legacyId: 'existing-destination',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });
    });

    it('preserves imported timestamps and legacy ids', () => {
        expect(
            buildGuildLoggingDestinationDocument(
                {
                    channelId: 'channel-1',
                    createdAt: '2026-07-02 09:30:00+02',
                    eventGroup: 'voice',
                    guildId: 'guild-1',
                    legacyId: 'legacy-destination',
                    updatedAt: '2026-07-03 09:30:00+02',
                },
                '2026-07-03T08:00:00.000Z'
            )
        ).toMatchObject({
            ok: true,
            value: {
                createdAt: '2026-07-02T07:30:00.000Z',
                legacyId: 'legacy-destination',
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

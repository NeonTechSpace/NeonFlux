import { describe, expect, it } from 'vitest';
import type { GenericId } from 'convex/values';

import {
    buildGuildFeatureSettingDocument,
    normalizeAfterFeature,
    normalizeGuildFeatureSettingLimit,
    normalizeRequiredGuildFeatureString,
    toGuildFeatureSettingRecord,
} from './feature_settings_model.js';

const settingId = 'setting-1' as GenericId<'guildFeatureSettings'>;

describe('guild feature settings model', () => {
    it('normalizes runtime feature setting input', () => {
        const document = buildGuildFeatureSettingDocument(
            {
                config: { prefix: '!' },
                enabled: true,
                feature: ' commands ',
                guildId: ' guild-1 ',
            },
            '2026-07-03T08:00:00.000Z'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                config: { prefix: '!' },
                createdAt: '2026-07-03T08:00:00.000Z',
                enabled: true,
                feature: 'commands',
                guildId: 'guild-1',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });

        if (!document.ok) {
            throw new Error('Expected normalized feature setting.');
        }

        expect(toGuildFeatureSettingRecord({ ...document.value, _id: settingId })).toEqual({
            config: { prefix: '!' },
            createdAt: '2026-07-03T08:00:00.000Z',
            enabled: true,
            feature: 'commands',
            guildId: 'guild-1',
            id: settingId,
            updatedAt: '2026-07-03T08:00:00.000Z',
        });
    });

    it('preserves existing created timestamp on update', () => {
        expect(
            buildGuildFeatureSettingDocument(
                {
                    config: { enabledRoles: [] },
                    enabled: false,
                    feature: 'moderation',
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
                config: { enabledRoles: [] },
                createdAt: '2026-07-02T08:00:00.000Z',
                enabled: false,
                feature: 'moderation',
                guildId: 'guild-1',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });
    });

    it('preserves imported timestamps', () => {
        expect(
            buildGuildFeatureSettingDocument(
                {
                    config: {},
                    createdAt: '2026-07-02 09:30:00+02',
                    feature: 'commands',
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

    it('rejects invalid required fields, timestamps, and config', () => {
        expect(buildGuildFeatureSettingDocument({ feature: 'commands' }, '2026-07-03T08:00:00.000Z')).toEqual({
            error: 'missing-guild-id',
            ok: false,
        });
        expect(buildGuildFeatureSettingDocument({ guildId: 'guild-1' }, '2026-07-03T08:00:00.000Z')).toEqual({
            error: 'missing-feature',
            ok: false,
        });
        expect(
            buildGuildFeatureSettingDocument(
                { config: ['not-record'], feature: 'commands', guildId: 'guild-1' },
                '2026-07-03T08:00:00.000Z'
            )
        ).toEqual({
            error: 'invalid-config',
            ok: false,
        });
        expect(
            buildGuildFeatureSettingDocument(
                { createdAt: 'nope', feature: 'commands', guildId: 'guild-1' },
                '2026-07-03T08:00:00.000Z'
            )
        ).toEqual({
            error: 'invalid-created-at',
            ok: false,
        });
    });

    it('normalizes list helpers', () => {
        expect(normalizeRequiredGuildFeatureString(' guild-1 ', 'missing-guild-id')).toEqual({
            ok: true,
            value: 'guild-1',
        });
        expect(normalizeRequiredGuildFeatureString(' ', 'missing-feature')).toEqual({
            error: 'missing-feature',
            ok: false,
        });
        expect(normalizeAfterFeature(' commands ')).toBe('commands');
        expect(normalizeAfterFeature(' ')).toBeUndefined();
        expect(normalizeGuildFeatureSettingLimit(undefined)).toBe(100);
        expect(normalizeGuildFeatureSettingLimit(0)).toBe(1);
        expect(normalizeGuildFeatureSettingLimit(1_000)).toBe(500);
    });
});

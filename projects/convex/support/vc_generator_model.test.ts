import { describe, expect, it } from 'vitest';

import {
    buildGeneratedVoiceChannelDocument,
    buildVcGeneratorControlPanelDocument,
    buildVcGeneratorControlRequestDocument,
    buildVcGeneratorRuleDocument,
    toGeneratedVoiceChannelRecord,
    toVcGeneratorControlPanelRecord,
    toVcGeneratorControlRequestRecord,
    toVcGeneratorRuleRecord,
} from './vc_generator_model.js';

const now = '2026-06-26T12:00:00.000Z';
const legacyId = () => 'legacy-1';

describe('VC generator model', () => {
    it('builds rule documents with stable legacy ids and record nulls', () => {
        const first = unwrap(
            buildVcGeneratorRuleDocument(
                {
                    categoryId: ' category-1 ',
                    guildId: ' guild-1 ',
                    nameTemplate: ' {user} room ',
                    sourceChannelId: ' voice-source-1 ',
                },
                now,
                undefined,
                legacyId
            )
        );
        const second = unwrap(
            buildVcGeneratorRuleDocument(
                {
                    enabled: false,
                    guildId: 'guild-1',
                    nameTemplate: '{user} lounge',
                    sourceChannelId: 'voice-source-1',
                },
                '2026-06-26T12:05:00.000Z',
                first,
                () => 'legacy-2'
            )
        );

        expect(first).toMatchObject({
            categoryId: 'category-1',
            enabled: true,
            guildId: 'guild-1',
            legacyId: 'legacy-1',
            nameTemplate: '{user} room',
            sourceChannelId: 'voice-source-1',
        });
        expect(second.legacyId).toBe(first.legacyId);
        expect(second.createdAt).toBe(first.createdAt);
        expect(toVcGeneratorRuleRecord(second)).toMatchObject({
            categoryId: null,
            enabled: false,
            id: 'legacy-1',
        });
    });

    it('builds generated channel documents and rejects invalid status', () => {
        const generated = unwrap(
            buildGeneratedVoiceChannelDocument(
                {
                    channelId: 'generated-1',
                    guildId: 'guild-1',
                    ownerUserId: 'user-1',
                    ruleId: 'rule-1',
                },
                now,
                undefined,
                legacyId
            )
        );
        const invalid = buildGeneratedVoiceChannelDocument(
            { channelId: 'generated-1', guildId: 'guild-1', status: 'sleeping' },
            now
        );

        expect(toGeneratedVoiceChannelRecord(generated)).toMatchObject({
            id: 'legacy-1',
            lastSeenAt: now,
            ownerUserId: 'user-1',
            ruleId: 'rule-1',
            status: 'active',
        });
        expect(invalid).toStrictEqual({ error: { field: 'status', type: 'invalid-value' }, ok: false });
    });

    it('builds control panels with synced and stale timestamps', () => {
        const active = unwrap(
            buildVcGeneratorControlPanelDocument(
                {
                    channelId: 'panel-channel-1',
                    guildId: 'guild-1',
                    messageId: 'panel-message-1',
                    ruleId: 'rule-1',
                    synced: true,
                },
                now,
                undefined,
                legacyId
            )
        );
        const stale = unwrap(
            buildVcGeneratorControlPanelDocument(
                {
                    channelId: 'panel-channel-2',
                    guildId: 'guild-1',
                    ruleId: 'rule-1',
                    status: 'stale',
                },
                '2026-06-26T12:05:00.000Z',
                active,
                () => 'legacy-2'
            )
        );

        expect(toVcGeneratorControlPanelRecord(active)).toMatchObject({
            id: 'legacy-1',
            lastSyncedAt: now,
            messageId: 'panel-message-1',
            ruleId: 'rule-1',
            staleAt: null,
            status: 'active',
        });
        expect(toVcGeneratorControlPanelRecord(stale)).toMatchObject({
            id: 'legacy-1',
            lastSyncedAt: null,
            messageId: null,
            ruleId: 'rule-1',
            staleAt: '2026-06-26T12:05:00.000Z',
            status: 'stale',
        });
    });

    it('builds control requests and rejects invalid actions', () => {
        const request = unwrap(
            buildVcGeneratorControlRequestDocument(
                {
                    controlAction: 'rename',
                    expiresAt: '2026-06-26T12:10:00.000Z',
                    generatedChannelId: 'generated-1',
                    guildId: 'guild-1',
                    panelChannelId: 'panel-channel-1',
                    requesterUserId: 'user-1',
                    targetChannelId: 'target-1',
                },
                now,
                legacyId
            )
        );
        const invalid = buildVcGeneratorControlRequestDocument(
            {
                controlAction: 'dance',
                expiresAt: '2026-06-26T12:10:00.000Z',
                generatedChannelId: 'generated-1',
                guildId: 'guild-1',
                panelChannelId: 'panel-channel-1',
                requesterUserId: 'user-1',
                targetChannelId: 'target-1',
            },
            now
        );

        expect(toVcGeneratorControlRequestRecord(request)).toMatchObject({
            completedAt: null,
            controlAction: 'rename',
            errorMessage: null,
            generatedChannelId: 'generated-1',
            id: 'legacy-1',
            promptMessageId: null,
            status: 'pending',
            value: null,
        });
        expect(invalid).toStrictEqual({
            error: { field: 'controlAction', type: 'invalid-value' },
            ok: false,
        });
    });
});

function unwrap<TValue>(result: { ok: true; value: TValue } | { error: unknown; ok: false }): TValue {
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
}

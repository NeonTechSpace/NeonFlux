import { describe, expect, it } from 'vitest';
import type { GenericId } from 'convex/values';

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
const ruleId = 'rule-1' as GenericId<'vcGeneratorRules'>;
const generatedChannelId = 'generated-1' as GenericId<'generatedVoiceChannels'>;
const controlPanelId = 'control-panel-1' as GenericId<'vcGeneratorControlPanels'>;
const controlRequestId = 'control-request-1' as GenericId<'vcGeneratorControlRequests'>;

describe('VC generator model', () => {
    it('builds rule documents with stable creation metadata and record nulls', () => {
        const first = unwrap(
            buildVcGeneratorRuleDocument(
                {
                    categoryId: ' category-1 ',
                    guildId: ' guild-1 ',
                    nameTemplate: ' {user} room ',
                    sourceChannelId: ' voice-source-1 ',
                },
                now
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
                first
            )
        );

        expect(first).toMatchObject({
            categoryId: 'category-1',
            enabled: true,
            guildId: 'guild-1',
            nameTemplate: '{user} room',
            sourceChannelId: 'voice-source-1',
        });
        expect(second.createdAt).toBe(first.createdAt);
        expect(toVcGeneratorRuleRecord({ ...second, _id: ruleId })).toMatchObject({
            categoryId: null,
            enabled: false,
            id: ruleId,
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
                now
            )
        );
        const invalid = buildGeneratedVoiceChannelDocument(
            { channelId: 'generated-1', guildId: 'guild-1', status: 'sleeping' },
            now
        );

        expect(toGeneratedVoiceChannelRecord({ ...generated, _id: generatedChannelId })).toMatchObject({
            id: generatedChannelId,
            lastSeenAt: now,
            ownerUserId: 'user-1',
            ruleId,
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
                now
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
                active
            )
        );

        expect(toVcGeneratorControlPanelRecord({ ...active, _id: controlPanelId })).toMatchObject({
            id: controlPanelId,
            lastSyncedAt: now,
            messageId: 'panel-message-1',
            ruleId,
            staleAt: null,
            status: 'active',
        });
        expect(toVcGeneratorControlPanelRecord({ ...stale, _id: controlPanelId })).toMatchObject({
            id: controlPanelId,
            lastSyncedAt: null,
            messageId: null,
            ruleId,
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
                now
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

        expect(toVcGeneratorControlRequestRecord({ ...request, _id: controlRequestId })).toMatchObject({
            completedAt: null,
            controlAction: 'rename',
            errorMessage: null,
            generatedChannelId,
            id: controlRequestId,
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

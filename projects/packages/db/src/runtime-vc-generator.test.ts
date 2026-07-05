import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    deleteVcGeneratorRule,
    findGeneratedVoiceChannelByChannelId,
    findVcGeneratorControlPanelByMessageId,
    findVcGeneratorControlPanelByRuleId,
    findVcGeneratorRuleBySourceChannelId,
    listGeneratedVoiceChannelsByGuildId,
    listVcGeneratorControlPanelsByGuildId,
    listVcGeneratorRulesByGuildId,
    updateGeneratedVoiceChannelStatus,
    upsertGeneratedVoiceChannel,
    upsertVcGeneratorControlPanel,
    upsertVcGeneratorRule,
} from './runtime-vc-generator.js';
import {
    createVcGeneratorControlRequest,
    expirePendingVcGeneratorControlRequests,
    findActiveGeneratedVoiceChannelByOwner,
    findPendingVcGeneratorControlRequest,
    updateVcGeneratorControlRequest,
} from './runtime-vc-generator-control-requests.js';

const rule = {
    categoryId: 'category-1',
    config: { bitrate: 64_000 },
    createdAt: '2026-07-03T08:00:00.000Z',
    enabled: true,
    guildId: 'guild-1',
    id: 'rule-1',
    nameTemplate: '{user} room',
    sourceChannelId: 'source-voice-1',
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const generatedChannel = {
    channelId: 'generated-voice-1',
    createdAt: '2026-07-03T08:05:00.000Z',
    guildId: 'guild-1',
    id: 'generated-row-1',
    lastSeenAt: '2026-07-03T09:05:00.000Z',
    ownerUserId: 'user-1',
    ruleId: 'rule-1',
    status: 'active',
    updatedAt: '2026-07-03T09:05:00.000Z',
};
const panel = {
    channelId: 'panel-channel-1',
    config: { controls: true },
    controlMode: 'reaction',
    createdAt: '2026-07-03T08:10:00.000Z',
    guildId: 'guild-1',
    id: 'panel-1',
    lastSyncedAt: '2026-07-03T09:10:00.000Z',
    messageId: 'panel-message-1',
    ruleId: 'rule-1',
    staleAt: null,
    status: 'active',
    updatedAt: '2026-07-03T09:10:00.000Z',
};
const controlRequest = {
    completedAt: null,
    controlAction: 'rename',
    createdAt: '2026-07-03T08:15:00.000Z',
    errorMessage: null,
    expiresAt: '2026-07-03T08:20:00.000Z',
    generatedChannelId: 'generated-row-1',
    guildId: 'guild-1',
    id: 'request-1',
    panelChannelId: 'panel-channel-1',
    promptMessageId: 'prompt-message-1',
    requesterUserId: 'user-1',
    status: 'pending',
    targetChannelId: 'generated-voice-1',
    updatedAt: '2026-07-03T08:15:00.000Z',
    value: null,
};
type TestControlRequestRecord = Omit<typeof controlRequest, 'completedAt' | 'errorMessage' | 'value'> & {
    completedAt: string | null;
    errorMessage: string | null;
    value: string | null;
};

describe('Convex VC generator database functions', () => {
    it('routes rules, generated channels, and control panels through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [rule, generatedChannel, { ...generatedChannel, status: 'deleted' }, panel, rule],
            queryResults: [[rule], rule, generatedChannel, [generatedChannel], panel, panel, [panel]],
        });

        const upsertedRule = await upsertVcGeneratorRule(db, {
            categoryId: ' category-1 ',
            config: rule.config,
            enabled: true,
            guildId: ' guild-1 ',
            nameTemplate: ' {user} room ',
            sourceChannelId: ' source-voice-1 ',
        });
        const listedRules = await listVcGeneratorRulesByGuildId(db, { enabledOnly: true, guildId: ' guild-1 ' });
        const foundRule = await findVcGeneratorRuleBySourceChannelId(db, {
            enabledOnly: true,
            guildId: ' guild-1 ',
            sourceChannelId: ' source-voice-1 ',
        });
        const upsertedChannel = await upsertGeneratedVoiceChannel(db, {
            channelId: ' generated-voice-1 ',
            guildId: ' guild-1 ',
            ownerUserId: ' user-1 ',
            ruleId: ' rule-1 ',
            status: 'active',
        });
        const foundChannel = await findGeneratedVoiceChannelByChannelId(db, { channelId: ' generated-voice-1 ' });
        const listedChannels = await listGeneratedVoiceChannelsByGuildId(db, {
            guildId: ' guild-1 ',
            ruleId: ' rule-1 ',
            status: 'active',
        });
        const deletedChannel = await updateGeneratedVoiceChannelStatus(db, {
            channelId: ' generated-voice-1 ',
            guildId: ' guild-1 ',
            status: 'deleted',
        });
        const upsertedPanel = await upsertVcGeneratorControlPanel(db, {
            channelId: ' panel-channel-1 ',
            config: panel.config,
            controlMode: 'reaction',
            guildId: ' guild-1 ',
            messageId: ' panel-message-1 ',
            ruleId: ' rule-1 ',
            status: 'active',
            synced: true,
        });
        const panelByMessage = await findVcGeneratorControlPanelByMessageId(db, {
            guildId: ' guild-1 ',
            messageId: ' panel-message-1 ',
        });
        const panelByRule = await findVcGeneratorControlPanelByRuleId(db, {
            guildId: ' guild-1 ',
            ruleId: ' rule-1 ',
        });
        const listedPanels = await listVcGeneratorControlPanelsByGuildId(db, {
            guildId: ' guild-1 ',
            limit: 10,
            status: 'active',
        });
        const deletedRule = await deleteVcGeneratorRule(db, {
            guildId: ' guild-1 ',
            sourceChannelId: ' source-voice-1 ',
        });

        expect(upsertedRule._unsafeUnwrap()).toStrictEqual(toRuleRecord(rule));
        expect(listedRules._unsafeUnwrap()).toStrictEqual([toRuleRecord(rule)]);
        expect(foundRule._unsafeUnwrap()).toStrictEqual(toRuleRecord(rule));
        expect(upsertedChannel._unsafeUnwrap()).toStrictEqual(toGeneratedChannelRecord(generatedChannel));
        expect(foundChannel._unsafeUnwrap()).toStrictEqual(toGeneratedChannelRecord(generatedChannel));
        expect(listedChannels._unsafeUnwrap()).toStrictEqual([toGeneratedChannelRecord(generatedChannel)]);
        expect(deletedChannel._unsafeUnwrap()).toMatchObject({ status: 'deleted' });
        expect(upsertedPanel._unsafeUnwrap()).toStrictEqual(toPanelRecord(panel));
        expect(panelByMessage._unsafeUnwrap()).toStrictEqual(toPanelRecord(panel));
        expect(panelByRule._unsafeUnwrap()).toStrictEqual(toPanelRecord(panel));
        expect(listedPanels._unsafeUnwrap()).toStrictEqual([toPanelRecord(panel)]);
        expect(deletedRule._unsafeUnwrap()).toStrictEqual(toRuleRecord(rule));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            categoryId: 'category-1',
            config: rule.config,
            enabled: true,
            guildId: 'guild-1',
            nameTemplate: '{user} room',
            sourceChannelId: 'source-voice-1',
        });
        expect(db.client.queryCalls[0]?.args).toStrictEqual({
            enabledOnly: true,
            guildId: 'guild-1',
            limit: 500,
        });
    });

    it('routes control requests through Convex with Date conversion', async () => {
        const appliedRequest = {
            ...controlRequest,
            completedAt: '2026-07-03T08:18:00.000Z',
            status: 'applied',
            updatedAt: '2026-07-03T08:18:00.000Z',
            value: 'New room name',
        };
        const expiredRequest = {
            ...controlRequest,
            completedAt: '2026-07-03T08:30:00.000Z',
            errorMessage: 'expired-by-maintenance',
            status: 'expired',
            updatedAt: '2026-07-03T08:30:00.000Z',
        };
        const db = createConvexDb({
            mutationResults: [controlRequest, appliedRequest, [expiredRequest]],
            queryResults: [generatedChannel, controlRequest],
        });

        const activeChannel = await findActiveGeneratedVoiceChannelByOwner(db, {
            guildId: ' guild-1 ',
            ownerUserId: ' user-1 ',
            ruleId: ' rule-1 ',
        });
        const created = await createVcGeneratorControlRequest(db, {
            controlAction: 'rename',
            expiresAt: new Date('2026-07-03T08:20:00.000Z'),
            generatedChannelId: ' generated-row-1 ',
            guildId: ' guild-1 ',
            panelChannelId: ' panel-channel-1 ',
            promptMessageId: ' prompt-message-1 ',
            requesterUserId: ' user-1 ',
            targetChannelId: ' generated-voice-1 ',
        });
        const pending = await findPendingVcGeneratorControlRequest(db, {
            guildId: ' guild-1 ',
            panelChannelId: ' panel-channel-1 ',
            requesterUserId: ' user-1 ',
        });
        const updated = await updateVcGeneratorControlRequest(db, {
            requestId: ' request-1 ',
            status: 'applied',
            value: ' New room name ',
        });
        const expired = await expirePendingVcGeneratorControlRequests(db, {
            limit: 10,
            now: new Date('2026-07-03T08:30:00.000Z'),
        });

        expect(activeChannel._unsafeUnwrap()).toStrictEqual(toGeneratedChannelRecord(generatedChannel));
        expect(created._unsafeUnwrap()).toStrictEqual(toControlRequestRecord(controlRequest));
        expect(pending._unsafeUnwrap()).toStrictEqual(toControlRequestRecord(controlRequest));
        expect(updated._unsafeUnwrap()).toStrictEqual(toControlRequestRecord(appliedRequest));
        expect(expired._unsafeUnwrap()).toStrictEqual([toControlRequestRecord(expiredRequest)]);
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            controlAction: 'rename',
            expiresAt: '2026-07-03T08:20:00.000Z',
            generatedChannelId: 'generated-row-1',
            guildId: 'guild-1',
            panelChannelId: 'panel-channel-1',
            promptMessageId: 'prompt-message-1',
            requesterUserId: 'user-1',
            targetChannelId: 'generated-voice-1',
        });
        expect(db.client.mutationCalls[2]?.args).toStrictEqual({
            limit: 10,
            now: '2026-07-03T08:30:00.000Z',
        });
    });

    it('maps validation and missing Convex records to existing repository errors', async () => {
        const db = createConvexDb({
            mutationResults: [null],
            queryResults: [null],
        });

        const missingName = await upsertVcGeneratorRule(db, {
            guildId: 'guild-1',
            nameTemplate: ' ',
            sourceChannelId: 'source-voice-1',
        });
        const invalidGeneratedStatus = await updateGeneratedVoiceChannelStatus(db, {
            channelId: 'generated-voice-1',
            guildId: 'guild-1',
            status: 'invalid',
        });
        const invalidPanelStatus = await listVcGeneratorControlPanelsByGuildId(db, {
            guildId: 'guild-1',
            status: 'invalid',
        });
        const invalidControlAction = await createVcGeneratorControlRequest(db, {
            controlAction: 'invalid',
            expiresAt: new Date('2026-07-03T08:20:00.000Z'),
            generatedChannelId: 'generated-row-1',
            guildId: 'guild-1',
            panelChannelId: 'panel-channel-1',
            requesterUserId: 'user-1',
            targetChannelId: 'generated-voice-1',
        });
        const invalidExpiry = await createVcGeneratorControlRequest(db, {
            controlAction: 'rename',
            expiresAt: new Date(Number.NaN),
            generatedChannelId: 'generated-row-1',
            guildId: 'guild-1',
            panelChannelId: 'panel-channel-1',
            requesterUserId: 'user-1',
            targetChannelId: 'generated-voice-1',
        });
        const missingPanel = await findVcGeneratorControlPanelByMessageId(db, {
            guildId: 'guild-1',
            messageId: 'panel-message-1',
        });
        const missingUpdate = await updateVcGeneratorControlRequest(db, {
            requestId: 'request-1',
            status: 'applied',
        });

        expect(missingName._unsafeUnwrapErr()).toStrictEqual({ field: 'nameTemplate', type: 'missing-input' });
        expect(invalidGeneratedStatus._unsafeUnwrapErr()).toStrictEqual({ field: 'status', type: 'invalid-value' });
        expect(invalidPanelStatus._unsafeUnwrapErr()).toStrictEqual({ field: 'status', type: 'invalid-value' });
        expect(invalidControlAction._unsafeUnwrapErr()).toStrictEqual({
            field: 'controlAction',
            type: 'invalid-value',
        });
        expect(invalidExpiry._unsafeUnwrapErr()).toStrictEqual({ field: 'expiresAt', type: 'invalid-value' });
        expect(missingPanel._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(missingUpdate._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });
});

function toRuleRecord(record: typeof rule) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toGeneratedChannelRecord(record: typeof generatedChannel) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        lastSeenAt: new Date(record.lastSeenAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toPanelRecord(record: typeof panel) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        lastSyncedAt: record.lastSyncedAt ? new Date(record.lastSyncedAt) : null,
        staleAt: null,
        updatedAt: new Date(record.updatedAt),
    };
}

function toControlRequestRecord(record: TestControlRequestRecord) {
    return {
        ...record,
        completedAt: record.completedAt ? new Date(record.completedAt) : null,
        createdAt: new Date(record.createdAt),
        expiresAt: new Date(record.expiresAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryErrors?: Error[];
    queryResults?: unknown[];
}): ConvexDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationErrors = [...(input.mutationErrors ?? [])];
    const mutationResults = [...(input.mutationResults ?? [])];
    const queryErrors = [...(input.queryErrors ?? [])];
    const queryResults = [...(input.queryResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; reference: unknown }>,
        mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();

            if (error) return Promise.reject(error);

            return Promise.resolve(mutationResults.shift());
        },
        query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            const error = queryErrors.shift();

            if (error) return Promise.reject(error);

            return Promise.resolve(queryResults.shift());
        },
    };

    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}

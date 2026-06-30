import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import { upsertGuild } from './guilds.js';
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
} from './vc-generator.js';

let testDatabase: TestDatabase | undefined;

beforeAll(async () => {
    testDatabase = await createTestDatabase();
});

beforeEach(async () => {
    await resetTestDatabase();
});

afterAll(async () => {
    await testDatabase?.close();
    testDatabase = undefined;
});

describe('VC generator repository', () => {
    beforeEach(async () => {
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
    });

    it('upserts, lists, and finds guild-scoped generator rules', async () => {
        const first = await expectOk(
            upsertVcGeneratorRule(getDb(), {
                guildId: 'guild-1',
                sourceChannelId: 'voice-source-1',
                categoryId: 'category-1',
                nameTemplate: '{user} room',
                enabled: true,
            })
        );
        const second = await expectOk(
            upsertVcGeneratorRule(getDb(), {
                guildId: 'guild-1',
                sourceChannelId: 'voice-source-1',
                categoryId: 'category-2',
                nameTemplate: '{user} lounge',
                enabled: false,
            })
        );
        await expectOk(
            upsertVcGeneratorRule(getDb(), {
                guildId: 'guild-2',
                sourceChannelId: 'voice-source-1',
                nameTemplate: 'Other guild',
            })
        );

        const allRules = await expectOk(listVcGeneratorRulesByGuildId(getDb(), { guildId: 'guild-1' }));
        const enabledRules = await expectOk(
            listVcGeneratorRulesByGuildId(getDb(), { guildId: 'guild-1', enabledOnly: true })
        );
        const found = await expectOk(
            findVcGeneratorRuleBySourceChannelId(getDb(), {
                guildId: 'guild-1',
                sourceChannelId: 'voice-source-1',
            })
        );
        const enabledOnlyFind = await findVcGeneratorRuleBySourceChannelId(getDb(), {
            guildId: 'guild-1',
            sourceChannelId: 'voice-source-1',
            enabledOnly: true,
        });

        expect(second.id).toBe(first.id);
        expect(allRules).toHaveLength(1);
        expect(allRules[0]).toMatchObject({
            guildId: 'guild-1',
            sourceChannelId: 'voice-source-1',
            categoryId: 'category-2',
            nameTemplate: '{user} lounge',
            enabled: false,
        });
        expect(enabledRules).toHaveLength(0);
        expect(found.id).toBe(first.id);
        expect(enabledOnlyFind.isErr()).toBe(true);
        expect(enabledOnlyFind._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('tracks generated voice channels and status transitions', async () => {
        const rule = await createRule();
        const generated = await expectOk(
            upsertGeneratedVoiceChannel(getDb(), {
                guildId: 'guild-1',
                ruleId: rule.id,
                channelId: 'generated-1',
                ownerUserId: 'user-1',
            })
        );
        const updated = await expectOk(
            upsertGeneratedVoiceChannel(getDb(), {
                guildId: 'guild-1',
                ruleId: rule.id,
                channelId: 'generated-1',
                ownerUserId: 'user-2',
                status: 'active',
            })
        );
        const active = await expectOk(
            listGeneratedVoiceChannelsByGuildId(getDb(), {
                guildId: 'guild-1',
                ruleId: rule.id,
                status: 'active',
            })
        );
        const deleted = await expectOk(
            updateGeneratedVoiceChannelStatus(getDb(), {
                guildId: 'guild-1',
                channelId: 'generated-1',
                status: 'deleted',
            })
        );

        expect(updated.id).toBe(generated.id);
        expect(updated.ownerUserId).toBe('user-2');
        expect(updated.ruleId).toBe(rule.id);
        expect(active).toHaveLength(1);
        expect(deleted.status).toBe('deleted');
    });

    it('records and looks up control panels by rule and message', async () => {
        const rule = await createRule();
        const panel = await expectOk(
            upsertVcGeneratorControlPanel(getDb(), {
                guildId: 'guild-1',
                ruleId: rule.id,
                channelId: 'panel-channel-1',
                messageId: 'panel-message-1',
                synced: true,
            })
        );
        const updated = await expectOk(
            upsertVcGeneratorControlPanel(getDb(), {
                guildId: 'guild-1',
                ruleId: rule.id,
                channelId: 'panel-channel-2',
                messageId: 'panel-message-2',
                status: 'stale',
            })
        );
        const byRule = await expectOk(
            findVcGeneratorControlPanelByRuleId(getDb(), {
                guildId: 'guild-1',
                ruleId: rule.id,
            })
        );
        const byMessage = await expectOk(
            findVcGeneratorControlPanelByMessageId(getDb(), {
                guildId: 'guild-1',
                messageId: 'panel-message-2',
            })
        );
        const stalePanels = await expectOk(
            listVcGeneratorControlPanelsByGuildId(getDb(), {
                guildId: 'guild-1',
                status: 'stale',
            })
        );

        expect(updated.id).toBe(panel.id);
        expect(byRule.messageId).toBe('panel-message-2');
        expect(byMessage.ruleId).toBe(rule.id);
        expect(stalePanels).toHaveLength(1);
        expect(stalePanels[0]?.staleAt).toBeInstanceOf(Date);
    });

    it('cascades control panels and preserves generated channel history when deleting a rule', async () => {
        const rule = await createRule();
        await expectOk(
            upsertVcGeneratorControlPanel(getDb(), {
                guildId: 'guild-1',
                ruleId: rule.id,
                channelId: 'panel-channel-1',
                messageId: 'panel-message-1',
            })
        );
        await expectOk(
            upsertGeneratedVoiceChannel(getDb(), {
                guildId: 'guild-1',
                ruleId: rule.id,
                channelId: 'generated-1',
                ownerUserId: 'user-1',
            })
        );

        const deletedRule = await expectOk(
            deleteVcGeneratorRule(getDb(), {
                guildId: 'guild-1',
                sourceChannelId: 'voice-source-1',
            })
        );
        const panelLookup = await findVcGeneratorControlPanelByRuleId(getDb(), {
            guildId: 'guild-1',
            ruleId: rule.id,
        });
        const generated = await expectOk(
            findGeneratedVoiceChannelByChannelId(getDb(), {
                channelId: 'generated-1',
            })
        );

        expect(deletedRule.id).toBe(rule.id);
        expect(panelLookup.isErr()).toBe(true);
        expect(panelLookup._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(generated.ruleId).toBeNull();
    });

    it('rejects invalid repository input before writing', async () => {
        const invalidRule = await upsertVcGeneratorRule(getDb(), {
            guildId: 'guild-1',
            sourceChannelId: '',
            nameTemplate: '{user}',
        });
        const invalidGeneratedStatus = await updateGeneratedVoiceChannelStatus(getDb(), {
            guildId: 'guild-1',
            channelId: 'generated-1',
            status: 'sleeping',
        });
        const invalidPanelStatus = await upsertVcGeneratorControlPanel(getDb(), {
            guildId: 'guild-1',
            ruleId: 'rule-1',
            channelId: 'channel-1',
            status: 'sleeping',
        });

        expect(invalidRule.isErr()).toBe(true);
        expect(invalidRule._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'sourceChannelId',
        });
        expect(invalidGeneratedStatus.isErr()).toBe(true);
        expect(invalidGeneratedStatus._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'status',
        });
        expect(invalidPanelStatus.isErr()).toBe(true);
        expect(invalidPanelStatus._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'status',
        });
    });
});

async function createRule() {
    return expectOk(
        upsertVcGeneratorRule(getDb(), {
            guildId: 'guild-1',
            sourceChannelId: 'voice-source-1',
            categoryId: 'category-1',
            nameTemplate: '{user} room',
            enabled: true,
        })
    );
}

async function expectOk<TValue>(promise: Promise<{ isOk(): boolean; _unsafeUnwrap(): TValue }>): Promise<TValue> {
    const result = await promise;

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

async function resetTestDatabase(): Promise<void> {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    await testDatabase.reset();
}

function getDb(): Parameters<typeof upsertGuild>[0] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = PgliteTestDatabase;

function createTestDatabase(): Promise<TestDatabase> {
    return createPgliteTestDatabase('vc-generator');
}

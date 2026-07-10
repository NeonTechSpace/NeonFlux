import { describe, expect, it } from 'vitest';

import {
    buildOperationDocument,
    finishAssignmentSnapshotPass,
    normalizeDesiredConfig,
} from './reaction_role_operation_model.js';

const baseConfig = {
    enabled: true,
    generateOverview: false,
    messageContent: ' Choose a role. ',
    messageEmbeds: [],
    mode: 'normal' as const,
    options: [{ emojiKey: ' 🎉 ', position: 0, roleId: ' role-1 ' }],
};

describe('reaction-role operation model', () => {
    it('normalizes owned config and rejects ambiguous role mappings', () => {
        expect(normalizeDesiredConfig(baseConfig)).toStrictEqual({
            ...baseConfig,
            messageContent: 'Choose a role.',
            options: [{ emojiKey: '🎉', position: 0, roleId: 'role-1' }],
        });
        expect(() =>
            normalizeDesiredConfig({
                ...baseConfig,
                options: [
                    { emojiKey: '🎉', position: 0, roleId: 'role-1' },
                    { emojiKey: '🚀', position: 1, roleId: 'role-1' },
                ],
            })
        ).toThrow('duplicate-role');
    });

    it('permits an empty delete snapshot but not an empty publish config', () => {
        const common = {
            actorUserId: ' admin-1 ',
            channelId: ' channel-1 ',
            desiredConfig: { ...baseConfig, options: [] },
            guildId: ' guild-1 ',
            idempotencyKey: ' request-1 ',
            now: '2026-07-10T08:00:00.000Z',
            requestHash: ' hash-1 ',
        };

        expect(buildOperationDocument({ ...common, type: 'delete' })).toMatchObject({
            actorUserId: 'admin-1',
            snapshotComplete: false,
            stage: 'snapshot',
            type: 'delete',
        });
        expect(() => buildOperationDocument({ ...common, type: 'publish' })).toThrow('invalid-options');
    });

    it('requires a quiet verification sweep before external finalization', () => {
        expect(finishAssignmentSnapshotPass({ processedCount: 0, stage: 'snapshot', totalCount: 0 })).toMatchObject({
            snapshotComplete: false,
            stage: 'verify',
        });
        expect(finishAssignmentSnapshotPass({ processedCount: 3, stage: 'verify', totalCount: 4 })).toMatchObject({
            snapshotComplete: true,
            stage: 'reconcile',
        });
        expect(finishAssignmentSnapshotPass({ processedCount: 4, stage: 'verify', totalCount: 4 })).toMatchObject({
            snapshotComplete: true,
            stage: 'message',
        });
    });
});

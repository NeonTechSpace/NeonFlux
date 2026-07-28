import { describe, expect, it } from 'vitest';

import {
    getReactionRoleEmojiKey,
    isStandardReactionEmoji,
    parseReactionRolePanelDraft,
    projectReactionRoleMessage,
    type ReactionRolePanelDraft,
} from './reaction-role-panel.js';

const options: ReactionRolePanelDraft['options'] = [
    {
        emoji: { kind: 'unicode', value: '📣' },
        id: 'announcements',
        roleId: 'role-1',
        roleName: 'Announcements',
    },
    {
        emoji: { animated: false, id: 'emoji-2', kind: 'custom', name: 'gaming' },
        id: 'gaming',
        roleId: 'role-2',
        roleName: 'Gaming',
    },
];

describe('reaction-role message projection', () => {
    it('respects a manual marker in content', () => {
        const result = projectReactionRoleMessage({
            content: 'Choose:\n{roles}\nThanks',
            embeds: [],
            mode: 'independent',
            options,
        });

        expect(result.isOk()).toBe(true);
        if (result.isErr()) return;
        expect(result.value.markerPlacement).toBe('content');
        expect(result.value.message.content).toBe('Choose:\n<@&role-1> — 📣\n<@&role-2> — <:gaming:emoji-2>\nThanks');
    });

    it('defaults to the embed when content and an embed are present', () => {
        const result = projectReactionRoleMessage({
            content: 'Header',
            embeds: [{ description: 'Body' }],
            mode: 'exclusive',
            options,
        });

        expect(result.isOk()).toBe(true);
        if (result.isErr()) return;
        expect(result.value.markerPlacement).toBe('embed');
        expect(result.value.message.content).toBe('Header');
        expect(result.value.message.embeds[0]?.description).toContain('<@&role-1> — 📣');
    });

    it('blocks duplicate markers and validates expanded provider limits', () => {
        const duplicate = projectReactionRoleMessage({
            content: '{roles}',
            embeds: [{ description: '{roles}' }],
            mode: 'independent',
            options,
        });
        expect(duplicate.isErr() && duplicate.error.code).toBe('duplicate-marker');

        const tooLong = projectReactionRoleMessage({
            content: 'a'.repeat(3_990),
            embeds: [],
            mode: 'independent',
            options,
        });
        expect(tooLong.isErr() && tooLong.error.code).toBe('invalid-message');
    });

    it('rejects duplicate roles and emoji', () => {
        const duplicateRole = parseReactionRolePanelDraft({
            embeds: [],
            mode: 'independent',
            options: [options[0], { ...options[1], roleId: 'role-1' }],
        });
        expect(duplicateRole.isErr() && duplicateRole.error.code).toBe('duplicate-role');

        const duplicateEmoji = parseReactionRolePanelDraft({
            embeds: [],
            mode: 'independent',
            options: [options[0], { ...options[1], emoji: { kind: 'unicode', value: '📣' } }],
        });
        expect(duplicateEmoji.isErr() && duplicateEmoji.error.code).toBe('duplicate-emoji');
    });

    it('keys custom emoji by stable ID', () => {
        expect(getReactionRoleEmojiKey({ animated: false, id: '1', kind: 'custom', name: 'old' })).toBe(
            getReactionRoleEmojiKey({ animated: true, id: '1', kind: 'custom', name: 'new' })
        );
    });
});

describe('standard reaction emoji validation', () => {
    it('accepts one emoji grapheme and rejects text or multiple emoji', () => {
        expect(isStandardReactionEmoji('✨')).toBe(true);
        expect(isStandardReactionEmoji('👩🏽‍💻')).toBe(true);
        expect(isStandardReactionEmoji('🇩🇪')).toBe(true);
        expect(isStandardReactionEmoji('1️⃣')).toBe(true);
        expect(isStandardReactionEmoji('A')).toBe(false);
        expect(isStandardReactionEmoji('✨🎉')).toBe(false);
    });
});

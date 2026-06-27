import { describe, expect, it } from 'vitest';

import {
    getServerLogEventGroupForEventType,
    isServerLogEventGroup,
    SERVER_LOG_EVENT_GROUPS,
} from './server-event-logging.js';

describe('server event logging catalog', () => {
    it('maps supported Fluxer events to dashboard logging groups', () => {
        expect(getServerLogEventGroupForEventType('message.deleted')).toBe('messages');
        expect(getServerLogEventGroupForEventType('member.joined')).toBe('members');
        expect(getServerLogEventGroupForEventType('ban.added')).toBe('moderation');
        expect(getServerLogEventGroupForEventType('role.updated')).toBe('roles');
        expect(getServerLogEventGroupForEventType('channel.deleted')).toBe('channels');
        expect(getServerLogEventGroupForEventType('voice_state.updated')).toBe('voice');
    });

    it('keeps unsupported or too-noisy events out of logging groups', () => {
        expect(getServerLogEventGroupForEventType('message.created')).toBeUndefined();
        expect(isServerLogEventGroup('posting')).toBe(false);
        expect(SERVER_LOG_EVENT_GROUPS.map((group) => group.id)).toStrictEqual([
            'messages',
            'members',
            'moderation',
            'roles',
            'channels',
            'voice',
        ]);
    });
});

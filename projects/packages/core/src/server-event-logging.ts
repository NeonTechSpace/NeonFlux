export type ServerLogEventGroup = 'messages' | 'members' | 'moderation' | 'roles' | 'channels' | 'voice';

export type ServerLogEventType =
    | 'message.updated'
    | 'message.deleted'
    | 'member.joined'
    | 'member.updated'
    | 'member.left'
    | 'ban.added'
    | 'ban.removed'
    | 'role.created'
    | 'role.updated'
    | 'role.deleted'
    | 'channel.created'
    | 'channel.updated'
    | 'channel.deleted'
    | 'voice_state.updated';

export type ServerLogEventGroupDefinition = {
    id: ServerLogEventGroup;
    label: string;
    description: string;
    eventTypes: readonly ServerLogEventType[];
};

export const SERVER_LOG_EVENT_GROUPS = [
    {
        id: 'messages',
        label: 'Messages',
        description: 'Message edits and deletions.',
        eventTypes: ['message.updated', 'message.deleted'],
    },
    {
        id: 'members',
        label: 'Members',
        description: 'Member joins, updates, and leaves.',
        eventTypes: ['member.joined', 'member.updated', 'member.left'],
    },
    {
        id: 'moderation',
        label: 'Moderation',
        description: 'Ban and unban events.',
        eventTypes: ['ban.added', 'ban.removed'],
    },
    {
        id: 'roles',
        label: 'Roles',
        description: 'Role creation, updates, and deletion.',
        eventTypes: ['role.created', 'role.updated', 'role.deleted'],
    },
    {
        id: 'channels',
        label: 'Channels',
        description: 'Channel creation, updates, and deletion.',
        eventTypes: ['channel.created', 'channel.updated', 'channel.deleted'],
    },
    {
        id: 'voice',
        label: 'Voice',
        description: 'Voice channel movement and disconnect events.',
        eventTypes: ['voice_state.updated'],
    },
] as const satisfies readonly ServerLogEventGroupDefinition[];

export function isServerLogEventGroup(value: unknown): value is ServerLogEventGroup {
    return typeof value === 'string' && SERVER_LOG_EVENT_GROUPS.some((group) => group.id === value);
}

export function getServerLogEventGroupForEventType(eventType: string): ServerLogEventGroup | undefined {
    return SERVER_LOG_EVENT_GROUPS.find((group) => (group.eventTypes as readonly string[]).includes(eventType))?.id;
}

import type { BotCommandDefinition } from '@neonflux/core';
import type { ModerationCaseRecord } from '@neonflux/db';

export function createUsageReply(command: BotCommandDefinition, prefix: string): string {
    return `Use: \`${command.usage(prefix)}\`.`;
}

export function formatCaseDetails(record: ModerationCaseRecord): string {
    return [
        `Case #${String(record.caseNumber)}: ${record.action} ${formatCaseTarget(record)} (${record.status})`,
        `Actor: ${record.actorUserId ? formatUser(record.actorUserId) : 'unknown'}`,
        `Reason: ${record.reason ?? 'none'}`,
    ].join('\n');
}

export function formatCaseListLine(record: ModerationCaseRecord): string {
    return `#${String(record.caseNumber)} ${record.action} ${formatCaseTarget(record)} (${record.status}) - ${record.reason ?? 'no reason'}`;
}

export function formatNoteLine(event: { actorUserId: string | null; details: Record<string, unknown> }): string {
    const note = typeof event.details.note === 'string' ? event.details.note : '[unreadable note]';

    return `- ${event.actorUserId ? formatUser(event.actorUserId) : 'unknown'}: ${note}`;
}

export function formatUser(userId: string): string {
    return `<@${userId}>`;
}

function formatCaseTarget(record: ModerationCaseRecord): string {
    if (record.targetType === 'channel') {
        return record.targetChannelId ? `<#${record.targetChannelId}>` : 'unknown channel';
    }

    return record.targetUserId ? formatUser(record.targetUserId) : 'unknown user';
}

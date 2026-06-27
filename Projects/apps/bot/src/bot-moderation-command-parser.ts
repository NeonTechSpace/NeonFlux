import { normalizeCommandPrefix } from '@neonflux/core/command-prefix';

export type ModerationCommandName =
    | 'warn'
    | 'kick'
    | 'ban'
    | 'unban'
    | 'timeout'
    | 'untimeout'
    | 'purge'
    | 'warnings'
    | 'delwarn'
    | 'clearwarn'
    | 'case'
    | 'cases'
    | 'reason'
    | 'note'
    | 'notes';

export type ModerationCommandId =
    | 'moderation.warn'
    | 'moderation.kick'
    | 'moderation.ban'
    | 'moderation.unban'
    | 'moderation.timeout'
    | 'moderation.untimeout'
    | 'moderation.purge'
    | 'moderation.warnings'
    | 'moderation.warning.delete'
    | 'moderation.warnings.clear'
    | 'moderation.case'
    | 'moderation.cases'
    | 'moderation.reason'
    | 'moderation.note'
    | 'moderation.notes';

export type ModerationCommandSpec = {
    commandName: ModerationCommandName;
    commandId: ModerationCommandId;
};

export type ParsedModerationCommand =
    | { type: 'warn'; targetUserId: string; reason?: string }
    | { type: 'kick'; targetUserId: string; reason?: string }
    | { type: 'ban'; targetUserId: string; reason?: string }
    | { type: 'unban'; targetUserId: string; reason?: string }
    | { type: 'timeout'; targetUserId: string; durationMs: number; reason?: string }
    | { type: 'untimeout'; targetUserId: string; reason?: string }
    | { type: 'purge'; count: number; reason?: string }
    | { type: 'warnings'; targetUserId: string }
    | { type: 'delwarn'; caseNumber: number; reason?: string }
    | { type: 'clearwarn'; targetUserId: string; reason?: string }
    | { type: 'case'; caseNumber: number }
    | { type: 'cases'; targetUserId?: string }
    | { type: 'reason'; caseNumber: number; reason: string }
    | { type: 'note'; caseNumber: number; note: string }
    | { type: 'notes'; caseNumber: number };

const commandSpecs = [
    commandSpec('clearwarn', 'moderation.warnings.clear'),
    commandSpec('warnings', 'moderation.warnings'),
    commandSpec('delwarn', 'moderation.warning.delete'),
    commandSpec('untimeout', 'moderation.untimeout'),
    commandSpec('timeout', 'moderation.timeout'),
    commandSpec('unban', 'moderation.unban'),
    commandSpec('purge', 'moderation.purge'),
    commandSpec('kick', 'moderation.kick'),
    commandSpec('ban', 'moderation.ban'),
    commandSpec('warn', 'moderation.warn'),
    commandSpec('cases', 'moderation.cases'),
    commandSpec('case', 'moderation.case'),
    commandSpec('reason', 'moderation.reason'),
    commandSpec('notes', 'moderation.notes'),
    commandSpec('note', 'moderation.note'),
] as const;

export function parsePotentialPrefixedModerationCommand(
    content: string
): { spec: ModerationCommandSpec; candidatePrefix: string; argumentsText: string } | undefined {
    const normalizedContent = content.trim();
    const lowerContent = normalizedContent.toLowerCase();

    for (const spec of commandSpecs) {
        const commandIndex = lowerContent.indexOf(spec.commandName);

        if (commandIndex < 1 || commandIndex > 3) {
            continue;
        }

        const trailingContent = normalizedContent.slice(commandIndex + spec.commandName.length);

        if (trailingContent.length > 0 && !/^\s/u.test(trailingContent)) {
            continue;
        }

        const prefixResult = normalizeCommandPrefix(normalizedContent.slice(0, commandIndex));

        if (prefixResult.isErr()) {
            continue;
        }

        return {
            spec,
            candidatePrefix: prefixResult.value,
            argumentsText: trailingContent.trim(),
        };
    }

    return undefined;
}

export function parseModerationCommand(
    commandName: ModerationCommandName,
    argumentsText: string
): ParsedModerationCommand | undefined {
    switch (commandName) {
        case 'warn': {
            const userArgument = parseUserArgument(argumentsText);

            return userArgument
                ? { type: 'warn', targetUserId: userArgument.userId, ...optionalReason(userArgument.rest) }
                : undefined;
        }
        case 'kick': {
            const userArgument = parseUserArgument(argumentsText);

            return userArgument
                ? { type: 'kick', targetUserId: userArgument.userId, ...optionalReason(userArgument.rest) }
                : undefined;
        }
        case 'ban': {
            const userArgument = parseUserArgument(argumentsText);

            return userArgument
                ? { type: 'ban', targetUserId: userArgument.userId, ...optionalReason(userArgument.rest) }
                : undefined;
        }
        case 'unban': {
            const userArgument = parseUserArgument(argumentsText);

            return userArgument
                ? { type: 'unban', targetUserId: userArgument.userId, ...optionalReason(userArgument.rest) }
                : undefined;
        }
        case 'timeout': {
            const userArgument = parseUserArgument(argumentsText);

            if (!userArgument) {
                return undefined;
            }

            const durationArgument = parseDurationArgument(userArgument.rest);

            return durationArgument
                ? {
                      type: 'timeout',
                      targetUserId: userArgument.userId,
                      durationMs: durationArgument.durationMs,
                      ...optionalReason(durationArgument.rest),
                  }
                : undefined;
        }
        case 'untimeout': {
            const userArgument = parseUserArgument(argumentsText);

            return userArgument
                ? { type: 'untimeout', targetUserId: userArgument.userId, ...optionalReason(userArgument.rest) }
                : undefined;
        }
        case 'purge': {
            const countArgument = parsePurgeCountArgument(argumentsText);

            return countArgument
                ? { type: 'purge', count: countArgument.count, ...optionalReason(countArgument.rest) }
                : undefined;
        }
        case 'warnings': {
            const userArgument = parseUserArgument(argumentsText);

            return userArgument?.rest.length === 0
                ? { type: 'warnings', targetUserId: userArgument.userId }
                : undefined;
        }
        case 'delwarn': {
            const caseArgument = parseCaseNumberArgument(argumentsText);

            return caseArgument
                ? { type: 'delwarn', caseNumber: caseArgument.caseNumber, ...optionalReason(caseArgument.rest) }
                : undefined;
        }
        case 'clearwarn': {
            const userArgument = parseUserArgument(argumentsText);

            return userArgument
                ? { type: 'clearwarn', targetUserId: userArgument.userId, ...optionalReason(userArgument.rest) }
                : undefined;
        }
        case 'case': {
            const caseArgument = parseCaseNumberArgument(argumentsText);

            return caseArgument?.rest.length === 0 ? { type: 'case', caseNumber: caseArgument.caseNumber } : undefined;
        }
        case 'cases': {
            if (argumentsText.trim().length === 0) {
                return { type: 'cases' };
            }

            const userArgument = parseUserArgument(argumentsText);

            return userArgument?.rest.length === 0 ? { type: 'cases', targetUserId: userArgument.userId } : undefined;
        }
        case 'reason': {
            const caseArgument = parseCaseNumberArgument(argumentsText);
            const reason = caseArgument?.rest.trim();

            return caseArgument && reason ? { type: 'reason', caseNumber: caseArgument.caseNumber, reason } : undefined;
        }
        case 'note': {
            const caseArgument = parseCaseNumberArgument(argumentsText);
            const note = caseArgument?.rest.trim();

            return caseArgument && note ? { type: 'note', caseNumber: caseArgument.caseNumber, note } : undefined;
        }
        case 'notes': {
            const caseArgument = parseCaseNumberArgument(argumentsText);

            return caseArgument?.rest.length === 0 ? { type: 'notes', caseNumber: caseArgument.caseNumber } : undefined;
        }
    }
}

function parseDurationArgument(argumentsText: string): { durationMs: number; rest: string } | undefined {
    const split = splitFirstArgument(argumentsText);

    if (!split) {
        return undefined;
    }

    const match = /^(\d+)([mhd])$/iu.exec(split.argument);

    if (!match) {
        return undefined;
    }

    const amount = Number.parseInt(match[1] ?? '', 10);
    const unit = match[2]?.toLowerCase();
    const unitMs = unit === 'm' ? 60_000 : unit === 'h' ? 60 * 60_000 : unit === 'd' ? 24 * 60 * 60_000 : undefined;
    const durationMs = unitMs ? amount * unitMs : Number.NaN;
    const maxDurationMs = 28 * 24 * 60 * 60_000;

    return Number.isInteger(durationMs) && durationMs >= 60_000 && durationMs <= maxDurationMs
        ? { durationMs, rest: split.rest }
        : undefined;
}

function parsePurgeCountArgument(argumentsText: string): { count: number; rest: string } | undefined {
    const split = splitFirstArgument(argumentsText);

    if (!split) {
        return undefined;
    }

    const count = Number.parseInt(split.argument, 10);

    return Number.isInteger(count) && count >= 1 && count <= 100 ? { count, rest: split.rest } : undefined;
}

function parseUserArgument(argumentsText: string): { userId: string; rest: string } | undefined {
    const split = splitFirstArgument(argumentsText);

    if (!split) {
        return undefined;
    }

    const mentionMatch = /^<@!?([A-Za-z0-9_-]+)>$/u.exec(split.argument);
    const userId = mentionMatch?.[1] ?? (/^[A-Za-z0-9_-]+$/u.test(split.argument) ? split.argument : undefined);

    return userId ? { userId, rest: split.rest } : undefined;
}

function parseCaseNumberArgument(argumentsText: string): { caseNumber: number; rest: string } | undefined {
    const split = splitFirstArgument(argumentsText);

    if (!split) {
        return undefined;
    }

    const caseNumber = Number.parseInt(split.argument, 10);

    return Number.isInteger(caseNumber) && caseNumber > 0 ? { caseNumber, rest: split.rest } : undefined;
}

function splitFirstArgument(argumentsText: string): { argument: string; rest: string } | undefined {
    const normalizedArguments = argumentsText.trim();

    if (!normalizedArguments) {
        return undefined;
    }

    const separatorIndex = normalizedArguments.search(/\s/u);

    if (separatorIndex === -1) {
        return {
            argument: normalizedArguments,
            rest: '',
        };
    }

    return {
        argument: normalizedArguments.slice(0, separatorIndex),
        rest: normalizedArguments.slice(separatorIndex).trim(),
    };
}

function optionalReason(reason: string): { reason?: string } {
    const normalizedReason = reason.trim();

    return normalizedReason ? { reason: normalizedReason } : {};
}

function commandSpec(commandName: ModerationCommandName, commandId: ModerationCommandId): ModerationCommandSpec {
    return {
        commandName,
        commandId,
    };
}

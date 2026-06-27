import { findBotCommandDefinition, type BotCommandDefinition } from '@neonflux/core';
import {
    addModerationCaseNote,
    createModerationCase,
    findModerationCaseByGuildCaseNumber,
    listModerationCaseEventsByCaseId,
    listModerationCasesByGuildId,
    updateModerationCaseReason,
    voidModerationCase,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { authorizeBotCommand } from './bot-command-authorization.js';
import { sendBotFeatureReply } from './bot-feature-replies.js';
import type {
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteHandledAction,
    BotFeatureRouteResult,
    BotMessageCreatedEvent,
} from './bot-feature-types.js';
import { findEffectiveGuildCommandPrefix } from './guild-command-prefix.js';
import {
    createUsageReply,
    formatCaseDetails,
    formatCaseListLine,
    formatNoteLine,
    formatUser,
} from './bot-moderation-command-format.js';
import {
    parseModerationCommand,
    parsePotentialPrefixedModerationCommand,
    type ModerationCommandId,
    type ModerationCommandName,
    type ParsedModerationCommand,
} from './bot-moderation-command-parser.js';

const MODERATION_COMMAND_DENIED_REPLY =
    'You cannot run moderation commands here. In lockdown, only the server owner can run guarded commands. Otherwise, this command requires Manage Server or an allowed role/user rule.';

type ModerationCommandIntent = {
    commandName: ModerationCommandName;
    commandId: ModerationCommandId;
    effectivePrefix: string;
    argumentsText: string;
};

export async function getModerationCommandIntent(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): Promise<Result<ModerationCommandIntent | undefined, 'database-error'>> {
    if (!event.guildId) {
        return ok(undefined);
    }

    const candidate = parsePotentialPrefixedModerationCommand(event.content);

    if (!candidate) {
        return ok(undefined);
    }

    const prefixResult = await findEffectiveGuildCommandPrefix(context, event.guildId);

    if (prefixResult.isErr()) {
        return err(prefixResult.error);
    }

    if (candidate.candidatePrefix !== prefixResult.value) {
        return ok(undefined);
    }

    return ok({
        commandName: candidate.spec.commandName,
        commandId: candidate.spec.commandId,
        effectivePrefix: prefixResult.value,
        argumentsText: candidate.argumentsText,
    });
}

export async function routeModerationCommand(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: ModerationCommandIntent
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const command = getCommandDefinition(intent.commandId);
    const authorizationResult = await authorizeBotCommand(context, event, {
        commandId: command.id,
        categoryId: command.categoryId,
        defconCategory: command.defconCategory,
        audience: command.audience,
    });

    if (authorizationResult.isErr()) {
        return err(authorizationResult.error);
    }

    if (!authorizationResult.value) {
        return sendBotFeatureReply(
            context,
            event,
            MODERATION_COMMAND_DENIED_REPLY,
            createModerationAction(intent.commandName)
        );
    }

    const parsed = parseModerationCommand(intent.commandName, intent.argumentsText);

    if (!parsed) {
        return sendBotFeatureReply(
            context,
            event,
            createUsageReply(command, intent.effectivePrefix),
            createModerationAction(intent.commandName)
        );
    }

    return handleModerationCommand(context, event, intent, parsed);
}

async function handleModerationCommand(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: ModerationCommandIntent,
    parsed: ParsedModerationCommand
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (!event.guildId) {
        return sendBotFeatureReply(
            context,
            event,
            'Moderation commands only work inside a community.',
            createModerationAction(intent.commandName)
        );
    }

    switch (parsed.type) {
        case 'warn':
            return createWarningReply(context, event, intent, parsed.targetUserId, parsed.reason);
        case 'warnings':
            return listWarningsReply(context, event, intent, parsed.targetUserId);
        case 'delwarn':
            return deleteWarningReply(context, event, intent, parsed.caseNumber, parsed.reason);
        case 'clearwarn':
            return clearWarningsReply(context, event, intent, parsed.targetUserId, parsed.reason);
        case 'case':
            return showCaseReply(context, event, intent, parsed.caseNumber);
        case 'cases':
            return listCasesReply(context, event, intent, parsed.targetUserId);
        case 'reason':
            return updateReasonReply(context, event, intent, parsed.caseNumber, parsed.reason);
        case 'note':
            return addNoteReply(context, event, intent, parsed.caseNumber, parsed.note);
        case 'notes':
            return listNotesReply(context, event, intent, parsed.caseNumber);
    }
}

async function createWarningReply(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: ModerationCommandIntent,
    targetUserId: string,
    reason: string | undefined
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const result = await createModerationCase(context.db, {
        guildId: requireGuildId(event),
        action: 'warn',
        targetUserId,
        actorUserId: event.authorId,
        ...(reason ? { reason } : {}),
    });

    if (result.isErr()) {
        return mapModerationRepositoryError(result.error);
    }

    return sendBotFeatureReply(
        context,
        event,
        `Warning #${String(result.value.caseNumber)} recorded for ${formatUser(targetUserId)}.`,
        createModerationAction(intent.commandName)
    );
}

async function listWarningsReply(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: ModerationCommandIntent,
    targetUserId: string
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const result = await listModerationCasesByGuildId(context.db, {
        guildId: requireGuildId(event),
        targetUserId,
        action: 'warn',
        limit: 10,
    });

    if (result.isErr()) {
        return mapModerationRepositoryError(result.error);
    }

    const content =
        result.value.length === 0
            ? `No warnings found for ${formatUser(targetUserId)}.`
            : [`Warnings for ${formatUser(targetUserId)}:`, ...result.value.map(formatCaseListLine)].join('\n');

    return sendBotFeatureReply(context, event, content, createModerationAction(intent.commandName));
}

async function deleteWarningReply(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: ModerationCommandIntent,
    caseNumber: number,
    reason: string | undefined
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const moderationCaseResult = await findModerationCaseByGuildCaseNumber(context.db, {
        guildId: requireGuildId(event),
        caseNumber,
    });

    if (moderationCaseResult.isErr()) {
        return replyForCaseLookupError(context, event, intent, caseNumber, moderationCaseResult.error);
    }

    if (moderationCaseResult.value.action !== 'warn') {
        return sendBotFeatureReply(
            context,
            event,
            `Case #${String(caseNumber)} is not a warning.`,
            createModerationAction(intent.commandName)
        );
    }

    const voidResult = await voidModerationCase(context.db, {
        caseId: moderationCaseResult.value.id,
        actorUserId: event.authorId,
        ...(reason ? { reason } : {}),
    });

    if (voidResult.isErr()) {
        return replyForCaseMutationError(context, event, intent, caseNumber, voidResult.error);
    }

    return sendBotFeatureReply(
        context,
        event,
        `Warning #${String(caseNumber)} deleted.`,
        createModerationAction(intent.commandName)
    );
}

async function clearWarningsReply(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: ModerationCommandIntent,
    targetUserId: string,
    reason: string | undefined
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    let clearedWarnings = 0;

    for (;;) {
        const warningResult = await listModerationCasesByGuildId(context.db, {
            guildId: requireGuildId(event),
            targetUserId,
            action: 'warn',
            status: 'open',
            limit: 100,
        });

        if (warningResult.isErr()) {
            return mapModerationRepositoryError(warningResult.error);
        }

        if (warningResult.value.length === 0) {
            break;
        }

        for (const warning of warningResult.value) {
            const voidResult = await voidModerationCase(context.db, {
                caseId: warning.id,
                actorUserId: event.authorId,
                ...(reason ? { reason } : {}),
            });

            if (voidResult.isErr()) {
                return mapModerationRepositoryError(voidResult.error);
            }
        }

        clearedWarnings += warningResult.value.length;

        if (warningResult.value.length < 100) {
            break;
        }
    }

    if (clearedWarnings === 0) {
        return sendBotFeatureReply(
            context,
            event,
            `No open warnings found for ${formatUser(targetUserId)}.`,
            createModerationAction(intent.commandName)
        );
    }

    return sendBotFeatureReply(
        context,
        event,
        `Cleared ${String(clearedWarnings)} warning(s) for ${formatUser(targetUserId)}.`,
        createModerationAction(intent.commandName)
    );
}

async function showCaseReply(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: ModerationCommandIntent,
    caseNumber: number
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const result = await findModerationCaseByGuildCaseNumber(context.db, {
        guildId: requireGuildId(event),
        caseNumber,
    });

    if (result.isErr()) {
        return replyForCaseLookupError(context, event, intent, caseNumber, result.error);
    }

    return sendBotFeatureReply(
        context,
        event,
        formatCaseDetails(result.value),
        createModerationAction(intent.commandName)
    );
}

async function listCasesReply(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: ModerationCommandIntent,
    targetUserId: string | undefined
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const result = await listModerationCasesByGuildId(context.db, {
        guildId: requireGuildId(event),
        ...(targetUserId ? { targetUserId } : {}),
        limit: 10,
    });

    if (result.isErr()) {
        return mapModerationRepositoryError(result.error);
    }

    const heading = targetUserId ? `Recent cases for ${formatUser(targetUserId)}:` : 'Recent moderation cases:';
    const content =
        result.value.length === 0
            ? 'No moderation cases found.'
            : [heading, ...result.value.map(formatCaseListLine)].join('\n');

    return sendBotFeatureReply(context, event, content, createModerationAction(intent.commandName));
}

async function updateReasonReply(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: ModerationCommandIntent,
    caseNumber: number,
    reason: string
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const moderationCaseResult = await findModerationCaseByGuildCaseNumber(context.db, {
        guildId: requireGuildId(event),
        caseNumber,
    });

    if (moderationCaseResult.isErr()) {
        return replyForCaseLookupError(context, event, intent, caseNumber, moderationCaseResult.error);
    }

    const result = await updateModerationCaseReason(context.db, {
        caseId: moderationCaseResult.value.id,
        actorUserId: event.authorId,
        reason,
    });

    if (result.isErr()) {
        return mapModerationRepositoryError(result.error);
    }

    return sendBotFeatureReply(
        context,
        event,
        `Case #${String(caseNumber)} reason updated.`,
        createModerationAction(intent.commandName)
    );
}

async function addNoteReply(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: ModerationCommandIntent,
    caseNumber: number,
    note: string
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const moderationCaseResult = await findModerationCaseByGuildCaseNumber(context.db, {
        guildId: requireGuildId(event),
        caseNumber,
    });

    if (moderationCaseResult.isErr()) {
        return replyForCaseLookupError(context, event, intent, caseNumber, moderationCaseResult.error);
    }

    const result = await addModerationCaseNote(context.db, {
        caseId: moderationCaseResult.value.id,
        actorUserId: event.authorId,
        note,
    });

    if (result.isErr()) {
        return mapModerationRepositoryError(result.error);
    }

    return sendBotFeatureReply(
        context,
        event,
        `Note added to case #${String(caseNumber)}.`,
        createModerationAction(intent.commandName)
    );
}

async function listNotesReply(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: ModerationCommandIntent,
    caseNumber: number
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const moderationCaseResult = await findModerationCaseByGuildCaseNumber(context.db, {
        guildId: requireGuildId(event),
        caseNumber,
    });

    if (moderationCaseResult.isErr()) {
        return replyForCaseLookupError(context, event, intent, caseNumber, moderationCaseResult.error);
    }

    const result = await listModerationCaseEventsByCaseId(context.db, {
        caseId: moderationCaseResult.value.id,
        eventType: 'note.added',
        limit: 10,
    });

    if (result.isErr()) {
        return mapModerationRepositoryError(result.error);
    }

    const content =
        result.value.length === 0
            ? `No notes found for case #${String(caseNumber)}.`
            : [`Notes for case #${String(caseNumber)}:`, ...result.value.map(formatNoteLine)].join('\n');

    return sendBotFeatureReply(context, event, content, createModerationAction(intent.commandName));
}

function getCommandDefinition(commandId: ModerationCommandId): BotCommandDefinition {
    const command = findBotCommandDefinition(commandId);

    if (!command) {
        throw new Error(`Missing moderation command definition: ${commandId}`);
    }

    return command;
}

function requireGuildId(event: BotMessageCreatedEvent): string {
    if (!event.guildId) {
        throw new Error('Moderation command requires a guild id.');
    }

    return event.guildId;
}

function createModerationAction(commandName: ModerationCommandName): BotFeatureRouteHandledAction {
    return `command.moderation.${commandName}`;
}

async function replyForCaseLookupError(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: ModerationCommandIntent,
    caseNumber: number,
    errorValue: { type: string }
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (errorValue.type === 'not-found') {
        return sendBotFeatureReply(
            context,
            event,
            `Case #${String(caseNumber)} was not found.`,
            createModerationAction(intent.commandName)
        );
    }

    return mapModerationRepositoryError(errorValue);
}

async function replyForCaseMutationError(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: ModerationCommandIntent,
    caseNumber: number,
    errorValue: { type: string }
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (errorValue.type === 'invalid-status-transition') {
        return sendBotFeatureReply(
            context,
            event,
            `Case #${String(caseNumber)} is not open.`,
            createModerationAction(intent.commandName)
        );
    }

    return mapModerationRepositoryError(errorValue);
}

function mapModerationRepositoryError(errorValue: {
    type: string;
}): Result<BotFeatureRouteResult, BotFeatureRouteError> {
    switch (errorValue.type) {
        case 'database-error':
        case 'not-found':
        case 'missing-input':
        case 'invalid-value':
        case 'invalid-status-transition':
            return err('database-error');
        default:
            return err('database-error');
    }
}

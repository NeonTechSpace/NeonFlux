import {
    createModerationCase,
    createModerationTemporaryAction,
    cancelPendingModerationTemporaryActionsByTarget,
    findGuildModerationPolicyByGuildId,
    recordModerationCaseEvent,
    updateModerationCaseStatus,
    voidModerationCase,
} from '@neonflux/db';
import { createFluxerPlatform, type FluxerPlatform, type FluxerPlatformError } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import { sendBotFeatureReply } from './bot-feature-replies.js';
import type {
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteResult,
    BotMessageCreatedEvent,
} from './bot-feature-types.js';
import { formatUser } from './bot-moderation-command-format.js';

export type ModerationPunishmentCommand = 'kick' | 'ban' | 'unban' | 'timeout' | 'untimeout';

type ModerationPunishmentInput = {
    commandName: ModerationPunishmentCommand;
    targetUserId: string;
    expiresAt?: Date;
    reason?: string;
};

export async function runModerationPunishmentCommand(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    input: ModerationPunishmentInput
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (!event.guildId) {
        return sendBotFeatureReply(
            context,
            event,
            'Moderation actions only work inside a community.',
            createPunishmentAction(input.commandName)
        );
    }

    const platform = createFluxerPlatform(context.client);
    const policyResult = await checkModerationPolicy(context, event, input, platform);

    if (policyResult.isErr()) {
        return err(policyResult.error);
    }

    if (policyResult.value) {
        return sendBotFeatureReply(context, event, policyResult.value, createPunishmentAction(input.commandName));
    }

    const caseResult = await createModerationCase(context.db, {
        guildId: event.guildId,
        action: input.commandName,
        targetUserId: input.targetUserId,
        actorUserId: event.authorId,
        ...(input.reason ? { reason: input.reason } : {}),
    });

    if (caseResult.isErr()) {
        return err('database-error');
    }

    const platformResult = await applyModerationPunishment(platform, event.guildId, input);

    if (platformResult.isErr()) {
        const failure = platformResult.error;
        const failureEventResult = await recordModerationCaseEvent(context.db, {
            caseId: caseResult.value.id,
            eventType: 'action.failed',
            actorUserId: event.authorId,
            details: {
                action: input.commandName,
                errorType: failure.type,
            },
        });

        if (failureEventResult.isErr()) {
            return err('database-error');
        }

        const voidResult = await voidModerationCase(context.db, {
            caseId: caseResult.value.id,
            actorUserId: event.authorId,
            reason: `Fluxer action failed: ${failure.type}`,
        });

        if (voidResult.isErr()) {
            return err('database-error');
        }

        return sendBotFeatureReply(
            context,
            event,
            `${formatPunishmentLabel(input.commandName)} failed for ${formatUser(input.targetUserId)}. Case #${String(caseResult.value.caseNumber)} was voided: ${formatPlatformFailure(failure)}`,
            createPunishmentAction(input.commandName)
        );
    }

    const successEventResult = await recordModerationCaseEvent(context.db, {
        caseId: caseResult.value.id,
        eventType: 'action.applied',
        actorUserId: event.authorId,
        details: {
            action: input.commandName,
            ...(input.expiresAt ? { expiresAt: input.expiresAt.toISOString() } : {}),
        },
    });

    if (successEventResult.isErr()) {
        return err('database-error');
    }

    const temporaryActionResult = await updateTemporaryActionTracking(context, event, input, caseResult.value.id);

    if (temporaryActionResult.isErr()) {
        return err(temporaryActionResult.error);
    }

    const statusResult = await updateModerationCaseStatus(context.db, {
        caseId: caseResult.value.id,
        status: 'resolved',
    });

    if (statusResult.isErr()) {
        return err('database-error');
    }

    return sendBotFeatureReply(
        context,
        event,
        createPunishmentSuccessReply(input, caseResult.value.caseNumber),
        createPunishmentAction(input.commandName)
    );
}

async function applyModerationPunishment(
    platform: FluxerPlatform,
    guildId: string,
    input: ModerationPunishmentInput
): Promise<Result<void, FluxerPlatformError>> {
    const moderation = platform.moderation;

    switch (input.commandName) {
        case 'kick':
            return moderation.kick({ guildId, userId: input.targetUserId });

        case 'ban':
            return moderation.ban({
                guildId,
                userId: input.targetUserId,
                ...(input.reason ? { reason: input.reason } : {}),
            });

        case 'unban':
            return moderation.unban({ guildId, userId: input.targetUserId });

        case 'timeout':
            if (!input.expiresAt) {
                return err({ type: 'invalid-value', field: 'expiresAt' });
            }

            return moderation.timeout({
                guildId,
                userId: input.targetUserId,
                expiresAt: input.expiresAt,
                ...(input.reason ? { reason: input.reason } : {}),
            });

        case 'untimeout':
            return moderation.untimeout({
                guildId,
                userId: input.targetUserId,
                ...(input.reason ? { reason: input.reason } : {}),
            });
    }
}

async function updateTemporaryActionTracking(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    input: ModerationPunishmentInput,
    caseId: string
): Promise<Result<void, BotFeatureRouteError>> {
    if (input.commandName === 'timeout') {
        if (!input.expiresAt) {
            return err('handler-error');
        }

        const actionResult = await createModerationTemporaryAction(context.db, {
            guildId: event.guildId ?? '',
            action: 'timeout',
            targetUserId: input.targetUserId,
            expiresAt: input.expiresAt,
            caseId,
        });

        if (actionResult.isErr()) {
            return err('database-error');
        }

        const cancelResult = await cancelPendingModerationTemporaryActionsByTarget(context.db, {
            guildId: event.guildId ?? '',
            action: 'timeout',
            targetUserId: input.targetUserId,
            excludeId: actionResult.value.id,
        });

        return cancelResult.isOk() ? ok(undefined) : err('database-error');
    }

    if (input.commandName === 'untimeout') {
        const cancelResult = await cancelPendingModerationTemporaryActionsByTarget(context.db, {
            guildId: event.guildId ?? '',
            action: 'timeout',
            targetUserId: input.targetUserId,
        });

        return cancelResult.isOk() ? ok(undefined) : err('database-error');
    }

    return ok(undefined);
}

async function checkModerationPolicy(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    input: ModerationPunishmentInput,
    platform: FluxerPlatform
): Promise<Result<string | undefined, BotFeatureRouteError>> {
    const policyResult = await findGuildModerationPolicyByGuildId(context.db, {
        guildId: event.guildId ?? '',
    });

    if (policyResult.isErr()) {
        if (policyResult.error.type === 'not-found') {
            return ok(undefined);
        }

        return err('database-error');
    }

    const policy = policyResult.value;

    if (policy.protectedUserIds.includes(input.targetUserId)) {
        return ok(`That user is protected by the moderation policy. No ${input.commandName} was applied.`);
    }

    if (policy.protectedRoleIds.length === 0) {
        return ok(undefined);
    }

    const memberResult = await platform.members.read({
        guildId: event.guildId ?? '',
        userId: input.targetUserId,
    });

    if (memberResult.isErr()) {
        if (memberResult.error.type === 'not-found') {
            return ok(undefined);
        }

        return ok(`I could not verify the target's protected roles, so no ${input.commandName} was applied.`);
    }

    if (memberResult.value.roleIds.some((roleId) => policy.protectedRoleIds.includes(roleId))) {
        return ok(`That user's role is protected by the moderation policy. No ${input.commandName} was applied.`);
    }

    return ok(undefined);
}

function formatPunishmentLabel(commandName: ModerationPunishmentCommand): string {
    switch (commandName) {
        case 'kick':
            return 'Kick';
        case 'ban':
            return 'Ban';
        case 'unban':
            return 'Unban';
        case 'timeout':
            return 'Timeout';
        case 'untimeout':
            return 'Untimeout';
    }
}

function createPunishmentSuccessReply(input: ModerationPunishmentInput, caseNumber: number): string {
    const base = `${formatPunishmentLabel(input.commandName)} recorded as case #${String(caseNumber)} for ${formatUser(input.targetUserId)}.`;

    if (input.commandName !== 'timeout' || !input.expiresAt) {
        return base;
    }

    return `${base} Expires ${formatFluxerTimestamp(input.expiresAt)}.`;
}

function formatFluxerTimestamp(date: Date): string {
    return `<t:${String(Math.floor(date.getTime() / 1000))}:f>`;
}

function formatPlatformFailure(errorValue: FluxerPlatformError): string {
    switch (errorValue.type) {
        case 'missing-input':
            return `missing ${errorValue.field}.`;
        case 'invalid-value':
            return `invalid ${errorValue.field}.`;
        case 'not-found':
            return 'the guild or user could not be found.';
        case 'permission-denied':
            return 'NeonFlux is missing permission for that action.';
        case 'unsupported':
            return 'Fluxer does not support that action here.';
        case 'operation-failed':
            return 'Fluxer rejected the action.';
    }
}

function createPunishmentAction(commandName: ModerationPunishmentCommand) {
    return `command.moderation.${commandName}` as const;
}

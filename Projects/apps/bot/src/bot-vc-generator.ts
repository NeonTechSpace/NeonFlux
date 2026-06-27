import {
    createVcGeneratorControlRequest,
    findActiveGeneratedVoiceChannelByOwner,
    findPendingVcGeneratorControlRequest,
    findVcGeneratorControlPanelByMessageId,
    findVcGeneratorRuleBySourceChannelId,
    updateVcGeneratorControlRequest,
    updateGeneratedVoiceChannelStatus,
    upsertGeneratedVoiceChannel,
    type VcGeneratorControlAction,
    type VcGeneratorControlRequestRecord,
    type VcGeneratorRuleRecord,
} from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import type {
    BotFeatureEvent,
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteHandledAction,
} from './bot-feature-types.js';
import { shouldProcessBotGuildEvent } from './mode-gate.js';

type VcGeneratorRouteResult =
    | { status: 'applied'; action: BotFeatureRouteHandledAction }
    | { status: 'ignored'; reason?: 'no-feature-handler' | 'guild-not-processable' };
type BotChannelDeletedEvent = Extract<BotFeatureEvent, { channelId: string; channelType: number }> & {
    type: 'channel.deleted';
};
type BotMessageCreatedEvent = Extract<BotFeatureEvent, { type: 'message.created' }>;
type BotReactionAddedEvent = Extract<BotFeatureEvent, { emojiKey: string }> & { type: 'reaction.added' };

const controlRequestTtlMs = 10 * 60 * 1000;
const viewChannelPermission = 1_024;
const connectPermission = 1_048_576;
const voiceAccessPermissions = String(viewChannelPermission + connectPermission);
const connectPermissionValue = String(connectPermission);

const controlActionByEmoji = new Map<string, VcGeneratorControlAction>([
    ['✏', 'rename'],
    ['✏️', 'rename'],
    ['unicode:✏', 'rename'],
    ['unicode:✏️', 'rename'],
    ['#', 'user_limit'],
    ['#️⃣', 'user_limit'],
    ['unicode:#', 'user_limit'],
    ['unicode:#️⃣', 'user_limit'],
    ['✅', 'whitelist'],
    ['unicode:✅', 'whitelist'],
    ['🚫', 'blacklist'],
    ['unicode:🚫', 'blacklist'],
    ['🔒', 'lock'],
    ['unicode:🔒', 'lock'],
    ['🔓', 'unlock'],
    ['unicode:🔓', 'unlock'],
]);

export async function handleVcGeneratorVoiceStateUpdate(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'voice_state.updated' }>
): Promise<Result<VcGeneratorRouteResult, BotFeatureRouteError>> {
    if (!event.guildId || !event.userId || !event.channelId) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    const ruleResult = await findVcGeneratorRuleBySourceChannelId(context.db, {
        guildId: event.guildId,
        sourceChannelId: event.channelId,
        enabledOnly: true,
    });

    if (ruleResult.isErr()) {
        return ruleResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    const platform = createFluxerPlatform(context.client);
    const createResult = await platform.channels.create({
        guildId: event.guildId,
        type: 2,
        name: renderGeneratedChannelName(ruleResult.value, event.userId),
        ...(ruleResult.value.categoryId ? { parentId: ruleResult.value.categoryId } : {}),
    });

    if (createResult.isErr()) {
        return err('platform-error');
    }

    const recordResult = await upsertGeneratedVoiceChannel(context.db, {
        guildId: event.guildId,
        ruleId: ruleResult.value.id,
        channelId: createResult.value.id,
        ownerUserId: event.userId,
        status: 'active',
    });

    if (recordResult.isErr()) {
        return err('database-error');
    }

    const moveResult = await platform.members.move({
        guildId: event.guildId,
        userId: event.userId,
        channelId: createResult.value.id,
    });

    if (moveResult.isErr()) {
        await updateGeneratedVoiceChannelStatus(context.db, {
            guildId: event.guildId,
            channelId: createResult.value.id,
            status: 'orphaned',
        });
        return err('platform-error');
    }

    return ok({ status: 'applied', action: 'event.vc_generator.created' });
}

export async function markVcGeneratorChannelDeleted(
    context: BotFeatureHandlerContext,
    event: BotChannelDeletedEvent
): Promise<Result<VcGeneratorRouteResult, BotFeatureRouteError>> {
    if (!event.guildId) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    const updateResult = await updateGeneratedVoiceChannelStatus(context.db, {
        guildId: event.guildId,
        channelId: event.channelId,
        status: 'deleted',
    });

    if (updateResult.isErr()) {
        return updateResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    return ok({ status: 'applied', action: 'event.vc_generator.deleted' });
}

export async function handleVcGeneratorReactionControl(
    context: BotFeatureHandlerContext,
    event: BotReactionAddedEvent
): Promise<Result<VcGeneratorRouteResult, BotFeatureRouteError>> {
    if (!event.guildId) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    if (event.userId === context.botUserId) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const controlAction = controlActionByEmoji.get(event.emojiKey);

    if (!controlAction) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const panelResult = await findVcGeneratorControlPanelByMessageId(context.db, {
        guildId: event.guildId,
        messageId: event.messageId,
    });

    if (panelResult.isErr()) {
        return panelResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    const generatedChannelResult = await findActiveGeneratedVoiceChannelByOwner(context.db, {
        guildId: event.guildId,
        ownerUserId: event.userId,
        ruleId: panelResult.value.ruleId,
    });

    if (generatedChannelResult.isErr()) {
        if (generatedChannelResult.error.type !== 'not-found') {
            return err('database-error');
        }

        const notifyResult = await sendPanelMessage(
            context,
            panelResult.value.channelId,
            `<@${event.userId}> I could not find an active generated voice channel you own for this panel.`
        );

        return notifyResult.isErr()
            ? err(notifyResult.error)
            : ok({ status: 'applied', action: 'event.vc_generator.control_failed' });
    }

    const requestResult = await createVcGeneratorControlRequest(context.db, {
        guildId: event.guildId,
        generatedChannelId: generatedChannelResult.value.id,
        panelChannelId: panelResult.value.channelId,
        targetChannelId: generatedChannelResult.value.channelId,
        requesterUserId: event.userId,
        controlAction,
        expiresAt: new Date(Date.now() + controlRequestTtlMs),
    });

    if (requestResult.isErr()) {
        return err('database-error');
    }

    if (controlNeedsResponse(controlAction)) {
        const promptResult = await sendPanelMessage(
            context,
            panelResult.value.channelId,
            getControlPrompt(controlAction, generatedChannelResult.value.channelId, event.userId)
        );

        if (promptResult.isErr()) {
            await updateVcGeneratorControlRequest(context.db, {
                requestId: requestResult.value.id,
                status: 'failed',
                errorMessage: 'prompt-send-failed',
            }).catch(() => undefined);
            return err(promptResult.error);
        }

        if (promptResult.value) {
            const updateResult = await updateVcGeneratorControlRequest(context.db, {
                requestId: requestResult.value.id,
                promptMessageId: promptResult.value,
            });

            if (updateResult.isErr()) {
                return err('database-error');
            }
        }

        return ok({ status: 'applied', action: 'event.vc_generator.control_requested' });
    }

    return await applyStoredControlRequest(context, requestResult.value, null);
}

export async function handleVcGeneratorControlResponse(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): Promise<Result<VcGeneratorRouteResult, BotFeatureRouteError>> {
    if (!event.guildId || !event.content.trim()) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    const requestResult = await findPendingVcGeneratorControlRequest(context.db, {
        guildId: event.guildId,
        panelChannelId: event.channelId,
        requesterUserId: event.authorId,
    });

    if (requestResult.isErr()) {
        return requestResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    if (requestResult.value.expiresAt.getTime() <= Date.now()) {
        return await failStoredControlRequest(
            context,
            requestResult.value,
            'expired',
            'That VC control request expired.'
        );
    }

    if (event.content.trim().toLowerCase() === 'cancel') {
        const updateResult = await updateVcGeneratorControlRequest(context.db, {
            requestId: requestResult.value.id,
            status: 'cancelled',
            errorMessage: 'cancelled-by-user',
        });

        if (updateResult.isErr()) {
            return err('database-error');
        }

        await sendPanelMessage(
            context,
            requestResult.value.panelChannelId,
            `<@${event.authorId}> VC control cancelled.`
        );
        return ok({ status: 'applied', action: 'event.vc_generator.control_failed' });
    }

    const parsedValue = parseControlResponse(requestResult.value.controlAction, event);

    if (parsedValue.isErr()) {
        return await failStoredControlRequest(context, requestResult.value, 'failed', parsedValue.error);
    }

    return await applyStoredControlRequest(context, requestResult.value, parsedValue.value);
}

function renderGeneratedChannelName(rule: VcGeneratorRuleRecord, userId: string): string {
    const renderedName = rule.nameTemplate.replaceAll('{user}', userId).trim();

    return renderedName.length > 0 ? renderedName.slice(0, 100) : `${userId} room`;
}

function controlNeedsResponse(action: VcGeneratorControlAction): boolean {
    return action === 'rename' || action === 'user_limit' || action === 'whitelist' || action === 'blacklist';
}

function getControlPrompt(action: VcGeneratorControlAction, channelId: string, userId: string): string {
    const suffix = 'Send `cancel` to stop.';

    switch (action) {
        case 'rename':
            return `<@${userId}> Reply here with the new name for <#${channelId}>. ${suffix}`;
        case 'user_limit':
            return `<@${userId}> Reply here with a user limit from 0 to 99 for <#${channelId}>. Use 0 for unlimited. ${suffix}`;
        case 'whitelist':
            return `<@${userId}> Reply here with one user mention or user ID to whitelist for <#${channelId}>. ${suffix}`;
        case 'blacklist':
            return `<@${userId}> Reply here with one user mention or user ID to blacklist from <#${channelId}>. ${suffix}`;
        case 'lock':
        case 'unlock':
            return '';
        default:
            return '';
    }
}

function parseControlResponse(action: string, event: BotMessageCreatedEvent): Result<string, string> {
    const content = event.content.trim();

    switch (action) {
        case 'rename':
            return content.length <= 100 ? ok(content) : err('Channel names must be 100 characters or less.');
        case 'user_limit': {
            const value = Number(content);
            return Number.isInteger(value) && value >= 0 && value <= 99
                ? ok(String(value))
                : err('User limit must be a whole number from 0 to 99.');
        }
        case 'whitelist':
        case 'blacklist': {
            const userId = event.mentionedUserIds[0] ?? parseUserId(content);
            return userId ? ok(userId) : err('Send one user mention or raw user ID.');
        }
        default:
            return err('Unknown VC control action.');
    }
}

async function applyStoredControlRequest(
    context: BotFeatureHandlerContext,
    request: VcGeneratorControlRequestRecord,
    value: string | null
): Promise<Result<VcGeneratorRouteResult, BotFeatureRouteError>> {
    const applyResult = await applyControlAction(context, request, value);

    if (applyResult.isErr()) {
        await updateVcGeneratorControlRequest(context.db, {
            requestId: request.id,
            status: 'failed',
            errorMessage: 'platform-action-failed',
            ...(value !== null ? { value } : {}),
        }).catch(() => undefined);
        return err('platform-error');
    }

    const updateResult = await updateVcGeneratorControlRequest(context.db, {
        requestId: request.id,
        status: 'applied',
        ...(value !== null ? { value } : {}),
    });

    if (updateResult.isErr()) {
        return err('database-error');
    }

    await sendPanelMessage(
        context,
        request.panelChannelId,
        `<@${request.requesterUserId}> ${getControlSuccessMessage(request.controlAction, request.targetChannelId, value)}`
    );

    return ok({ status: 'applied', action: 'event.vc_generator.control_applied' });
}

async function applyControlAction(
    context: BotFeatureHandlerContext,
    request: VcGeneratorControlRequestRecord,
    value: string | null
) {
    const platform = createFluxerPlatform(context.client);

    switch (request.controlAction) {
        case 'rename':
            return value
                ? platform.channels.edit({ channelId: request.targetChannelId, name: value })
                : err({ type: 'missing-input', field: 'name' });
        case 'user_limit':
            return value
                ? platform.channels.edit({ channelId: request.targetChannelId, userLimit: Number(value) })
                : err({ type: 'missing-input', field: 'userLimit' });
        case 'whitelist':
            return value
                ? platform.channels.editPermission({
                      channelId: request.targetChannelId,
                      overwriteId: value,
                      type: 1,
                      allow: voiceAccessPermissions,
                  })
                : err({ type: 'missing-input', field: 'userId' });
        case 'blacklist':
            return value
                ? platform.channels.editPermission({
                      channelId: request.targetChannelId,
                      overwriteId: value,
                      type: 1,
                      deny: voiceAccessPermissions,
                  })
                : err({ type: 'missing-input', field: 'userId' });
        case 'lock':
            return platform.channels.editPermission({
                channelId: request.targetChannelId,
                overwriteId: request.guildId,
                type: 0,
                deny: connectPermissionValue,
            });
        case 'unlock': {
            const result = await platform.channels.deletePermission({
                channelId: request.targetChannelId,
                overwriteId: request.guildId,
            });
            return result.isErr() && result.error.type === 'not-found' ? ok(undefined) : result;
        }
        default:
            return err({ type: 'invalid-value', field: 'controlAction' });
    }
}

async function failStoredControlRequest(
    context: BotFeatureHandlerContext,
    request: VcGeneratorControlRequestRecord,
    status: 'failed' | 'expired',
    message: string
): Promise<Result<VcGeneratorRouteResult, BotFeatureRouteError>> {
    const updateResult = await updateVcGeneratorControlRequest(context.db, {
        requestId: request.id,
        status,
        errorMessage: message,
    });

    if (updateResult.isErr()) {
        return err('database-error');
    }

    await sendPanelMessage(context, request.panelChannelId, `<@${request.requesterUserId}> ${message}`);
    return ok({ status: 'applied', action: 'event.vc_generator.control_failed' });
}

async function sendPanelMessage(
    context: BotFeatureHandlerContext,
    channelId: string,
    content: string
): Promise<Result<string | null, 'platform-error'>> {
    const sendResult = await createFluxerPlatform(context.client).messages.send({ channelId, content });

    return sendResult.isErr() ? err('platform-error') : ok(sendResult.value.id);
}

function getControlSuccessMessage(action: string, channelId: string, value: string | null): string {
    const displayValue = value ?? '';

    switch (action) {
        case 'rename':
            return `Renamed <#${channelId}> to \`${displayValue}\`.`;
        case 'user_limit':
            return `Set <#${channelId}> user limit to ${displayValue === '0' ? 'unlimited' : displayValue}.`;
        case 'whitelist':
            return `Whitelisted <@${displayValue}> for <#${channelId}>.`;
        case 'blacklist':
            return `Blacklisted <@${displayValue}> from <#${channelId}>.`;
        case 'lock':
            return `Locked <#${channelId}>.`;
        case 'unlock':
            return `Unlocked <#${channelId}>.`;
        default:
            return `Updated <#${channelId}>.`;
    }
}

function parseUserId(content: string): string | undefined {
    const mentionMatch = /^<@!?(\d{5,30})>$/.exec(content);

    if (mentionMatch?.[1]) {
        return mentionMatch[1];
    }

    return /^\d{5,30}$/.test(content) ? content : undefined;
}

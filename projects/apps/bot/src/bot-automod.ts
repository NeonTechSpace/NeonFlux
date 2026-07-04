import {
    createModerationCase,
    listEnabledAutomodRulesByGuildId,
    recordAutomodEvent,
    updateAutomodEventStatus,
    type AutomodRuleRecord,
} from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import type {
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteHandledAction,
    BotMessageCreatedEvent,
} from './bot-feature-types.js';

export type BotAutomodRouteResult =
    | {
          status: 'recorded' | 'enforced' | 'enforcement-failed';
          action: Extract<BotFeatureRouteHandledAction, `event.automod.${string}`>;
          matchCount: number;
          enforcedCount: number;
          failedCount: number;
      }
    | {
          status: 'ignored';
          reason: 'no-feature-handler';
      };

type AutomodMatch = {
    rule: AutomodRuleRecord;
    details: Record<string, unknown>;
};

type AutomodEnforcementResult =
    | { status: 'recorded'; details: Record<string, unknown> }
    | { status: 'enforced'; details: Record<string, unknown> }
    | { status: 'enforcement_failed'; details: Record<string, unknown> }
    | { status: 'skipped'; details: Record<string, unknown> };

const inviteLinkPattern = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/giu;

export async function routeAutomodMessageEvent(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): Promise<Result<BotAutomodRouteResult, BotFeatureRouteError>> {
    if (!event.guildId || !event.content.trim()) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const rulesResult = await listEnabledAutomodRulesByGuildId(context.db, {
        guildId: event.guildId,
    });

    if (rulesResult.isErr()) {
        return err('database-error');
    }

    const matches = rulesResult.value
        .filter((rule) => !isRuleIgnoredForEvent(rule, event))
        .map((rule) => evaluateRule(rule, event.content))
        .filter((match): match is AutomodMatch => Boolean(match));

    if (matches.length === 0) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    let enforcedCount = 0;
    let failedCount = 0;

    for (const match of matches) {
        const initialStatus = match.rule.actionType === 'record' ? 'recorded' : 'pending_enforcement';
        const eventResult = await recordAutomodEvent(context.db, {
            guildId: event.guildId,
            ruleId: match.rule.id,
            messageId: event.messageId,
            channelId: event.channelId,
            authorUserId: event.authorId,
            triggerType: match.rule.triggerType,
            actionType: match.rule.actionType,
            status: initialStatus,
            details: {
                contentLength: event.content.length,
                ...match.details,
            },
        });

        if (eventResult.isErr()) {
            return err('database-error');
        }

        const enforcementResult = await enforceAutomodAction(context, event, match.rule);

        if (enforcementResult.isErr()) {
            return err(enforcementResult.error);
        }

        if (enforcementResult.value.status !== 'recorded') {
            const updateResult = await updateAutomodEventStatus(context.db, {
                eventId: eventResult.value.id,
                status: enforcementResult.value.status,
                details: {
                    ...eventResult.value.details,
                    ...enforcementResult.value.details,
                },
            });

            if (updateResult.isErr()) {
                return err('database-error');
            }
        }

        if (enforcementResult.value.status === 'enforced') enforcedCount += 1;
        if (enforcementResult.value.status === 'enforcement_failed') failedCount += 1;
    }

    const action =
        failedCount > 0
            ? 'event.automod.enforcement_failed'
            : enforcedCount > 0
              ? 'event.automod.enforced'
              : 'event.automod.recorded';

    return ok({
        status: failedCount > 0 ? 'enforcement-failed' : enforcedCount > 0 ? 'enforced' : 'recorded',
        action,
        matchCount: matches.length,
        enforcedCount,
        failedCount,
    });
}

async function enforceAutomodAction(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    rule: AutomodRuleRecord
): Promise<Result<AutomodEnforcementResult, BotFeatureRouteError>> {
    if (rule.actionType === 'record') {
        return ok({ status: 'recorded', details: {} });
    }

    if (event.authorIsServerOwner || event.authorHasManageServer) {
        return ok({
            status: 'skipped',
            details: {
                enforcementAction: rule.actionType,
                skipReason: 'privileged-author',
            },
        });
    }

    if (rule.actionType === 'warn') {
        const warningResult = await createModerationCase(context.db, {
            guildId: event.guildId ?? '',
            action: 'warn',
            targetUserId: event.authorId,
            reason: `Automod rule: ${rule.name}`,
            ...(context.botUserId ? { actorUserId: context.botUserId } : {}),
        });

        return warningResult.isOk()
            ? ok({
                  status: 'enforced',
                  details: {
                      enforcementAction: rule.actionType,
                      moderationCaseId: warningResult.value.id,
                      moderationCaseNumber: warningResult.value.caseNumber,
                  },
              })
            : err('database-error');
    }

    const platform = createFluxerPlatform(context.client);

    if (rule.actionType === 'delete_message') {
        const deleteResult = await platform.messages.delete({
            channelId: event.channelId,
            messageId: event.messageId,
        });

        return deleteResult.isOk()
            ? ok({
                  status: 'enforced',
                  details: {
                      enforcementAction: rule.actionType,
                  },
              })
            : ok({
                  status: 'enforcement_failed',
                  details: {
                      enforcementAction: rule.actionType,
                      errorType: deleteResult.error.type,
                  },
              });
    }

    const timeoutDurationSeconds = readTimeoutDurationSeconds(rule);
    const timeoutResult = await platform.moderation.timeout({
        guildId: event.guildId ?? '',
        userId: event.authorId,
        expiresAt: new Date(Date.now() + timeoutDurationSeconds * 1000),
        reason: `Automod rule: ${rule.name}`,
    });

    return timeoutResult.isOk()
        ? ok({
              status: 'enforced',
              details: {
                  enforcementAction: rule.actionType,
                  timeoutDurationSeconds,
              },
          })
        : ok({
              status: 'enforcement_failed',
              details: {
                  enforcementAction: rule.actionType,
                  timeoutDurationSeconds,
                  errorType: timeoutResult.error.type,
              },
          });
}

function evaluateRule(rule: AutomodRuleRecord, content: string): AutomodMatch | undefined {
    switch (rule.triggerType) {
        case 'blocked_terms':
            return evaluateBlockedTermsRule(rule, content);

        case 'invite_links':
            return evaluateInviteLinksRule(rule, content);
    }
}

function isRuleIgnoredForEvent(rule: AutomodRuleRecord, event: BotMessageCreatedEvent): boolean {
    const ignoredChannelIds = new Set(rule.config.ignoredChannelIds ?? []);
    const ignoredRoleIds = new Set(rule.config.ignoredRoleIds ?? []);
    const ignoredUserIds = new Set(rule.config.ignoredUserIds ?? []);

    return (
        ignoredChannelIds.has(event.channelId) ||
        ignoredUserIds.has(event.authorId) ||
        event.authorRoleIds.some((roleId) => ignoredRoleIds.has(roleId))
    );
}

function evaluateBlockedTermsRule(rule: AutomodRuleRecord, content: string): AutomodMatch | undefined {
    if (!('terms' in rule.config)) {
        return undefined;
    }

    const normalizedContent = content.toLocaleLowerCase();
    const matchedTerms = rule.config.terms.filter((term) => normalizedContent.includes(term.toLocaleLowerCase()));

    if (matchedTerms.length === 0) {
        return undefined;
    }

    return {
        rule,
        details: {
            matchedTermCount: matchedTerms.length,
            matchedTerms,
        },
    };
}

function evaluateInviteLinksRule(rule: AutomodRuleRecord, content: string): AutomodMatch | undefined {
    const matches = content.match(inviteLinkPattern) ?? [];

    if (matches.length === 0) {
        return undefined;
    }

    return {
        rule,
        details: {
            inviteLinkCount: matches.length,
        },
    };
}

function readTimeoutDurationSeconds(rule: AutomodRuleRecord): number {
    return typeof rule.config.timeoutDurationSeconds === 'number' ? rule.config.timeoutDurationSeconds : 600;
}

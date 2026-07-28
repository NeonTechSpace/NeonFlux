import type { AppEnv, AppMode, GuildDefconOverride } from '@neonflux/config';
import type { AppLogger } from '@neonflux/core/logging';
import type { RuntimeDbClient } from '@neonflux/db';
import type { FluxerBot } from '@neonflux/fluxer';

export type BotFeatureEvent =
    | {
          type: 'guild.lifecycle.created';
          guildId: string;
      }
    | {
          type: 'guild.lifecycle.available' | 'guild.lifecycle.unavailable' | 'guild.lifecycle.deleted';
          guildId: string;
      }
    | {
          type: 'guild.lifecycle.updated';
          guildId: string;
      }
    | {
          type: 'message.created';
          messageId: string;
          createdAt: Date;
          channelId: string;
          guildId: string | null;
          authorId: string;
          authorIsBot: boolean;
          authorRoleIds: readonly string[];
          authorIsServerOwner: boolean;
          authorHasManageServer: boolean;
          content: string;
          mentionedUserIds: readonly string[];
      }
    | {
          type: 'message.updated';
          messageId: string;
          createdAt: Date;
          channelId: string;
          guildId: string | null;
          authorId: string;
          authorIsBot: boolean;
          authorRoleIds: readonly string[];
          authorIsServerOwner: boolean;
          authorHasManageServer: boolean;
          content: string;
          mentionedUserIds: readonly string[];
          oldContent: string | null;
      }
    | {
          type: 'member.joined';
          guildId: string;
          userId: string;
          roleIds: readonly string[];
          joinedAt: Date;
      }
    | {
          type: 'member.updated';
          guildId: string;
          userId: string;
          roleIds: readonly string[];
      }
    | {
          type: 'member.left';
          guildId: string;
          userId: string;
          roleIds: readonly string[];
      }
    | {
          type: 'ban.added' | 'ban.removed';
          guildId: string;
          userId: string;
      }
    | {
          type: 'role.created' | 'role.updated' | 'role.deleted';
          guildId: string;
          roleId: string;
      }
    | {
          type: 'channel.created' | 'channel.updated' | 'channel.deleted';
          guildId: string | null;
          channelId: string;
          channelType: number;
      }
    | {
          type: 'voice_state.updated';
          guildId: string | null;
          userId: string | null;
          channelId: string | null;
          oldChannelId: string | null;
          oldChannelOccupancy: number | null;
      };

export type BotMessageCreatedEvent = Extract<BotFeatureEvent, { type: 'message.created' }>;

export type BotGrowthTelemetryEvent =
    | {
          type: 'message.created';
          guildId: string | null;
          messageId: string;
          authorIsBot: boolean;
          occurredAt: Date;
      }
    | {
          type: 'member.joined';
          guildId: string;
          userId: string;
          membershipStartedAt: Date;
      }
    | {
          type: 'member.left';
          guildId: string;
          userId: string;
      };

export type BotGrowthTelemetryAdmission = 'accepted' | 'overloaded' | 'stopped';

export type BotGrowthTelemetryIngestor = {
    enqueue(event: BotGrowthTelemetryEvent): BotGrowthTelemetryAdmission;
    stop(): Promise<void>;
};

export type BotFeatureHandlerContext = {
    db: RuntimeDbClient['db'];
    mode: AppMode;
    appEnv: AppEnv;
    guildDefconOverride: GuildDefconOverride;
    client: FluxerBot['client'];
    logger: Pick<AppLogger, 'warn'>;
    botUserId?: string;
};

export type BotFeatureRoutingContext = BotFeatureHandlerContext & {
    growthTelemetry: Pick<BotGrowthTelemetryIngestor, 'enqueue'>;
};

export type BotFeatureRouteIgnoredReason =
    | 'bot-authored-message'
    | 'bot-mentioned-with-context'
    | 'bot-not-mentioned'
    | 'bot-user-unavailable'
    | 'contextless-mention-cooldown'
    | 'defcon-denied'
    | 'guild-not-processable'
    | 'no-feature-handler'
    | 'telemetry-overloaded'
    | 'telemetry-stopped';

export type BotFeatureRouteHandledAction =
    | 'bot_mention.contextless_reply'
    | 'command.help'
    | 'command.ping'
    | 'commands.prefix_change'
    | 'command.reaction_roles.status'
    | 'event.blueprint.structure_observed';

export type BotFeatureRouteResult =
    | {
          eventType: BotFeatureEvent['type'];
          status: 'handled';
          action?: BotFeatureRouteHandledAction;
      }
    | {
          eventType: BotFeatureEvent['type'];
          status: 'ignored';
          reason?: BotFeatureRouteIgnoredReason;
      };

export type BotFeatureRouteError = 'database-error' | 'handler-error' | 'message-send-error' | 'platform-error';

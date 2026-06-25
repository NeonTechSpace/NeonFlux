import type { AppEnv, AppMode, GuildDefconOverride } from '@neonflux/config';
import type { DatabaseClient } from '@neonflux/db';
import type { FluxerBot } from '@neonflux/fluxer';

export type BotFeatureEvent =
    | {
          type: 'guild.lifecycle.created';
          guildId: string;
      }
    | {
          type: 'guild.lifecycle.deleted';
          guildId: string;
      }
    | {
          type: 'message.created';
          messageId: string;
          channelId: string;
          guildId: string | null;
          authorId: string;
          authorIsBot: boolean;
          authorRoleIds: readonly string[];
          authorIsServerOwner: boolean;
          authorHasManageServer: boolean;
          content: string;
          mentionedUserIds: readonly string[];
      };

export type BotMessageCreatedEvent = Extract<BotFeatureEvent, { type: 'message.created' }>;

export type BotFeatureHandlerContext = {
    db: DatabaseClient['db'];
    mode: AppMode;
    appEnv: AppEnv;
    guildDefconOverride: GuildDefconOverride;
    client: FluxerBot['client'];
    botUserId?: string;
};

export type BotFeatureRouteIgnoredReason =
    | 'bot-authored-message'
    | 'bot-mentioned-with-context'
    | 'bot-not-mentioned'
    | 'bot-user-unavailable'
    | 'contextless-mention-cooldown'
    | 'defcon-denied'
    | 'guild-not-processable';

export type BotFeatureRouteHandledAction =
    | 'bot_mention.contextless_reply'
    | 'command.help'
    | 'command.ping'
    | 'commands.prefix_change';

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

export type BotFeatureRouteError = 'database-error' | 'handler-error' | 'message-send-error';

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
          type: 'guild.lifecycle.updated';
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
      }
    | {
          type: 'message.updated';
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
          oldContent: string | null;
      }
    | {
          type: 'message.deleted';
          messageId: string;
          channelId: string;
          guildId: string | null;
          authorId: string | null;
          content: string | null;
      }
    | {
          type: 'reaction.added' | 'reaction.removed';
          messageId: string;
          channelId: string;
          guildId: string | null;
          userId: string;
          emojiKey: string;
      }
    | {
          type: 'member.joined' | 'member.updated' | 'member.left';
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
    | 'guild-not-processable'
    | 'no-feature-handler';

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

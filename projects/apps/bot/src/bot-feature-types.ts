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
          oldChannelId: string | null;
          oldChannelOccupancy: number | null;
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
    | `command.moderation.${string}`
    | 'command.ping'
    | 'command.suggestions.suggest'
    | `command.xp.${string}`
    | 'commands.prefix_change'
    | `event.automod.${string}`
    | 'event.autorole.member_joined'
    | `event.logging.${string}`
    | 'event.giveaways.entry_added'
    | 'event.giveaways.entry_removed'
    | 'event.moderation.ban_added'
    | 'event.moderation.ban_removed'
    | 'event.reaction_roles.assigned'
    | 'event.reaction_roles.removed'
    | 'event.role_reconciliation.member_repaired'
    | 'event.role_reconciliation.structure_cleaned'
    | 'event.import_export.structure_observed'
    | 'event.suggestions.vote_removed'
    | 'event.suggestions.vote_updated'
    | 'event.tickets.channel_deleted'
    | 'event.tickets.open_existing'
    | 'event.tickets.opened'
    | 'event.verification.member_joined'
    | 'event.verification.verified'
    | 'event.vc_generator.control_applied'
    | 'event.vc_generator.control_failed'
    | 'event.vc_generator.control_requested'
    | 'event.vc_generator.created'
    | 'event.vc_generator.cleaned_up'
    | 'event.vc_generator.deleted'
    | 'event.xp.message_awarded'
    | 'event.xp.voice_awarded';

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

export const dashboardLiveAreas = [
    'overview',
    'commands',
    'access',
    'autorole',
    'moderation',
    'logging',
    'reaction_roles',
    'role_reconciliation',
    'verification',
    'xp',
    'vc_generator',
    'posting',
    'tickets',
    'suggestions',
    'profile_builder',
    'giveaways',
    'invites',
    'import_export',
    'structure',
    'audit',
] as const;

export type DashboardLiveArea = (typeof dashboardLiveAreas)[number];

export type DashboardLiveEvent =
    | {
          guildId: string;
          area: 'overview';
          event: 'overview.changed';
      }
    | {
          guildId: string;
          area: 'commands';
          event: 'guild-feature-settings.changed';
      }
    | {
          guildId: string;
          area: 'access';
          event: 'access-rules.changed';
      }
    | {
          guildId: string;
          area: 'autorole';
          event: 'autorole-rules.changed';
      }
    | {
          guildId: string;
          area: 'moderation';
          event: 'guild-feature-settings.changed';
      }
    | {
          guildId: string;
          area: 'moderation';
          event: 'moderation-cases.changed';
      }
    | {
          guildId: string;
          area: 'moderation';
          event: 'automod.changed';
      }
    | {
          guildId: string;
          area: 'logging';
          event: 'logging-destinations.changed';
      }
    | {
          guildId: string;
          area: 'reaction_roles';
          event: 'reaction-roles.changed';
      }
    | {
          guildId: string;
          area: 'role_reconciliation';
          event: 'guild-feature-settings.changed';
      }
    | {
          guildId: string;
          area: 'verification';
          event: 'verification-flows.changed';
      }
    | {
          guildId: string;
          area: 'xp';
          event: 'xp-settings.changed';
      }
    | {
          guildId: string;
          area: 'vc_generator';
          event: 'vc-generator.changed';
      }
    | {
          guildId: string;
          area: 'posting';
          event: 'posting-templates.changed';
      }
    | {
          guildId: string;
          area: 'tickets';
          event: 'tickets.changed';
      }
    | {
          guildId: string;
          area: 'suggestions';
          event: 'suggestions.changed';
      }
    | {
          guildId: string;
          area: 'profile_builder';
          event: 'profile-builder.changed';
      }
    | {
          guildId: string;
          area: 'giveaways';
          event: 'giveaways.changed';
      }
    | {
          guildId: string;
          area: 'invites';
          event: 'invites.changed';
      }
    | {
          guildId: string;
          area: 'import_export';
          event: 'guild-feature-settings.changed';
      }
    | {
          guildId: string;
          area: 'structure';
          event: 'structure.changed';
      }
    | {
          guildId: string;
          area: 'audit';
          event: 'dashboard-audit-events.changed';
      };

export function isDashboardLiveArea(value: unknown): value is DashboardLiveArea {
    return typeof value === 'string' && (dashboardLiveAreas as readonly string[]).includes(value);
}

export function parseDashboardLiveEventPayload(payload: string): DashboardLiveEvent | undefined {
    let parsedPayload: unknown;

    try {
        parsedPayload = JSON.parse(payload);
    } catch {
        return undefined;
    }

    if (!parsedPayload || typeof parsedPayload !== 'object') {
        return undefined;
    }

    const eventPayload = parsedPayload as Record<string, unknown>;
    const guildId = typeof eventPayload.guildId === 'string' ? eventPayload.guildId.trim() : '';

    if (!guildId || !isDashboardLiveArea(eventPayload.area)) {
        return undefined;
    }

    if (eventPayload.area === 'overview' && eventPayload.event === 'overview.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (
        (eventPayload.area === 'commands' || eventPayload.area === 'moderation') &&
        eventPayload.event === 'guild-feature-settings.changed'
    ) {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'access' && eventPayload.event === 'access-rules.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'autorole' && eventPayload.event === 'autorole-rules.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'moderation' && eventPayload.event === 'moderation-cases.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'moderation' && eventPayload.event === 'automod.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'logging' && eventPayload.event === 'logging-destinations.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'reaction_roles' && eventPayload.event === 'reaction-roles.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'role_reconciliation' && eventPayload.event === 'guild-feature-settings.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'verification' && eventPayload.event === 'verification-flows.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'xp' && eventPayload.event === 'xp-settings.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'vc_generator' && eventPayload.event === 'vc-generator.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'posting' && eventPayload.event === 'posting-templates.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'tickets' && eventPayload.event === 'tickets.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'suggestions' && eventPayload.event === 'suggestions.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'profile_builder' && eventPayload.event === 'profile-builder.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'giveaways' && eventPayload.event === 'giveaways.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'invites' && eventPayload.event === 'invites.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'import_export' && eventPayload.event === 'guild-feature-settings.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'structure' && eventPayload.event === 'structure.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'audit' && eventPayload.event === 'dashboard-audit-events.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    return undefined;
}

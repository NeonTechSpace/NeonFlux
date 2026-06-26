import type { Result } from 'neverthrow';

import type { DefconAudience, DefconFeatureCategory } from '@neonflux/core/defcon';

import type {
    BotFeatureEvent,
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteResult,
} from './bot-feature-types.js';

export type BotCommandMetadata = {
    id: string;
    categoryId: string;
    categoryTitle: string;
    usage: (prefix: string) => string;
    description: string;
    defconCategory: DefconFeatureCategory;
    audience: DefconAudience;
    visibleInHelp: boolean;
    implemented: boolean;
};

export type BotFeatureModule = {
    id: string;
    order: number;
    commands: readonly BotCommandMetadata[];
    eventTypes: ReadonlyArray<BotFeatureEvent['type']>;
    routeEvent?: (
        context: BotFeatureHandlerContext,
        event: BotFeatureEvent
    ) => Promise<Result<BotFeatureRouteResult | undefined, BotFeatureRouteError>>;
};

export type BotHelpCategory = {
    id: string;
    title: string;
    commands: Array<{
        usage: string;
        description: string;
    }>;
};

import type { Result } from 'neverthrow';

import type { BotCommandDefinition } from '@neonflux/core';

import type {
    BotFeatureEvent,
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteResult,
} from './bot-feature-types.js';

export type BotCommandMetadata = BotCommandDefinition;

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

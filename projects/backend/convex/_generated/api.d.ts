/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as afk from "../afk.js";
import type * as afkDomain from "../afkDomain.js";
import type * as appeals from "../appeals.js";
import type * as civilDomain from "../civilDomain.js";
import type * as crons from "../crons.js";
import type * as events from "../events.js";
import type * as eventsCleanup from "../eventsCleanup.js";
import type * as eventsDelivery from "../eventsDelivery.js";
import type * as eventsDomain from "../eventsDomain.js";
import type * as eventsStore from "../eventsStore.js";
import type * as eventsValidators from "../eventsValidators.js";
import type * as eventsWork from "../eventsWork.js";
import type * as generalSettings from "../generalSettings.js";
import type * as greetingLifecycle from "../greetingLifecycle.js";
import type * as greetings from "../greetings.js";
import type * as greetingsDomain from "../greetingsDomain.js";
import type * as greetingsValidators from "../greetingsValidators.js";
import type * as http from "../http.js";
import type * as leveling from "../leveling.js";
import type * as levelingCleanup from "../levelingCleanup.js";
import type * as levelingDomain from "../levelingDomain.js";
import type * as levelingRoles from "../levelingRoles.js";
import type * as levelingStore from "../levelingStore.js";
import type * as levelingValidators from "../levelingValidators.js";
import type * as levelingWork from "../levelingWork.js";
import type * as milestones from "../milestones.js";
import type * as milestonesCleanup from "../milestonesCleanup.js";
import type * as milestonesDelivery from "../milestonesDelivery.js";
import type * as milestonesDomain from "../milestonesDomain.js";
import type * as milestonesStore from "../milestonesStore.js";
import type * as milestonesValidators from "../milestonesValidators.js";
import type * as moderation from "../moderation.js";
import type * as moderationActions from "../moderationActions.js";
import type * as moderationDomain from "../moderationDomain.js";
import type * as moderationStore from "../moderationStore.js";
import type * as moderationValidators from "../moderationValidators.js";
import type * as protection from "../protection.js";
import type * as publishing from "../publishing.js";
import type * as publishingConsumers from "../publishingConsumers.js";
import type * as publishingContext from "../publishingContext.js";
import type * as publishingDomain from "../publishingDomain.js";
import type * as publishingValidators from "../publishingValidators.js";
import type * as responseDomain from "../responseDomain.js";
import type * as responseValidators from "../responseValidators.js";
import type * as responses from "../responses.js";
import type * as roleClaims from "../roleClaims.js";
import type * as roleLifecycle from "../roleLifecycle.js";
import type * as roleParticipation from "../roleParticipation.js";
import type * as roleReactions from "../roleReactions.js";
import type * as roles from "../roles.js";
import type * as rolesDomain from "../rolesDomain.js";
import type * as rolesStore from "../rolesStore.js";
import type * as rolesValidators from "../rolesValidators.js";
import type * as schedules from "../schedules.js";
import type * as schedulesCleanup from "../schedulesCleanup.js";
import type * as schedulesDelivery from "../schedulesDelivery.js";
import type * as schedulesDomain from "../schedulesDomain.js";
import type * as schedulesStore from "../schedulesStore.js";
import type * as schedulesValidators from "../schedulesValidators.js";
import type * as suggestions from "../suggestions.js";
import type * as suggestionsCleanup from "../suggestionsCleanup.js";
import type * as suggestionsDomain from "../suggestionsDomain.js";
import type * as suggestionsStore from "../suggestionsStore.js";
import type * as suggestionsValidators from "../suggestionsValidators.js";
import type * as suggestionsWork from "../suggestionsWork.js";
import type * as ticketDomain from "../ticketDomain.js";
import type * as ticketLifecycle from "../ticketLifecycle.js";
import type * as ticketStore from "../ticketStore.js";
import type * as ticketValidators from "../ticketValidators.js";
import type * as tickets from "../tickets.js";
import type * as validation from "../validation.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  afk: typeof afk;
  afkDomain: typeof afkDomain;
  appeals: typeof appeals;
  civilDomain: typeof civilDomain;
  crons: typeof crons;
  events: typeof events;
  eventsCleanup: typeof eventsCleanup;
  eventsDelivery: typeof eventsDelivery;
  eventsDomain: typeof eventsDomain;
  eventsStore: typeof eventsStore;
  eventsValidators: typeof eventsValidators;
  eventsWork: typeof eventsWork;
  generalSettings: typeof generalSettings;
  greetingLifecycle: typeof greetingLifecycle;
  greetings: typeof greetings;
  greetingsDomain: typeof greetingsDomain;
  greetingsValidators: typeof greetingsValidators;
  http: typeof http;
  leveling: typeof leveling;
  levelingCleanup: typeof levelingCleanup;
  levelingDomain: typeof levelingDomain;
  levelingRoles: typeof levelingRoles;
  levelingStore: typeof levelingStore;
  levelingValidators: typeof levelingValidators;
  levelingWork: typeof levelingWork;
  milestones: typeof milestones;
  milestonesCleanup: typeof milestonesCleanup;
  milestonesDelivery: typeof milestonesDelivery;
  milestonesDomain: typeof milestonesDomain;
  milestonesStore: typeof milestonesStore;
  milestonesValidators: typeof milestonesValidators;
  moderation: typeof moderation;
  moderationActions: typeof moderationActions;
  moderationDomain: typeof moderationDomain;
  moderationStore: typeof moderationStore;
  moderationValidators: typeof moderationValidators;
  protection: typeof protection;
  publishing: typeof publishing;
  publishingConsumers: typeof publishingConsumers;
  publishingContext: typeof publishingContext;
  publishingDomain: typeof publishingDomain;
  publishingValidators: typeof publishingValidators;
  responseDomain: typeof responseDomain;
  responseValidators: typeof responseValidators;
  responses: typeof responses;
  roleClaims: typeof roleClaims;
  roleLifecycle: typeof roleLifecycle;
  roleParticipation: typeof roleParticipation;
  roleReactions: typeof roleReactions;
  roles: typeof roles;
  rolesDomain: typeof rolesDomain;
  rolesStore: typeof rolesStore;
  rolesValidators: typeof rolesValidators;
  schedules: typeof schedules;
  schedulesCleanup: typeof schedulesCleanup;
  schedulesDelivery: typeof schedulesDelivery;
  schedulesDomain: typeof schedulesDomain;
  schedulesStore: typeof schedulesStore;
  schedulesValidators: typeof schedulesValidators;
  suggestions: typeof suggestions;
  suggestionsCleanup: typeof suggestionsCleanup;
  suggestionsDomain: typeof suggestionsDomain;
  suggestionsStore: typeof suggestionsStore;
  suggestionsValidators: typeof suggestionsValidators;
  suggestionsWork: typeof suggestionsWork;
  ticketDomain: typeof ticketDomain;
  ticketLifecycle: typeof ticketLifecycle;
  ticketStore: typeof ticketStore;
  ticketValidators: typeof ticketValidators;
  tickets: typeof tickets;
  validation: typeof validation;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

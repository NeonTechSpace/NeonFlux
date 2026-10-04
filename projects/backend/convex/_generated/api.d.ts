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
import type * as generalSettings from "../generalSettings.js";
import type * as http from "../http.js";
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
import type * as schedules from "../schedules.js";
import type * as schedulesCleanup from "../schedulesCleanup.js";
import type * as schedulesDelivery from "../schedulesDelivery.js";
import type * as schedulesDomain from "../schedulesDomain.js";
import type * as schedulesStore from "../schedulesStore.js";
import type * as schedulesValidators from "../schedulesValidators.js";
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
  generalSettings: typeof generalSettings;
  http: typeof http;
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
  schedules: typeof schedules;
  schedulesCleanup: typeof schedulesCleanup;
  schedulesDelivery: typeof schedulesDelivery;
  schedulesDomain: typeof schedulesDomain;
  schedulesStore: typeof schedulesStore;
  schedulesValidators: typeof schedulesValidators;
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

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
import type * as botService from "../botService.js";
import type * as crons from "../crons.js";
import type * as generalSettings from "../generalSettings.js";
import type * as moderation from "../moderation.js";
import type * as moderationActions from "../moderationActions.js";
import type * as moderationDomain from "../moderationDomain.js";
import type * as moderationStore from "../moderationStore.js";
import type * as moderationValidators from "../moderationValidators.js";
import type * as protection from "../protection.js";
import type * as responseDomain from "../responseDomain.js";
import type * as responseValidators from "../responseValidators.js";
import type * as responses from "../responses.js";
import type * as retention from "../retention.js";
import type * as retentionStore from "../retentionStore.js";
import type * as serverScope from "../serverScope.js";
import type * as serviceGuard from "../serviceGuard.js";
import type * as serviceKey from "../serviceKey.js";
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
  botService: typeof botService;
  crons: typeof crons;
  generalSettings: typeof generalSettings;
  moderation: typeof moderation;
  moderationActions: typeof moderationActions;
  moderationDomain: typeof moderationDomain;
  moderationStore: typeof moderationStore;
  moderationValidators: typeof moderationValidators;
  protection: typeof protection;
  responseDomain: typeof responseDomain;
  responseValidators: typeof responseValidators;
  responses: typeof responses;
  retention: typeof retention;
  retentionStore: typeof retentionStore;
  serverScope: typeof serverScope;
  serviceGuard: typeof serviceGuard;
  serviceKey: typeof serviceKey;
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

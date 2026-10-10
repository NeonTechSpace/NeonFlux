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
import type * as alerts from "../alerts.js";
import type * as alertsDomain from "../alertsDomain.js";
import type * as analytics from "../analytics.js";
import type * as analyticsDomain from "../analyticsDomain.js";
import type * as appeals from "../appeals.js";
import type * as auditLog from "../auditLog.js";
import type * as backup from "../backup.js";
import type * as backupDomain from "../backupDomain.js";
import type * as backupImports from "../backupImports.js";
import type * as backupProjections from "../backupProjections.js";
import type * as backupRetention from "../backupRetention.js";
import type * as backupStore from "../backupStore.js";
import type * as backupValidators from "../backupValidators.js";
import type * as botService from "../botService.js";
import type * as captchaDomain from "../captchaDomain.js";
import type * as civilDomain from "../civilDomain.js";
import type * as cleanup from "../cleanup.js";
import type * as cleanupDomain from "../cleanupDomain.js";
import type * as cleanupRetention from "../cleanupRetention.js";
import type * as cleanupStore from "../cleanupStore.js";
import type * as cleanupValidators from "../cleanupValidators.js";
import type * as cleanupWork from "../cleanupWork.js";
import type * as configurationChange from "../configurationChange.js";
import type * as configurationCursor from "../configurationCursor.js";
import type * as configurationDomain from "../configurationDomain.js";
import type * as configurationNative from "../configurationNative.js";
import type * as configurationResponses from "../configurationResponses.js";
import type * as configurationRevision from "../configurationRevision.js";
import type * as configurationSnapshot from "../configurationSnapshot.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as dashboardConfiguration from "../dashboardConfiguration.js";
import type * as dashboardMessages from "../dashboardMessages.js";
import type * as dashboardMetadata from "../dashboardMetadata.js";
import type * as dashboardProvider from "../dashboardProvider.js";
import type * as dashboardRoles from "../dashboardRoles.js";
import type * as dashboardViews from "../dashboardViews.js";
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
import type * as helpDesk from "../helpDesk.js";
import type * as helpDeskDomain from "../helpDeskDomain.js";
import type * as installations from "../installations.js";
import type * as installationsPurge from "../installationsPurge.js";
import type * as leveling from "../leveling.js";
import type * as levelingCleanup from "../levelingCleanup.js";
import type * as levelingDomain from "../levelingDomain.js";
import type * as levelingRoles from "../levelingRoles.js";
import type * as levelingStore from "../levelingStore.js";
import type * as levelingValidators from "../levelingValidators.js";
import type * as levelingWork from "../levelingWork.js";
import type * as lfg from "../lfg.js";
import type * as lfgDomain from "../lfgDomain.js";
import type * as memberAccess from "../memberAccess.js";
import type * as memberData from "../memberData.js";
import type * as memberList from "../memberList.js";
import type * as memberListDomain from "../memberListDomain.js";
import type * as metadataLogs from "../metadataLogs.js";
import type * as metadataLogsDomain from "../metadataLogsDomain.js";
import type * as metadataLogsRetention from "../metadataLogsRetention.js";
import type * as metadataLogsStore from "../metadataLogsStore.js";
import type * as metadataLogsValidators from "../metadataLogsValidators.js";
import type * as metadataLogsWork from "../metadataLogsWork.js";
import type * as milestones from "../milestones.js";
import type * as milestonesCleanup from "../milestonesCleanup.js";
import type * as milestonesDelivery from "../milestonesDelivery.js";
import type * as milestonesDomain from "../milestonesDomain.js";
import type * as milestonesStore from "../milestonesStore.js";
import type * as milestonesValidators from "../milestonesValidators.js";
import type * as moderation from "../moderation.js";
import type * as moderationActions from "../moderationActions.js";
import type * as moderationDomain from "../moderationDomain.js";
import type * as moderationLinks from "../moderationLinks.js";
import type * as moderationStore from "../moderationStore.js";
import type * as moderationValidators from "../moderationValidators.js";
import type * as motionCaptcha from "../motionCaptcha.js";
import type * as onboarding from "../onboarding.js";
import type * as onboardingDomain from "../onboardingDomain.js";
import type * as onboardingStore from "../onboardingStore.js";
import type * as onboardingValidators from "../onboardingValidators.js";
import type * as presets from "../presets.js";
import type * as presetsDomain from "../presetsDomain.js";
import type * as privateData from "../privateData.js";
import type * as protection from "../protection.js";
import type * as publishing from "../publishing.js";
import type * as publishingConsumers from "../publishingConsumers.js";
import type * as publishingContext from "../publishingContext.js";
import type * as publishingDomain from "../publishingDomain.js";
import type * as publishingValidators from "../publishingValidators.js";
import type * as recovery from "../recovery.js";
import type * as responseDomain from "../responseDomain.js";
import type * as responseValidators from "../responseValidators.js";
import type * as responses from "../responses.js";
import type * as retention from "../retention.js";
import type * as retentionStore from "../retentionStore.js";
import type * as roleClaims from "../roleClaims.js";
import type * as roleLifecycle from "../roleLifecycle.js";
import type * as roleParticipation from "../roleParticipation.js";
import type * as rolePicker from "../rolePicker.js";
import type * as rolePickerDomain from "../rolePickerDomain.js";
import type * as rolePickerRoles from "../rolePickerRoles.js";
import type * as rolePickerStore from "../rolePickerStore.js";
import type * as rolePickerValidators from "../rolePickerValidators.js";
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
import type * as serverExport from "../serverExport.js";
import type * as serverScope from "../serverScope.js";
import type * as serviceKey from "../serviceKey.js";
import type * as setupCheck from "../setupCheck.js";
import type * as setupCheckValidators from "../setupCheckValidators.js";
import type * as sidebar from "../sidebar.js";
import type * as sidebarDomain from "../sidebarDomain.js";
import type * as sticky from "../sticky.js";
import type * as stickyDomain from "../stickyDomain.js";
import type * as suggestions from "../suggestions.js";
import type * as suggestionsCleanup from "../suggestionsCleanup.js";
import type * as suggestionsDomain from "../suggestionsDomain.js";
import type * as suggestionsStore from "../suggestionsStore.js";
import type * as suggestionsValidators from "../suggestionsValidators.js";
import type * as suggestionsWork from "../suggestionsWork.js";
import type * as temporaryRoles from "../temporaryRoles.js";
import type * as temporaryRolesStore from "../temporaryRolesStore.js";
import type * as temporaryRolesValidators from "../temporaryRolesValidators.js";
import type * as ticketDomain from "../ticketDomain.js";
import type * as ticketLifecycle from "../ticketLifecycle.js";
import type * as ticketStore from "../ticketStore.js";
import type * as ticketValidators from "../ticketValidators.js";
import type * as tickets from "../tickets.js";
import type * as turnstile from "../turnstile.js";
import type * as usage from "../usage.js";
import type * as validation from "../validation.js";
import type * as verification from "../verification.js";
import type * as voice from "../voice.js";
import type * as voiceDomain from "../voiceDomain.js";
import type * as workDispatch from "../workDispatch.js";
import type * as workSignal from "../workSignal.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  afk: typeof afk;
  afkDomain: typeof afkDomain;
  alerts: typeof alerts;
  alertsDomain: typeof alertsDomain;
  analytics: typeof analytics;
  analyticsDomain: typeof analyticsDomain;
  appeals: typeof appeals;
  auditLog: typeof auditLog;
  backup: typeof backup;
  backupDomain: typeof backupDomain;
  backupImports: typeof backupImports;
  backupProjections: typeof backupProjections;
  backupRetention: typeof backupRetention;
  backupStore: typeof backupStore;
  backupValidators: typeof backupValidators;
  botService: typeof botService;
  captchaDomain: typeof captchaDomain;
  civilDomain: typeof civilDomain;
  cleanup: typeof cleanup;
  cleanupDomain: typeof cleanupDomain;
  cleanupRetention: typeof cleanupRetention;
  cleanupStore: typeof cleanupStore;
  cleanupValidators: typeof cleanupValidators;
  cleanupWork: typeof cleanupWork;
  configurationChange: typeof configurationChange;
  configurationCursor: typeof configurationCursor;
  configurationDomain: typeof configurationDomain;
  configurationNative: typeof configurationNative;
  configurationResponses: typeof configurationResponses;
  configurationRevision: typeof configurationRevision;
  configurationSnapshot: typeof configurationSnapshot;
  crons: typeof crons;
  dashboard: typeof dashboard;
  dashboardConfiguration: typeof dashboardConfiguration;
  dashboardMessages: typeof dashboardMessages;
  dashboardMetadata: typeof dashboardMetadata;
  dashboardProvider: typeof dashboardProvider;
  dashboardRoles: typeof dashboardRoles;
  dashboardViews: typeof dashboardViews;
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
  helpDesk: typeof helpDesk;
  helpDeskDomain: typeof helpDeskDomain;
  installations: typeof installations;
  installationsPurge: typeof installationsPurge;
  leveling: typeof leveling;
  levelingCleanup: typeof levelingCleanup;
  levelingDomain: typeof levelingDomain;
  levelingRoles: typeof levelingRoles;
  levelingStore: typeof levelingStore;
  levelingValidators: typeof levelingValidators;
  levelingWork: typeof levelingWork;
  lfg: typeof lfg;
  lfgDomain: typeof lfgDomain;
  memberAccess: typeof memberAccess;
  memberData: typeof memberData;
  memberList: typeof memberList;
  memberListDomain: typeof memberListDomain;
  metadataLogs: typeof metadataLogs;
  metadataLogsDomain: typeof metadataLogsDomain;
  metadataLogsRetention: typeof metadataLogsRetention;
  metadataLogsStore: typeof metadataLogsStore;
  metadataLogsValidators: typeof metadataLogsValidators;
  metadataLogsWork: typeof metadataLogsWork;
  milestones: typeof milestones;
  milestonesCleanup: typeof milestonesCleanup;
  milestonesDelivery: typeof milestonesDelivery;
  milestonesDomain: typeof milestonesDomain;
  milestonesStore: typeof milestonesStore;
  milestonesValidators: typeof milestonesValidators;
  moderation: typeof moderation;
  moderationActions: typeof moderationActions;
  moderationDomain: typeof moderationDomain;
  moderationLinks: typeof moderationLinks;
  moderationStore: typeof moderationStore;
  moderationValidators: typeof moderationValidators;
  motionCaptcha: typeof motionCaptcha;
  onboarding: typeof onboarding;
  onboardingDomain: typeof onboardingDomain;
  onboardingStore: typeof onboardingStore;
  onboardingValidators: typeof onboardingValidators;
  presets: typeof presets;
  presetsDomain: typeof presetsDomain;
  privateData: typeof privateData;
  protection: typeof protection;
  publishing: typeof publishing;
  publishingConsumers: typeof publishingConsumers;
  publishingContext: typeof publishingContext;
  publishingDomain: typeof publishingDomain;
  publishingValidators: typeof publishingValidators;
  recovery: typeof recovery;
  responseDomain: typeof responseDomain;
  responseValidators: typeof responseValidators;
  responses: typeof responses;
  retention: typeof retention;
  retentionStore: typeof retentionStore;
  roleClaims: typeof roleClaims;
  roleLifecycle: typeof roleLifecycle;
  roleParticipation: typeof roleParticipation;
  rolePicker: typeof rolePicker;
  rolePickerDomain: typeof rolePickerDomain;
  rolePickerRoles: typeof rolePickerRoles;
  rolePickerStore: typeof rolePickerStore;
  rolePickerValidators: typeof rolePickerValidators;
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
  serverExport: typeof serverExport;
  serverScope: typeof serverScope;
  serviceKey: typeof serviceKey;
  setupCheck: typeof setupCheck;
  setupCheckValidators: typeof setupCheckValidators;
  sidebar: typeof sidebar;
  sidebarDomain: typeof sidebarDomain;
  sticky: typeof sticky;
  stickyDomain: typeof stickyDomain;
  suggestions: typeof suggestions;
  suggestionsCleanup: typeof suggestionsCleanup;
  suggestionsDomain: typeof suggestionsDomain;
  suggestionsStore: typeof suggestionsStore;
  suggestionsValidators: typeof suggestionsValidators;
  suggestionsWork: typeof suggestionsWork;
  temporaryRoles: typeof temporaryRoles;
  temporaryRolesStore: typeof temporaryRolesStore;
  temporaryRolesValidators: typeof temporaryRolesValidators;
  ticketDomain: typeof ticketDomain;
  ticketLifecycle: typeof ticketLifecycle;
  ticketStore: typeof ticketStore;
  ticketValidators: typeof ticketValidators;
  tickets: typeof tickets;
  turnstile: typeof turnstile;
  usage: typeof usage;
  validation: typeof validation;
  verification: typeof verification;
  voice: typeof voice;
  voiceDomain: typeof voiceDomain;
  workDispatch: typeof workDispatch;
  workSignal: typeof workSignal;
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

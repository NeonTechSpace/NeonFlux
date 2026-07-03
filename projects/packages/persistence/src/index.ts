// Phase 4 compatibility boundary. App code imports persistence contracts here
// while the active adapter still delegates to the existing Postgres repositories.
export * from '@neonflux/db';
export {
    deleteBotInstallation,
    findDeploymentConfig,
    listBotActionEventPageByGuildId,
    listBotActionEventsByGuildId,
    listBotInstallationGuildIds,
    listGuildSecurityPoliciesByGuildIds,
    recordBotActionEvent,
    upsertBotInstallation,
    upsertDeploymentConfig,
} from './runtime.js';
export {
    deleteGuildCommandPermissionRule,
    findGuildCommandPermissionRule,
    findGuildDashboardPermissionRule,
    listGuildCommandPermissionRulesByGuildId,
    listGuildDashboardPermissionRulesByGuildIds,
    upsertGuildCommandPermissionRule,
    upsertGuildDashboardPermissionRule,
} from './runtime-access.js';
export {
    createWebSession,
    findActiveWebSessionById,
    findUsableFluxerOAuthTokenSetByUserId,
    invalidateFluxerOAuthTokenSet,
    revokeWebSession,
    upsertFluxerOAuthTokenSet,
} from './runtime-auth.js';
export {
    deleteGuildDefconExemption,
    findGuildCommandSettingsByGuildId,
    findGuildModerationPolicyByGuildId,
    findGuildSecurityPolicyByGuildId,
    listGuildDefconExemptionCategories,
    upsertGuildCommandPrefix,
    upsertGuildDefconExemption,
    upsertGuildModerationPolicy,
    upsertGuildSecurityPolicy,
} from './runtime-settings.js';
export {
    deleteAutoroleRule,
    deleteGuildLoggingDestination,
    findGuildLoggingDestinationByEventGroup,
    listAutoroleRulesByGuildId,
    listEnabledAutoroleRulesByGuildId,
    listGuildLoggingDestinationsByGuildId,
    upsertAutoroleRule,
    upsertGuildLoggingDestination,
} from './runtime-roles-logging.js';
export {
    deleteMessageTemplate,
    findMessageTemplateByName,
    listMessageTemplatesByGuildId,
    recordPostedMessage,
    upsertMessageTemplate,
} from './runtime-posting.js';
export {
    deleteVerificationFlow,
    findActiveVerificationRecord,
    findEnabledVerificationFlowByReaction,
    listVerificationFlowsByGuildId,
    revokeVerificationRecord,
    upsertVerificationFlow,
    upsertVerificationRecord,
} from './runtime-verification.js';
export {
    deleteAutomodRule,
    listAutomodEventsByGuildId,
    listAutomodRulesByGuildId,
    listEnabledAutomodRulesByGuildId,
    recordAutomodEvent,
    saveAutomodRule,
    updateAutomodEventStatus,
} from './runtime-automod.js';
export {
    cleanupDeletedGuildRoleReferences,
    createRoleReconciliationRun,
    findRoleReconciliationSettingsByGuildId,
    recordRoleReconciliationAction,
    updateRoleReconciliationRunStatus,
    upsertRoleReconciliationSettings,
} from './runtime-role-reconciliation.js';
export {
    incrementGuildMessageActivityDay,
    listGuildInviteSnapshots,
    loadGuildOverviewAggregate,
    recordGuildMemberFlowEvent,
    syncGuildInviteSnapshots,
} from './runtime-growth-overview.js';
export {
    addGuildUserXp,
    findGuildUserXp,
    findGuildUserXpRank,
    findXpSettingsByGuildId,
    grantGuildUserXp,
    listGuildXpLeaderboard,
    upsertXpRoleReward,
    upsertXpSettings,
} from './runtime-xp.js';
export { closeXpVoiceSession, startXpVoiceSession, transitionXpVoiceSession } from './runtime-xp-voice.js';
export {
    createSuggestion,
    createSuggestionBoard,
    deleteSuggestionBoard,
    deleteSuggestionVote,
    findDefaultSuggestionBoardByGuildId,
    findSuggestionByGuildMessageId,
    findSuggestionVote,
    listSuggestionBoardsByGuildId,
    upsertSuggestionBoard,
    upsertSuggestionVote,
} from './runtime-suggestions.js';
export {
    deleteReactionRoleMessage,
    deleteReactionRoleOption,
    deleteReactionRoleOptionByMessage,
    findEnabledReactionRoleOptionByReaction,
    findReactionRoleMessage,
    findReactionRoleOption,
    listActiveReactionRoleAssignmentsByGuildMessageUser,
    listActiveReactionRoleAssignmentsByGuildUser,
    listReactionRoleMessagesByGuildId,
    markReactionRoleAssignmentRemoved,
    markReactionRoleAssignmentsRemovedByMessageUser,
    upsertReactionRoleAssignment,
    upsertReactionRoleMessage,
    upsertReactionRoleOption,
    upsertReactionRoleOptionByMessage,
} from './runtime-reaction-roles.js';
export {
    addModerationCaseNote,
    createChannelModerationCase,
    createModerationCase,
    createObservedModerationCase,
    findModerationCaseByGuildCaseNumber,
    findRecentModerationCaseByTargetAction,
    listModerationCaseEventsByCaseId,
    listModerationCasesByGuildId,
    recordModerationCaseEvent,
    updateModerationCaseReason,
    updateModerationCaseStatus,
    voidModerationCase,
} from './runtime-moderation.js';
export {
    cancelPendingModerationTemporaryActionsByTarget,
    createModerationTemporaryAction,
    findPendingModerationTemporaryActionByTarget,
    listDueModerationTemporaryActions,
    updateModerationTemporaryActionStatus,
} from './runtime-moderation-temporary-actions.js';
export {
    deleteVcGeneratorRule,
    findGeneratedVoiceChannelByChannelId,
    findVcGeneratorControlPanelByMessageId,
    findVcGeneratorControlPanelByRuleId,
    findVcGeneratorRuleBySourceChannelId,
    listGeneratedVoiceChannelsByGuildId,
    listVcGeneratorControlPanelsByGuildId,
    listVcGeneratorRulesByGuildId,
    updateGeneratedVoiceChannelStatus,
    upsertGeneratedVoiceChannel,
    upsertVcGeneratorControlPanel,
    upsertVcGeneratorRule,
} from './runtime-vc-generator.js';
export {
    createVcGeneratorControlRequest,
    expirePendingVcGeneratorControlRequests,
    findActiveGeneratedVoiceChannelByOwner,
    findPendingVcGeneratorControlRequest,
    updateVcGeneratorControlRequest,
} from './runtime-vc-generator-control-requests.js';
export {
    createTicketPanel,
    deleteTicketPanel,
    findEnabledTicketPanelByMessageId,
    listTicketPanelsByGuildId,
    reserveNextTicketNumber,
    updateTicketPanel,
    updateTicketPanelEnabled,
} from './runtime-tickets-panels.js';
export {
    addTicketMember,
    createTicket,
    findOpenTicketByPanelAndOpener,
    findTicketByChannelId,
    listOpenTicketsByPanelAndOpener,
    recordTicketEvent,
    updateTicketChannelId,
    updateTicketStatus,
} from './runtime-tickets.js';
export {
    createStructureExportSnapshot,
    createStructureImportRun,
    findStructureExportSnapshotByGuildId,
    findStructureImportRunByGuildId,
    findStructureObservedEventStateByGuildId,
    listStructureExportSnapshotsByGuildId,
    listStructureImportRunsByGuildId,
    recordStructureImportAction,
    recordStructureObservedEvent,
    updateStructureImportActionStatus,
    updateStructureImportRunStatus,
} from './runtime-structure.js';
export {
    createProfileSubmission,
    deleteProfileField,
    findProfileFormByGuildName,
    findProfileSubmissionById,
    listProfileFieldsByFormId,
    listProfileFormsByGuildId,
    listProfileSubmissionsByGuildId,
    reviewProfileSubmission,
    upsertProfileField,
    upsertProfileForm,
} from './runtime-profile-builder.js';
export {
    createGiveaway,
    drawGiveawayWinners,
    findActiveGiveawayByGuildMessageId,
    listActiveGiveawayEntries,
    listGiveawaysByGuildId,
    listGiveawayWinners,
    recordGiveawayEvent,
    removeGiveawayEntry,
    updateGiveawayStatus,
    upsertGiveawayEntry,
} from './runtime-giveaways.js';
export {
    listExpiredActiveGiveaways,
    listReactionReconciliationGiveaways,
    listStaleActiveGiveaways,
    reconcileGiveawayEntries,
    updateGiveawaySyncStatus,
} from './runtime-giveaways-maintenance.js';
export { createRuntimePersistence, isConvexRuntimePersistence, isRequiredConvexConfig } from './service.js';
export type { RuntimePersistenceClient } from './service.js';

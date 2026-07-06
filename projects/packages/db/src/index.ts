// Runtime database boundary. App code imports Convex-backed operations and
// app-facing type contracts from here.
export { reactionRoleMessageModes, reactionRoleMessageSources } from './contracts-reaction-roles.js';
export { STRUCTURE_IMPORT_EXPORT_FEATURE } from './contracts-structure.js';
export type {
    BotActionEventCursor,
    BotActionEventPage,
    BotActionEventRecord,
    BotActionEventSearchScope,
    BotInstallationRecord,
    BotInstallationRepositoryError,
    DeploymentConfigInput,
    DeploymentConfigRecord,
    DeploymentConfigRepositoryError,
    EncryptedOAuthTokenPayload,
    FluxerOAuthTokenRecord,
    FluxerOAuthTokenRepositoryError,
    GuildCommandPermissionRuleRecord,
    GuildCommandPermissionRuleRepositoryError,
    GuildCommandPermissionRuleTargetType,
    GuildCommandSettingsRecord,
    GuildCommandSettingsRepositoryError,
    GuildDashboardPermissionRuleRecord,
    GuildDashboardPermissionRuleRepositoryError,
    GuildFeatureRepositoryError,
    GuildInviteAttributionStatus,
    GuildInviteSnapshotInput,
    GuildInviteSnapshotRecord,
    GuildMemberFlowEventRecord,
    GuildMemberFlowEventType,
    GuildMessageActivityDayRecord,
    GuildOverviewAggregate,
    GuildSecurityPolicyRecord,
    GuildSecurityPolicyRepositoryError,
    GrowthOverviewRepositoryError,
    MessageTemplateRecord,
    PostedMessageRecord,
    PostingRepositoryError,
    WebSessionRecord,
    WebSessionRepositoryError,
} from './contracts.js';
export type {
    ReactionRoleAssignmentRecord,
    ReactionRoleMessageMode,
    ReactionRoleMessageRecord,
    ReactionRoleMessageSource,
    ReactionRoleMessageWithOptions,
    ReactionRoleOptionMatch,
    ReactionRoleOptionRecord,
    ReactionRolesRepositoryError,
} from './contracts-reaction-roles.js';
export type {
    StructureExportSnapshotRecord,
    StructureImportActionRecord,
    StructureImportExportRepositoryError,
    StructureImportRunRecord,
    StructureImportRunWithActionsRecord,
    StructureObservedEventStateRecord,
} from './contracts-structure.js';
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
    findGuildSecurityPolicyByGuildId,
    listGuildDefconExemptionCategories,
    upsertGuildCommandPrefix,
    upsertGuildDefconExemption,
    upsertGuildSecurityPolicy,
} from './runtime-settings.js';
export {
    incrementGuildMessageActivityDay,
    listGuildInviteSnapshots,
    loadGuildOverviewAggregate,
    recordGuildMemberFlowEvent,
    syncGuildInviteSnapshots,
} from './runtime-growth-overview.js';
export {
    deleteMessageTemplate,
    findMessageTemplateByName,
    listMessageTemplatesByGuildId,
    recordPostedMessage,
    upsertMessageTemplate,
} from './runtime-posting.js';
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
export { createRuntimeDb, isConvexRuntimeDb, isRequiredConvexConfig } from './service.js';
export type { RuntimeDbClient } from './service.js';

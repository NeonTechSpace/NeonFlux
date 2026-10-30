import { v } from "convex/values"
import { moderationSettings, automodRule } from "./moderationValidators.ts"
import { responseReply, responseTrigger, responseKind } from "./responseValidators.ts"
import { publishingContent, publishingKind } from "./publishingValidators.ts"
import { rolesSettings, rolesKind, rolesMapping } from "./rolesValidators.ts"
import { greetingsSettings } from "./greetingsValidators.ts"
import { ticketSettings, ticketCategory } from "./ticketValidators.ts"
import { levelingSettings } from "./levelingValidators.ts"
import { milestoneKind, milestoneFold, milestoneTemplate } from "./milestonesValidators.ts"
import { metadataRouteValidator, metadataEventRouteValidator } from "./metadataLogsValidators.ts"
import { eventsCalendar, eventsTemplate } from "./eventsValidators.ts"
import { scheduleCalendar, scheduleSource } from "./schedulesValidators.ts"
import { memberAccessFields } from "./rolePickerValidators.ts"
import { temporaryRoleDefault } from "./temporaryRolesValidators.ts"
import { onboardingStep } from "./onboardingValidators.ts"

const { defcon: _defcon, ...moderation } = moderationSettings.fields
const { revision: _rolesRevision, ...roles } = rolesSettings.fields
const { revision: _ticketRevision, ...category } = ticketCategory.fields
const {
    revision: _levelRevision,
    mappingRevision: _mappingRevision,
    scoreEpoch: _scoreEpoch,
    ...leveling
} = levelingSettings.fields
const { revision: _metadataRevision, ...metadataRoute } = metadataRouteValidator.fields
const { revision: _metadataEventRevision, ...metadataEventRoute } = metadataEventRouteValidator.fields
const { revision: _greetingRevision, ...greetingRoute } = greetingsSettings.fields.routes.fields.welcome.fields
const nullString = v.union(v.string(), v.null()),
    nullNumber = v.union(v.number(), v.null())
const enabled = v.object({ enabled: v.boolean() })
export const backupConfigValues = {
    moderation: v.object({ ...moderation, privateDataRoleId: v.optional(v.string()) }),
    responses: v.object({ customEnabled: v.boolean(), autoEnabled: v.boolean() }),
    response: v.object({
        kind: responseKind,
        name: v.string(),
        reply: responseReply,
        trigger: v.optional(responseTrigger),
        channelIds: v.array(v.string()),
        roleIds: v.array(v.string()),
        cooldownSeconds: v.number(),
        priority: v.number(),
        enabled: v.boolean(),
    }),
    automod: automodRule,
    publishing: v.object({ enabled: v.boolean() }),
    draft: v.object({ kind: publishingKind, name: v.string(), content: publishingContent }),
    roles: v.object(roles),
    panel: v.object({
        name: v.string(),
        kind: rolesKind,
        enabled: v.boolean(),
        exclusive: v.boolean(),
        mappings: v.array(rolesMapping),
    }),
    greetings: v.object({
        claimsPerMinute: v.number(),
        retentionDays: v.number(),
        routes: v.object({
            welcome: v.object(greetingRoute),
            dm: v.object(greetingRoute),
            goodbye: v.object(greetingRoute),
        }),
    }),
    tickets: ticketSettings,
    ticketCategory: v.object(category),
    leveling: v.object(leveling),
    milestones: v.object({ enabled: v.boolean() }),
    milestoneRoute: v.object({
        kind: milestoneKind,
        channelId: v.string(),
        zone: v.string(),
        time: v.string(),
        fold: milestoneFold,
        template: milestoneTemplate,
        content: publishingContent,
        enabled: v.boolean(),
    }),
    suggestions: v.object({ enabled: v.boolean(), channelId: v.optional(v.string()) }),
    cleanup: v.object({ enabled: v.boolean() }),
    cleanupPolicy: v.object({
        channelId: v.string(),
        enabled: v.boolean(),
        ageMs: v.number(),
        ownerId: v.string(),
        excludedAuthorIds: v.array(v.string()),
        excludedMessageIds: v.array(v.string()),
    }),
    metadata: v.object({
        enabled: v.boolean(),
        routes: v.array(v.object(metadataRoute)),
        eventRoutes: v.array(v.object(metadataEventRoute)),
        allChannels: v.optional(v.boolean()),
        messageChannelIds: v.array(v.string()),
        excludedChannelIds: v.array(v.string()),
    }),
    events: v.object({ enabled: v.boolean(), threads: v.optional(v.boolean()) }),
    event: v.object({
        name: v.string(),
        channelId: v.string(),
        title: v.string(),
        description: v.string(),
        capacity: nullNumber,
        reminderOffsets: v.array(v.number()),
        calendar: v.optional(eventsCalendar),
        template: v.optional(eventsTemplate),
    }),
    schedules: enabled,
    schedule: v.object({
        name: v.string(),
        channelId: v.string(),
        calendar: scheduleCalendar,
        source: scheduleSource,
        content: publishingContent,
        enabled: v.boolean(),
    }),
    general: v.object({
        prefix: v.string(),
        replyStyle: v.optional(v.union(v.literal("embed"), v.literal("text"))),
        nickname: v.optional(v.string()),
    }),
    analytics: enabled,
    voiceGenerator: v.object({
        channelId: v.string(),
        categoryId: nullString,
        template: v.string(),
        userLimit: nullNumber,
        region: nullString,
    }),
    lfg: v.object({
        enabled: v.boolean(),
        channelId: nullString,
        generatorChannelId: nullString,
        expiryMinutes: v.number(),
        maxSize: v.number(),
        memberGroups: v.number(),
        serverGroups: v.number(),
    }),
    rolepicker: v.object({
        enabled: v.boolean(),
        menus: v.array(
            v.object({
                name: v.string(),
                description: v.optional(v.string()),
                mode: v.union(v.literal("single"), v.literal("multi")),
                roleIds: v.array(v.string()),
            }),
        ),
    }),
    access: v.object({
        feature: v.union(v.literal("rolepicker"), v.literal("showcase"), v.literal("profile")),
        ...memberAccessFields,
    }),
    temproles: v.object({ roles: v.array(temporaryRoleDefault) }),
    onboarding: v.object({
        enabled: v.boolean(),
        delivery: v.union(v.literal("welcome"), v.literal("dm")),
        steps: v.array(onboardingStep),
        completionRoleId: nullString,
    }),
    sticky: v.object({ channelId: v.string(), content: v.string(), intervalSeconds: v.number() }),
    alerts: v.object({
        invites: v.boolean(),
        bots: v.boolean(),
        webhooks: v.boolean(),
        privileges: v.boolean(),
        impersonation: v.boolean(),
        kickBots: v.boolean(),
        deleteWebhooks: v.boolean(),
        removePermissions: v.boolean(),
        expectedBotIds: v.array(v.string()),
        expectedWebhookIds: v.array(v.string()),
    }),
    helpdesk: v.object({
        forumIds: v.array(v.string()),
        greeting: nullString,
        solvedTag: v.string(),
        nudgeHours: nullNumber,
        guardChannelId: nullString,
        autoArchive: v.boolean(),
    }),
    helpdeskAnswer: v.object({ name: v.string(), title: v.string(), content: v.string() }),
    showcase: v.object({
        enabled: v.boolean(),
        channelId: nullString,
        maxPerMember: nullNumber,
        intervalMinutes: nullNumber,
    }),
    profile: v.object({ enabled: v.boolean(), cooldownSeconds: nullNumber }),
    youtube: v.object({ youtubeChannelId: v.string(), channelId: v.string() }),
    twitch: v.object({ twitchChannelId: v.string(), channelId: v.string() }),
}
const entry = <K extends keyof typeof backupConfigValues>(family: K) =>
    v.object({ family: v.literal(family), sourceId: v.string(), value: backupConfigValues[family] })
const backupConfigObject = v.union(
    entry("moderation"),
    entry("responses"),
    entry("response"),
    entry("automod"),
    entry("publishing"),
    entry("draft"),
    entry("roles"),
    entry("panel"),
    entry("greetings"),
    entry("tickets"),
    entry("ticketCategory"),
    entry("leveling"),
    entry("milestones"),
    entry("milestoneRoute"),
    entry("suggestions"),
    entry("cleanup"),
    entry("cleanupPolicy"),
    entry("metadata"),
    entry("events"),
    entry("event"),
    entry("schedules"),
    entry("schedule"),
    entry("general"),
    entry("analytics"),
    entry("voiceGenerator"),
    entry("lfg"),
    entry("rolepicker"),
    entry("access"),
    entry("temproles"),
    entry("onboarding"),
    entry("sticky"),
    entry("alerts"),
    entry("helpdesk"),
    entry("helpdeskAnswer"),
    entry("showcase"),
    entry("profile"),
    entry("youtube"),
    entry("twitch"),
)
// One XP item of a plan, see BackupXpPage in the contracts
const backupXpPage = v.object({
    sourceId: v.string(),
    epoch: v.number(),
    members: v.array(v.object({ userId: v.string(), xp: v.number(), expected: v.union(v.number(), v.null()) })),
})
const backupOverwrite = v.object({
    id: v.string(),
    type: v.union(v.literal("role"), v.literal("member")),
    allow: v.string(),
    deny: v.string(),
})
const emoji = { emojiId: v.union(v.string(), v.null()), emojiName: v.union(v.string(), v.null()) }
export const backupStructureObject = v.object({
    sourceId: v.string(),
    type: v.union(
        v.literal("category"),
        v.literal("text"),
        v.literal("voice"),
        v.literal("forum"),
        v.literal("media"),
        v.literal("announcement"),
    ),
    name: v.string(),
    parentId: v.union(v.string(), v.null()),
    overwrites: v.array(backupOverwrite),
    topic: v.optional(v.union(v.string(), v.null())),
    nsfw: v.optional(v.boolean()),
    slowmodeSeconds: v.optional(v.number()),
    bitrate: v.optional(v.number()),
    userLimit: v.optional(v.number()),
    tags: v.optional(v.array(v.object({ name: v.string(), moderated: v.boolean(), ...emoji }))),
    defaultReaction: v.optional(v.union(v.object(emoji), v.null())),
    defaultAutoArchiveMinutes: v.optional(v.union(v.number(), v.null())),
    sortOrder: v.optional(v.union(v.number(), v.null())),
    layout: v.optional(v.number()),
    requireTag: v.optional(v.boolean()),
    managed: v.optional(v.union(v.literal("ticket"), v.literal("voiceRoom"))),
    position: v.optional(v.number()),
    capturedAt: v.number(),
})
export const backupObject = v.union(backupConfigObject, backupXpPage, backupStructureObject)
export const backupCategory = v.union(v.literal("config"), v.literal("xp"), v.literal("structure"))
const nullTime = v.union(v.number(), v.null())
/** An archive without its objects, see BackupManifestHeader in the contracts */
export const backupHeader = v.object({
    version: v.literal(2),
    backupId: v.string(),
    provider: v.string(),
    serverId: v.string(),
    selected: v.array(backupCategory),
    capturedAt: v.number(),
    observations: v.object({ databaseAt: nullTime, structureStartedAt: nullTime, structureFinishedAt: nullTime }),
    counts: v.object({ config: v.number(), xp: v.number(), structure: v.number(), overwrites: v.number() }),
    exclusions: v.array(v.string()),
})
export const backupDisposition = v.union(
    ...(["create", "update", "delete", "skip", "blocked"] as const).map((x) => v.literal(x)),
)
export const backupItemState = v.union(
    ...(
        [
            "planned",
            "reserved",
            "claimed",
            "created",
            "updated",
            "deleted",
            "skipped",
            "conflict",
            "blocked",
            "failed",
            "uncertain",
        ] as const
    ).map((x) => v.literal(x)),
)
export const backupOriginState = v.union(
    ...(["reserved", "claimed", "created", "uncertain", "failed"] as const).map((x) => v.literal(x)),
)
export const backupResolution = v.union(v.literal("match"), v.literal("absent"), v.literal("conflict"))
export const backupPreviewFailure = v.union(
    ...(["owner", "archive", "key", "refused", "error", "unanswered", "paused", "expired"] as const).map((x) =>
        v.literal(x),
    ),
)
const backupPermissions = v.object({ allow: v.string(), deny: v.string() })
/** One difference an item makes, see BackupChange in the contracts. Values are the JSON leaves of the archived settings */
export const backupChange = v.union(
    v.object({
        kind: v.literal("field"),
        path: v.string(),
        before: v.optional(v.any()),
        after: v.optional(v.any()),
        on: v.optional(v.literal(true)),
    }),
    v.object({
        kind: v.literal("overwrite"),
        id: v.string(),
        type: v.union(v.literal("role"), v.literal("member")),
        before: backupPermissions,
        after: backupPermissions,
        gain: v.string(),
        dropped: v.optional(v.literal(true)),
    }),
)

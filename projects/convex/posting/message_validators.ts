import { v } from 'convex/values';

const outgoingEmbedAuthorValidator = v.object({
    iconUrl: v.optional(v.string()),
    name: v.string(),
    url: v.optional(v.string()),
});

const outgoingEmbedFieldValidator = v.object({
    inline: v.optional(v.boolean()),
    name: v.string(),
    value: v.string(),
});

const outgoingEmbedFooterValidator = v.object({
    iconUrl: v.optional(v.string()),
    text: v.string(),
});

export const outgoingEmbedValidator = v.object({
    author: v.optional(outgoingEmbedAuthorValidator),
    color: v.optional(v.number()),
    description: v.optional(v.string()),
    fields: v.optional(v.array(outgoingEmbedFieldValidator)),
    footer: v.optional(outgoingEmbedFooterValidator),
    imageUrl: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    timestamp: v.optional(v.string()),
    title: v.optional(v.string()),
    url: v.optional(v.string()),
});

export const dashboardPostingOperationResolutionValidator = v.union(
    v.literal('reported_seen'),
    v.literal('reported_not_seen'),
    v.literal('duplicate_risk_accepted')
);

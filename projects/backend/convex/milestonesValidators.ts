import { v } from "convex/values"
import { scheduleDeliveryState, scheduleDeliveryReason } from "./schedulesValidators.ts"

export const milestoneKind = v.union(v.literal("birthday"), v.literal("anniversary"))
export const milestoneTemplate = v.object({ name: v.string(), revision: v.number() })
export const milestoneFold = v.union(v.literal("reject"), v.literal("earlier"), v.literal("later"))
export const milestoneState = scheduleDeliveryState
export const milestoneReason = v.union(scheduleDeliveryReason, v.literal("consent"), v.literal("membership"), v.literal("civil-gap"), v.literal("civil-fold"), v.literal("consumed"))
export const milestoneBindingFields = { kind: milestoneKind, intentRevision: v.number(), userId: v.string(), joinedAt: v.string(), consentRevision: v.number(), audienceGeneration: v.number(), celebrationYear: v.number(), completedYears: v.number(), generation: v.number() }
export const publishingMilestoneConsumer = v.object({ type: v.literal("milestone"), deliveryId: v.string(), ...milestoneBindingFields })

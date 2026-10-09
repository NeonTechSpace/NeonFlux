import { Schema } from "effect"

// The dashboard overview's sections and their states

const sections = [
    "custom",
    "auto",
    "moderation",
    "cleanup",
    "logs",
    "reaction",
    "autorole",
    "verification",
    "rolepicker",
    "publishing",
    "greetings",
    "schedules",
    "tickets",
    "leveling",
    "milestones",
    "suggestions",
    "events",
    "voice",
    "analytics",
] as const
export const DashboardOverviewSection = Schema.Literals(sections)
export type DashboardOverviewSection = typeof DashboardOverviewSection.Type
/** On is enabled and able to act, setup is enabled but missing what it needs, such as a channel or a first definition, and off is disabled */
export const DashboardOverviewState = Schema.Literals(["on", "setup", "off"])
export type DashboardOverviewState = typeof DashboardOverviewState.Type

import { BOT_FUNCTIONS, type BotFunction } from "@neonflux/contracts/service"

// Every backend request the bot makes, by the path the bot and its tests name it with, and the botService function it calls.
// The contracts own the function names and whether each is a query or a mutation, and a backend test checks them against
// botService.ts. Mutations answer { value, dueIn }, see backend-http.ts
export const backendRoutes = {
    "/service/scope": "serviceScope",
    "/service/work": "serviceWork",
    // Subscribed by the work dispatcher rather than requested
    "/service/work-signal": "serviceWorkSignal",
    "/afk/set": "afkSet",
    "/afk/observe": "afkObserve",
    "/general/get": "generalGet",
    "/general/manage": "generalManage",
    "/responses/manage": "responsesManage",
    "/responses/evaluate": "responsesEvaluate",
    "/moderation/query": "moderationQuery",
    "/moderation/gate": "moderationGate",
    "/moderation/manage": "moderationManage",
    "/moderation/evaluate": "moderationEvaluate",
    "/moderation/join": "moderationJoin",
    "/moderation/outcome": "moderationOutcome",
    "/moderation/log-outcome": "moderationLogOutcome",
    "/moderation/notice-outcome": "moderationNoticeOutcome",
    "/moderation/reconcile": "moderationReconcile",
    "/moderation/observe": "moderationObserve",
    "/appeals/member": "appealsMember",
    "/appeals/staff": "appealsStaff",
    "/publishing/query": "publishingQuery",
    "/publishing/manage": "publishingManage",
    "/publishing/dispatch": "publishingDispatch",
    "/publishing/outcome": "publishingOutcome",
    "/publishing/reconcile": "publishingReconcile",
    "/publishing/observe": "publishingObserve",
    "/schedules/query": "schedulesQuery",
    "/schedules/manage": "schedulesManage",
    "/schedules/delivery": "schedulesDelivery",
    "/roles/query": "rolesQuery",
    "/roles/member-query": "rolesMemberQuery",
    "/roles/policy": "rolesPolicy",
    "/roles/manage": "rolesManage",
    "/roles/reaction-jobs": "rolesReactionJobs",
    "/roles/evaluate": "rolesEvaluate",
    "/roles/dispatch": "rolesDispatch",
    "/roles/outcome": "rolesOutcome",
    "/roles/reconcile": "rolesReconcile",
    "/roles/observe": "rolesObserve",
    "/greetings/query": "greetingsQuery",
    "/greetings/member": "greetingsMember",
    "/greetings/pending": "greetingsPending",
    "/greetings/manage": "greetingsManage",
    "/greetings/observe": "greetingsObserve",
    "/greetings/discover": "greetingsDiscover",
    "/greetings/reserve": "greetingsReserve",
    "/greetings/dispatch": "greetingsDispatch",
    "/greetings/outcome": "greetingsOutcome",
    "/greetings/defer": "greetingsDefer",
} as const satisfies Record<string, BotFunction>

export type BackendPath = keyof typeof backendRoutes
export function isBackendPath(path: string): path is BackendPath {
    return Object.hasOwn(backendRoutes, path)
}
export const backendFunction = (path: BackendPath) => `botService:${backendRoutes[path]}`
export const backendKind = (path: BackendPath) => BOT_FUNCTIONS[backendRoutes[path]]

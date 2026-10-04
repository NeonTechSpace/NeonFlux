import { BOT_FUNCTIONS, type BotFunction } from "@neonflux/contracts/service"

// Every backend request the bot makes, by the path the bot and its tests name it with, and the botService function it calls.
// The contracts own the function names and whether each is a query or a mutation, and a backend test checks them against
// botService.ts
export const backendRoutes = {
    "/service/scope": "serviceScope",
    "/afk/set": "afkSet",
    "/afk/observe": "afkObserve",
    "/general/get": "generalGet",
    "/general/manage": "generalManage",
    "/responses/manage": "responsesManage",
    "/responses/evaluate": "responsesEvaluate",
} as const satisfies Record<string, BotFunction>

export type BackendPath = keyof typeof backendRoutes
export function isBackendPath(path: string): path is BackendPath {
    return Object.hasOwn(backendRoutes, path)
}
export const backendFunction = (path: BackendPath) => `botService:${backendRoutes[path]}`
export const backendKind = (path: BackendPath) => BOT_FUNCTIONS[backendRoutes[path]]

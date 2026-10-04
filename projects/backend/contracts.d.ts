
export type ResponseKind = "custom" | "auto"
export type ResponseTrigger = { mode: "exact" | "contains", text: string }
export type ResponseReply =
    | { type: "text", text: string }
    | { type: "embed", embed: { title: string, description: string, color?: number } }

export type ResponseDefinition = {
    kind: ResponseKind
    name: string
    reply: ResponseReply
    trigger?: ResponseTrigger
    channelIds: string[]
    roleIds: string[]
    cooldownSeconds: number
    priority: number
    enabled: boolean
    createdAt: number
    updatedAt: number
}

export type ResponseCommonOperation =
    | { type: "show", name: string }
    | { type: "list", page?: number }
    | { type: "update", name: string, field: "response", reply: ResponseReply }
    | { type: "update", name: string, field: "channels", channelIds: string[] }
    | { type: "update", name: string, field: "roles", roleIds: string[] }
    | { type: "update", name: string, field: "cooldown", cooldownSeconds: number }
    | { type: "enable" | "disable" | "delete", name: string }
    | { type: "module", enabled: boolean }

export type ResponseCustomOperation = ResponseCommonOperation
    | { type: "create", name: string, reply: ResponseReply }

export type ResponseAutoOperation = ResponseCommonOperation
    | { type: "create", name: string, trigger: ResponseTrigger, reply: ResponseReply }
    | { type: "update", name: string, field: "trigger", trigger: ResponseTrigger }
    | { type: "update", name: string, field: "priority", priority: number }

export type ResponseManageRequest = {
    serverId: string
    messageId: string
    createdAt: number
    actorId: string
    adminAuthorized: boolean
} & (
    | { kind: "custom", operation: ResponseCustomOperation }
    | { kind: "auto", operation: ResponseAutoOperation }
)

export type ResponseManageResult =
    | { duplicate: true }
    | { duplicate: false, type: "definition", definition: ResponseDefinition }
    | { duplicate: false, type: "list", kind: ResponseKind, page: number, totalPages: number, total: number, moduleEnabled: boolean, definitions: ResponseDefinition[] }
    | { duplicate: false, type: "deleted", kind: ResponseKind, name: string }
    | { duplicate: false, type: "module", kind: ResponseKind, enabled: boolean }

export type ResponseEvaluateRequest = {
    serverId: string
    messageId: string
    createdAt: number
    channelId: string
    userId: string
    userName: string
    roleIds: string[]
    content: string
}

export type ResponseEvaluateResult =
    | { send: false }
    | { send: true, messageId: string, ruleName: string, reply: ResponseReply }

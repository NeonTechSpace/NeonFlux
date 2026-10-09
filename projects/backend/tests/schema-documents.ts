import type { GenericMutationCtx } from "convex/server"
import type { DataModel, Id, TableNames } from "../convex/_generated/dataModel.js"
import schema from "../convex/schema.ts"

// Builds a valid synthetic document for any schema table from its validator, so tests cover tables added later.
// Optional fields stay absent, unions take their first member and required references get their own row first
type Validator = { kind: string, isOptional?: string, fields?: Record<string, Validator>, value?: unknown, members?: Validator[], tableName?: string }
type Ctx = GenericMutationCtx<DataModel>

async function sample(ctx: Ctx, validator: Validator, serverId: string, depth: number): Promise<unknown> {
    switch (validator.kind) {
        case "object": {
            const entries = []
            for (const [key, field] of Object.entries(validator.fields!)) {
                if (field.isOptional !== "optional") entries.push([key, key === "serverId" ? serverId : await sample(ctx, field, serverId, depth)])
            }
            return Object.fromEntries(entries)
        }
        case "string": return "1"
        case "float64": return 1
        case "boolean": return false
        case "literal": return validator.value
        case "union": return sample(ctx, validator.members![0]!, serverId, depth)
        case "array": return []
        case "record": return {}
        case "null": case "any": return null
        case "id": return insertDocument(ctx, validator.tableName as TableNames, serverId, {}, depth + 1)
        default: throw new Error(`Unsupported validator ${validator.kind}`)
    }
}

export async function insertDocument<T extends TableNames>(ctx: Ctx, table: T, serverId: string, overrides: Record<string, unknown> = {}, depth = 0): Promise<Id<T>> {
    if (depth > 4) throw new Error(`Reference cycle through ${table}`)
    const document = await sample(ctx, schema.tables[table].validator as unknown as Validator, serverId, depth) as Record<string, unknown>
    for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete document[key]
        else document[key] = value
    }
    return ctx.db.insert(table, document as never)
}

export const tableNames = Object.keys(schema.tables) as TableNames[]
export const hasServerId = (table: TableNames) => "serverId" in (schema.tables[table].validator as unknown as Validator).fields!
export const serverIndexes = (table: TableNames) => (schema.tables[table] as unknown as { " indexes"(): { indexDescriptor: string, fields: string[] }[] })[" indexes"]()

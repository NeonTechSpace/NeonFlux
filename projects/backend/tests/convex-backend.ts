import { afterEach } from "node:test"
import { convexTest, type TestConvex } from "convex-test"
import { getDocumentSize, type Value } from "convex/values"
import type { TableNames } from "../convex/_generated/dataModel.js"
import schema from "../convex/schema.ts"

// Convex refuses a document over 1 MiB and an array of more than 8,192 values, while convex-test stores both. Every backend
// a test builds through convexBackend is scanned after the test, so a write over either limit fails the test that made it
export const DOCUMENT_BYTES = 1 << 20,
    ARRAY_VALUES = 8192
// A scan transaction ends this far below its read limits, so the next document fits. One that does not is far over the
// document limit, and convex-test's read limit then fails the test instead
const SPARE_BYTES = 4 << 20,
    SPARE_DOCUMENTS = 1024

export type Backend = TestConvex<typeof schema>
type Limits = boolean | Partial<Record<"bytesRead" | "bytesWritten" | "documentsRead" | "documentsWritten", number>>
type Row = { _id: string; _creationTime: number } & Record<string, Value>

const tables = Object.keys(schema.tables) as TableNames[]
let built: Backend[] = []

/** A convex-test backend with the schema and Convex's transaction limits, checked against the document limits after the test */
export function convexBackend(modules: Record<string, () => Promise<unknown>>, transactionLimits: Limits = true) {
    const backend: Backend = convexTest({ schema, modules, transactionLimits })
    built.push(backend)
    return backend
}

afterEach(async () => {
    const backends = built
    built = []
    for (const backend of backends) await checkDocuments(backend)
})

// The path of the first array in the value that holds more values than Convex allows
function longArray(value: Value, path: string): string | undefined {
    if (Array.isArray(value)) {
        if (value.length > ARRAY_VALUES) return `${path} holds ${value.length} values`
        for (const [index, item] of value.entries()) {
            const found = longArray(item, `${path}[${index}]`)
            if (found) return found
        }
    } else if (value !== null && typeof value === "object" && !(value instanceof ArrayBuffer))
        for (const [key, item] of Object.entries(value)) {
            const found = longArray(item, `${path}.${key}`)
            if (found) return found
        }
    return undefined
}

/** Reads every document of every table in bounded transactions and throws with each one over a Convex document limit */
export async function checkDocuments(backend: Backend) {
    const problems: string[] = []
    let position: { table: number; after?: number } | undefined = { table: 0 }
    while (position)
        position = await backend.run(async (ctx) => {
            const metrics = await ctx.meta.getTransactionMetrics()
            let bytes = metrics.bytesRead.remaining - SPARE_BYTES,
                documents = metrics.documentsRead.remaining - SPARE_DOCUMENTS
            for (
                let table = position!.table, after = position!.after;
                table < tables.length;
                table++, after = undefined
            ) {
                const name = tables[table]!
                const rows =
                    after === undefined
                        ? ctx.db.query(name)
                        : ctx.db.query(name).withIndex("by_creation_time", (q) => q.gt("_creationTime", after!))
                for await (const row of rows as AsyncIterable<Row>) {
                    const size = getDocumentSize(row)
                    if (size > DOCUMENT_BYTES)
                        problems.push(`${name} ${row._id} is ${size} bytes, over the limit of ${DOCUMENT_BYTES}`)
                    const array = longArray(row, "document")
                    if (array) problems.push(`In ${name} ${row._id}, ${array}, over the limit of ${ARRAY_VALUES}`)
                    bytes -= size
                    documents--
                    if (bytes <= 0 || documents <= 0) return { table, after: row._creationTime }
                }
            }
            return undefined
        })
    if (problems.length) throw new Error(`Documents over Convex's limits:\n${problems.join("\n")}`)
}

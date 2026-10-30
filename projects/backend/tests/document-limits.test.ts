import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"
import { ARRAY_VALUES, checkDocuments, convexBackend, DOCUMENT_BYTES } from "./convex-backend.ts"
import { insertDocument } from "./schema-documents.ts"

const modules = {
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const receipt = (messageId: string) => ({ serverId: "10", messageId, expiresAt: 1 })

// Each test removes what it planted, because the check after every test reads the same backend
test("A document over 1 MiB fails the check, which names its table and document", async () => {
    const t = convexBackend(modules)
    const id = await t.run((ctx) => ctx.db.insert("responseReceipts", receipt("x".repeat(DOCUMENT_BYTES))))
    await assert.rejects(
        checkDocuments(t),
        new RegExp(`responseReceipts ${id} is \\d+ bytes, over the limit of ${DOCUMENT_BYTES}`),
    )
    await t.run((ctx) => ctx.db.delete(id))
    await checkDocuments(t)
})

test("An array over 8,192 values fails the check, and one at the limit passes", async () => {
    const t = convexBackend(modules)
    const chain = { generation: 1, leaseUntil: 0, finishedAt: 0 }
    const id = await t.run((ctx) =>
        ctx.db.insert("retentionState", { ...chain, isolated: Array<string>(ARRAY_VALUES).fill("1") }),
    )
    await checkDocuments(t)
    await t.run((ctx) => ctx.db.patch(id, { isolated: Array<string>(ARRAY_VALUES + 1).fill("1") }))
    await assert.rejects(
        checkDocuments(t),
        new RegExp(`In retentionState ${id}, document\\.isolated holds ${ARRAY_VALUES + 1} values`),
    )
    await t.run((ctx) => ctx.db.delete(id))
})

test("An array inside other values fails the check with its path", async () => {
    const t = convexBackend(modules)
    const id = await t.run((ctx) =>
        insertDocument(ctx, "dashboardConfigurationJobs", "10", {
            operation: { lists: [[], Array<string>(ARRAY_VALUES + 1).fill("1")] },
        }),
    )
    await assert.rejects(checkDocuments(t), /document\.operation\.lists\[1\] holds 8193 values/)
    await t.run((ctx) => ctx.db.delete(id))
})

test("A scan past the read limits of one transaction still reaches every document, once each", async () => {
    // These limits leave room for six documents per transaction, and the last of the 41 is over the limit
    const t = convexBackend(modules, { documentsRead: 1030 })
    await t.run(async (ctx) => {
        for (let index = 0; index < 40; index++) await ctx.db.insert("responseReceipts", receipt(String(index)))
    })
    const id = await t.run((ctx) => ctx.db.insert("responseReceipts", receipt("x".repeat(DOCUMENT_BYTES))))
    const error: Error = await checkDocuments(t).then(
        () => assert.fail("The check passed"),
        (failure: Error) => failure,
    )
    assert.deepEqual(error.message.match(new RegExp(id, "g")), [id])
    await t.run((ctx) => ctx.db.delete(id))
})

test("Every backend test builds its backend through convexBackend", () => {
    const folder = new URL("./", import.meta.url),
        direct = readdirSync(folder).filter(
            (name) =>
                name.endsWith(".ts") &&
                name !== "convex-backend.ts" &&
                name !== "document-limits.test.ts" &&
                readFileSync(new URL(name, folder), "utf8").includes('from "convex-test"'),
        )
    assert.deepEqual(direct, [])
})

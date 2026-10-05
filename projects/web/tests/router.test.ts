import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { test } from "node:test"

// The route tree imports the stylesheet's address, which only Vite can resolve, so the test reads an empty one
registerHooks({
    load: (url, context, next) =>
        new URL(url).pathname.endsWith(".css")
            ? { format: "module", source: 'export default ""', shortCircuit: true }
            : next(url, context),
})
const { createMemoryHistory } = await import("@tanstack/react-router")
const { getRouter } = await import("../src/router.tsx")

test("The router keeps a server ID too long for a number in the links the bot posts and writes them back unquoted", async () => {
    const router = getRouter()
    router.update({
        ...router.options,
        history: createMemoryHistory({ initialEntries: ["/?server=1546006414139338753&section=general"] }),
    })
    await router.load()
    assert.deepEqual(router.state.location.search, { server: "1546006414139338753", section: "general" })
    const link = router.buildLocation({ to: "/", search: { server: "1546006414139338753", section: "logs" } })
    assert.equal(link.href, "/?server=1546006414139338753&section=logs")
})

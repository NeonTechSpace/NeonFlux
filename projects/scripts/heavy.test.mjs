import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const gate = fileURLToPath(new URL("./heavy.mjs", import.meta.url))

test(
    "hanging up the gate's terminal stops its command and frees the slot",
    { skip: process.platform === "win32" },
    async (t) => {
        // The gate keeps its locks in its own temporary folder and takes a real slot, even under another gate
        const folder = mkdtempSync(join(tmpdir(), "neonflux-heavy-test-"))
        t.after(() => rmSync(folder, { recursive: true, force: true }))
        const { NEONFLUX_HEAVY_SLOT: _held, ...env } = process.env
        const running = spawn(
            process.execPath,
            [gate, process.execPath, "-e", "console.log(process.pid); setInterval(() => {}, 1000)"],
            { env: { ...env, TMPDIR: folder, NEONFLUX_HEAVY_SLOTS: "1" }, stdio: ["ignore", "pipe", "inherit"] },
        )
        const exited = once(running, "exit")
        // The command prints its PID once it runs
        // A gate that exits first fails the test instead of leaving it waiting
        const [line] = await Promise.race([
            once(running.stdout, "data"),
            exited.then(([code]) => assert.fail(`The gate exited with ${code} before the command printed its PID`)),
        ])
        const pid = Number(String(line).trim())
        assert.ok(pid > 0)
        // A command the gate left behind must not outlive the test
        t.after(() => {
            try {
                process.kill(pid, "SIGKILL")
            } catch {}
        })
        assert.equal(readdirSync(join(folder, "neonflux-heavy")).length, 1)
        running.kill("SIGHUP")
        await exited
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
        assert.deepEqual(readdirSync(join(folder, "neonflux-heavy")), [])
    },
)

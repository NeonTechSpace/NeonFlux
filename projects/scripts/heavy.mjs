// Runs a machine-heavy command only when one of a few machine-wide slots is free, so parallel agents and terminals queue
// instead of saturating the host. Local runs get half as many slots as logical threads, at least one and at most four,
// like the SDK's test workers. CI runners are dedicated. NEONFLUX_HEAVY_SLOTS overrides the limit, and nested runs reuse
// the held slot. Arguments reach the command unchanged. `--shell "<command>"` runs one command line through the shell instead
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { availableParallelism, tmpdir } from "node:os"
import { delimiter, extname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

const shell = process.argv[2] === "--shell"
const args = process.argv.slice(shell ? 3 : 2)
if (!args.length || (shell && args.length !== 1)) {
    console.error(
        'Usage: node scripts/heavy.mjs <command> [arguments...] or node scripts/heavy.mjs --shell "<command line>"',
    )
    process.exit(2)
}
const override = Number(process.env.NEONFLUX_HEAVY_SLOTS)
if (process.env.NEONFLUX_HEAVY_SLOTS && !(Number.isInteger(override) && override > 0))
    console.error("Ignoring NEONFLUX_HEAVY_SLOTS, it must be a positive integer")
const slots =
    Number.isInteger(override) && override > 0
        ? override
        : process.env.CI
          ? availableParallelism()
          : Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)))
const directory = join(tmpdir(), "neonflux-heavy")
// Lock files are named slot-<slot>-<pid>-<time>-<random>.lock, so no name is ever used twice
const name = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.lock`

const modified = (path) => {
    try {
        return statSync(path).mtimeMs
    } catch {
        return undefined
    }
}
const alive = (pid) => {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return error.code === "EPERM"
    }
}
// Holders touch their lock every 10 seconds. A lock whose time this process saw stand still for this long, measured on its
// own clock, has no live gate behind it, even when its PID now belongs to an unrelated process. Machine sleep pauses both
// clocks alike, so a sleeping holder is never evicted for the time it slept
const silentMs = 45_000
const seen = new Map()
function silent(path) {
    const mtime = modified(path),
        now = performance.now(),
        last = seen.get(path)
    if (mtime === undefined) return false
    if (last?.mtime !== mtime) {
        seen.set(path, { mtime, since: now })
        return false
    }
    return now - last.since >= silentMs
}
// A lock of a dead or silent holder is deleted by its own name, which only that lock ever had
function live(file) {
    const path = join(directory, file)
    if (alive(Number(file.split("-")[2])) && !silent(path)) return true
    try {
        rmSync(path, { force: true })
    } catch {}
    seen.delete(path)
    return false
}
// Race-free without file locking: a gate keeps its new lock only if no other live lock of the slot exists after creating it, so of two racing gates at least the later one sees the other and backs off
function acquire() {
    for (let slot = 0; slot < slots; slot++) {
        const prefix = `slot-${slot}-`,
            path = join(directory, prefix + name)
        const others = () =>
            readdirSync(directory).some((file) => file.startsWith(prefix) && file !== prefix + name && live(file))
        if (others()) continue
        writeFileSync(path, "", { flag: "wx" })
        if (!others()) return path
        rmSync(path, { force: true })
    }
}

let lock, child
if (process.env.NEONFLUX_HEAVY_SLOT !== "held") {
    mkdirSync(directory, { recursive: true })
    let waiting = false
    while (!(lock = acquire())) {
        if (!waiting) {
            console.error(`Waiting for one of ${slots} heavy-task slots`)
            waiting = true
        }
        // Gates that backed off from the same slot retry at different times
        await sleep(250 + Math.random() * 500)
    }
    setInterval(() => {
        try {
            utimesSync(lock, new Date(), new Date())
        } catch {}
    }, 10_000).unref()
    process.on("exit", () => rmSync(lock, { force: true }))
}

// Windows starts package binaries through their .cmd shims, which only cmd.exe runs. Each argument is quoted for the program
// and its characters escaped for cmd.exe, twice for a shim because the shim's own command line is parsed once more
const meta = /([()\][%!^"`<>&|;, *?])/g
function windowsCommand(file, values) {
    const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
    const found = extname(file)
        ? file
        : ([process.cwd(), ...(process.env.PATH ?? "").split(delimiter)]
              .flatMap((dir) => extensions.map((ext) => join(dir, file + ext)))
              .find(existsSync) ?? file)
    const shim = /\.(cmd|bat)$/i.test(found)
    const quote = (value) => {
        const quoted = `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`.replace(meta, "^$1")
        return shim ? quoted.replace(meta, "^$1") : quoted
    }
    return [found.replace(meta, "^$1"), ...values.map(quote)].join(" ")
}
const env = { ...process.env, NEONFLUX_HEAVY_SLOT: "held" }
// POSIX children get their own process group, so stopping the gate, or hanging up its terminal, stops every process the
// command started
const group = process.platform !== "win32"
child = shell
    ? spawn(args[0], { stdio: "inherit", shell: true, env, detached: group })
    : process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${windowsCommand(args[0], args.slice(1))}"`], {
            stdio: "inherit",
            env,
            windowsVerbatimArguments: true,
        })
      : spawn(args[0], args.slice(1), { stdio: "inherit", env, detached: true })
// Stop the whole child tree and keep the slot until it has exited
const stop = () => {
    if (!child?.pid) process.exit(130)
    if (process.platform === "win32")
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
    else
        try {
            process.kill(group ? -child.pid : child.pid, "SIGTERM")
        } catch {}
}
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) process.on(signal, stop)
child.on("error", (error) => {
    console.error(`Could not start ${args[0]}: ${error.message}`)
    process.exit(127)
})
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)))

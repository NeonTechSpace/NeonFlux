// Runs a machine-heavy command only when one of a few machine-wide slots is free, so parallel agents and terminals queue
// instead of saturating the host. Local runs get half as many slots as logical threads, at least one and at most four,
// like the SDK's test workers. CI runners are dedicated. NEONFLUX_HEAVY_SLOTS overrides the limit, and nested runs reuse
// the held slot. One argument is run as a shell command. Several arguments must be plain words, because no quoting is
// safe in both cmd.exe and sh
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const args = process.argv.slice(2)
if (!args.length) { console.error('Usage: node scripts/heavy.mjs <command> [arguments...]'); process.exit(2) }
if (args.length > 1 && !args.every(arg => /^[\w./:=@+,*-]+$/.test(arg))) { console.error('Pass shell syntax as one quoted command. Separate arguments may only use letters, digits and ./:=@+,*-'); process.exit(2) }
const command = args.join(' ')
const override = Number(process.env.NEONFLUX_HEAVY_SLOTS)
if (process.env.NEONFLUX_HEAVY_SLOTS && !(Number.isInteger(override) && override > 0)) console.error('Ignoring NEONFLUX_HEAVY_SLOTS, it must be a positive integer')
const slots = Number.isInteger(override) && override > 0 ? override : process.env.CI ? availableParallelism() : Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)))
const directory = join(tmpdir(), 'neonflux-heavy')
const owner = String(process.pid)

const read = path => { try { return readFileSync(path, 'utf8') } catch { return undefined } }
const alive = pid => { try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' } }
// Holders touch their lock every 10 seconds, so a live PID behind an untouched lock was reused by an unrelated process
const touched = path => { try { return Date.now() - statSync(path).mtimeMs < 60_000 } catch { return true } }
function acquire() {
  for (let slot = 0; slot < slots; slot++) {
    const path = join(directory, `slot-${slot}.lock`)
    try { writeFileSync(path, owner, { flag: 'wx' }); return path } catch (error) { if (error.code !== 'EEXIST') throw error }
    // An empty or vanished file belongs to a creator or releaser mid-step. Only a readable dead or silent owner is reclaimed
    const holder = read(path)
    if (holder && (!alive(Number(holder)) || !touched(path)) && read(path) === holder) { rmSync(path, { force: true }); slot-- }
  }
}

let lock, child
if (process.env.NEONFLUX_HEAVY_SLOT !== 'held') {
  mkdirSync(directory, { recursive: true })
  let waiting = false
  while (!(lock = acquire())) {
    if (!waiting) { console.error(`Waiting for one of ${slots} heavy-task slots`); waiting = true }
    await sleep(500)
  }
  setInterval(() => { try { if (read(lock) === owner) utimesSync(lock, new Date(), new Date()) } catch {} }, 10_000).unref()
  process.on('exit', () => { if (read(lock) === owner) rmSync(lock, { force: true }) })
}
// Stop the whole child tree and keep the slot until it has exited
const stop = () => {
  if (!child?.pid) process.exit(130)
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGTERM')
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, stop)

child = spawn(command, { stdio: 'inherit', shell: true, env: { ...process.env, NEONFLUX_HEAVY_SLOT: 'held' } })
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))

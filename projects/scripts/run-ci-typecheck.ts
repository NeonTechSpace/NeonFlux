import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const phaseNames = ['Build runtime packages', 'Type-check Convex', 'Type-check workspace', 'Type-check configuration'];

export function readCiMaxWorkers(value: string | undefined): number {
    if (!value || !/^[1-9]\d*$/u.test(value)) throw new Error('CI_MAX_WORKERS must be a positive integer.');
    const workers = Number(value);
    if (!Number.isSafeInteger(workers)) throw new Error('CI_MAX_WORKERS must be a positive integer.');
    return workers;
}

export function createCiTypecheckCommands(workers: number): string[][] {
    const concurrency = `--workspace-concurrency=${String(workers)}`;
    return [
        [concurrency, '-r', '--filter', './packages/*', 'build'],
        ['convex:typecheck'],
        [concurrency, '-r', 'typecheck'],
        ['typecheck:configs'],
    ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const workers = readCiMaxWorkers(process.env.CI_MAX_WORKERS);
        const commands = createCiTypecheckCommands(workers);
        for (const [index, args] of commands.entries()) {
            await runPhase(phaseNames[index] ?? `Type-check phase ${String(index + 1)}`, args);
        }
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'CI typecheck failed.'}\n`);
        process.exitCode = 1;
    }
}

async function runPhase(name: string, args: readonly string[]): Promise<void> {
    const startedAt = performance.now();
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
    process.stdout.write(isGitHubActions ? `::group::${name}\n` : `\n==> ${name}\n`);

    try {
        await runPnpm(args);
        process.stdout.write(`${name} completed in ${formatDuration(performance.now() - startedAt)}.\n`);
    } finally {
        if (isGitHubActions) process.stdout.write('::endgroup::\n');
    }
}

function formatDuration(milliseconds: number): string {
    return `${(milliseconds / 1000).toFixed(1)}s`;
}

async function runPnpm(args: readonly string[]): Promise<void> {
    const pnpmCli = process.env.npm_execpath;
    const command = pnpmCli ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const commandArgs = pnpmCli ? [pnpmCli, ...args] : args;
    await new Promise<void>((resolvePromise, reject) => {
        const child = spawn(command, commandArgs, { stdio: 'inherit' });
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (code === 0) resolvePromise();
            else reject(new Error(signal ? `pnpm stopped by ${signal}.` : `pnpm exited with code ${String(code)}.`));
        });
    });
}

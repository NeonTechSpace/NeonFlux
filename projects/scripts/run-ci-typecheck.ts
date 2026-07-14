import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

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
        for (const args of createCiTypecheckCommands(workers)) await runPnpm(args);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'CI typecheck failed.'}\n`);
        process.exitCode = 1;
    }
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

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type SmokeMetadata = {
    pid: number;
    startedAt: string;
    cwd: string;
    command: string;
    args: string[];
    stdout: string;
    stderr: string;
};

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const smokeDir = join(projectRoot, 'data', 'dev-bot-smoke');
const metadataPath = join(smokeDir, 'process.json');

const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm';
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm dev:bot'] : ['dev:bot'];

const action = process.argv[2];

if (action === 'start') {
    startDevBot();
} else if (action === 'status') {
    printStatus();
} else if (action === 'stop') {
    stopDevBot();
} else {
    process.stderr.write('Usage: pnpm dev:bot:smoke <start|status|stop>\n');
    process.exitCode = 1;
}

function startDevBot(): void {
    mkdirSync(smokeDir, { recursive: true });

    const existingMetadata = readMetadata();
    if (existingMetadata && isProcessRunning(existingMetadata.pid)) {
        process.stderr.write(`Dev bot smoke process is already running with PID ${String(existingMetadata.pid)}.\n`);
        process.exitCode = 1;
        return;
    }

    const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
    const stdout = join(smokeDir, `bot-${stamp}.out.log`);
    const stderr = join(smokeDir, `bot-${stamp}.err.log`);
    const pid = process.platform === 'win32' ? startWindowsProcess(stdout, stderr) : startPosixProcess(stdout, stderr);
    const metadata: SmokeMetadata = {
        pid,
        startedAt: new Date().toISOString(),
        cwd: projectRoot,
        command,
        args,
        stdout,
        stderr,
    };

    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
}

function printStatus(): void {
    const metadata = readMetadata();

    if (!metadata) {
        process.stdout.write(`${JSON.stringify({ running: false, metadataExists: false }, null, 2)}\n`);
        return;
    }
    const running =
        process.platform === 'win32' ? getWindowsBotProcessIds().length > 0 : isProcessRunning(metadata.pid);

    process.stdout.write(
        `${JSON.stringify(
            {
                running,
                metadata,
            },
            null,
            2
        )}\n`
    );
}

function stopDevBot(): void {
    const metadata = readMetadata();

    if (!metadata) {
        process.stdout.write('No dev bot smoke process metadata found.\n');
        return;
    }

    if (process.platform === 'win32') {
        stopWindowsBotProcesses(metadata.pid);
    } else if (isProcessRunning(metadata.pid)) {
        stopProcessTree(metadata.pid);
    }

    rmSync(metadataPath, { force: true });
    process.stdout.write(`Stopped dev bot smoke process ${String(metadata.pid)}.\n`);
}

function readMetadata(): SmokeMetadata | undefined {
    if (!existsSync(metadataPath)) {
        return undefined;
    }

    return JSON.parse(readFileSync(metadataPath, 'utf8')) as SmokeMetadata;
}

function startPosixProcess(stdout: string, stderr: string): number {
    const stdoutFd = openSync(stdout, 'a');
    const stderrFd = openSync(stderr, 'a');

    try {
        const child = spawn(command, args, {
            cwd: projectRoot,
            detached: process.platform !== 'win32',
            stdio: ['ignore', stdoutFd, stderrFd],
            windowsHide: true,
        });

        if (!child.pid) {
            throw new Error('Failed to start dev bot smoke process.');
        }

        child.unref();

        return child.pid;
    } finally {
        closeSync(stdoutFd);
        closeSync(stderrFd);
    }
}

function startWindowsProcess(stdout: string, stderr: string): number {
    const pnpmCommand = resolveWindowsPnpmCommand();
    const script = `
$ErrorActionPreference = 'Stop'
$startup = ([wmiclass]'Win32_ProcessStartup').CreateInstance()
$startup.ShowWindow = 0
$commandLine = 'cmd.exe /d /s /c ""${escapePowerShellString(pnpmCommand)}" dev:bot 1>>"${escapePowerShellString(stdout)}" 2>>"${escapePowerShellString(stderr)}""'
$result = ([wmiclass]'Win32_Process').Create($commandLine, '${escapePowerShellString(projectRoot)}', $startup)
@{ ReturnValue = $result.ReturnValue; ProcessId = $result.ProcessId } | ConvertTo-Json
`;
    const result = runPowerShell(script);

    if (result.status !== 0 || result.stdout.trim().length === 0) {
        throw new Error('Failed to start hidden dev bot smoke process.');
    }

    const parsed = JSON.parse(result.stdout) as { ReturnValue: number; ProcessId: number };

    if (parsed.ReturnValue !== 0 || !Number.isInteger(parsed.ProcessId) || parsed.ProcessId <= 0) {
        throw new Error('Hidden dev bot smoke process did not return a valid PID.');
    }

    return parsed.ProcessId;
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function stopProcessTree(pid: number): void {
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
        });
        return;
    }

    try {
        process.kill(-pid, 'SIGTERM');
    } catch {
        process.kill(pid, 'SIGTERM');
    }
}

function resolveWindowsPnpmCommand(): string {
    const result = spawnSync('where.exe', ['pnpm.cmd'], {
        encoding: 'utf8',
        windowsHide: true,
    });
    const firstMatch = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);

    return firstMatch ?? 'pnpm.cmd';
}

function escapePowerShellString(value: string): string {
    return value.replaceAll("'", "''");
}

function getWindowsBotProcessIds(): number[] {
    const script = `
$processes = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and
    $_.CommandLine -notlike '*dev:bot:smoke*' -and
    (
        $_.CommandLine -like '*pnpm.mjs*dev:bot*' -or
        $_.CommandLine -like '*tsx watch src/index.ts*' -or
        $_.CommandLine -like '*apps\\\\bot*src/index.ts*'
    )
} | Select-Object -ExpandProperty ProcessId
$processes | ConvertTo-Json
`;
    const result = runPowerShell(script);

    if (result.status !== 0 || result.stdout.trim().length === 0) {
        return [];
    }

    const parsed = JSON.parse(result.stdout) as number | number[];

    return Array.isArray(parsed) ? parsed : [parsed];
}

function stopWindowsBotProcesses(fallbackPid: number): void {
    const processIds = new Set([...getWindowsBotProcessIds(), fallbackPid]);

    for (const pid of processIds) {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
        });
    }
}

function runPowerShell(script: string): { status: number | null; stdout: string } {
    const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
    const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
        {
            cwd: projectRoot,
            encoding: 'utf8',
            windowsHide: true,
        }
    );

    return {
        status: result.status,
        stdout: result.stdout,
    };
}

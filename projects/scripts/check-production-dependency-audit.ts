import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type AuditFinding = {
    dev: boolean;
    paths: string[];
    version: string;
};

type AuditAdvisory = {
    findings: AuditFinding[];
    github_advisory_id: string;
    module_name: string;
    severity: string;
    title: string;
};

export type ProductionAuditReport = {
    advisories: Record<string, AuditAdvisory>;
};

export type DependencyAuditException = {
    advisoryId: string;
    counterevidence: string;
    dependencyPath: string;
    expiresOn: string;
    invalidationCondition: string;
    owner: string;
    package: string;
    reason: string;
    runtimeReachability: string;
    vulnerableVersion: string;
};

type ExceptionFile = {
    exceptions: DependencyAuditException[];
    version: 1;
};

export type ProductionAuditPath = {
    advisoryId: string;
    dependencyPath: string;
    package: string;
    severity: string;
    title: string;
    vulnerableVersion: string;
};

export type ProductionAuditEvaluation = {
    activeExceptions: DependencyAuditException[];
    expiredExceptions: DependencyAuditException[];
    staleExceptions: DependencyAuditException[];
    unexceptedPaths: ProductionAuditPath[];
};

const workspaceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exceptionFilePath = resolve(workspaceDirectory, 'dependency-audit-exceptions.json');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [serializedReport, serializedExceptions] = await Promise.all([
            runProductionAudit(),
            readFile(exceptionFilePath, 'utf8'),
        ]);
        const report = parseProductionAuditReport(serializedReport);
        const exceptions = parseDependencyAuditExceptions(serializedExceptions);
        const result = evaluateProductionAudit(report, exceptions, new Date());
        reportEvaluation(result);
    } catch (error) {
        process.stderr.write(
            `${error instanceof Error ? error.message : 'Production dependency audit failed unexpectedly.'}\n`
        );
        process.exitCode = 1;
    }
}

export function parseProductionAuditReport(serialized: string): ProductionAuditReport {
    let value: unknown;
    try {
        value = JSON.parse(serialized) as unknown;
    } catch {
        throw new Error('Production dependency audit returned malformed JSON.');
    }
    if (!isRecord(value) || !isRecord(value.advisories)) {
        throw new Error('Production dependency audit omitted its advisory map.');
    }

    const advisories: Record<string, AuditAdvisory> = {};
    for (const [id, advisory] of Object.entries(value.advisories)) {
        if (!isRecord(advisory) || !Array.isArray(advisory.findings)) {
            throw new Error(`Production dependency advisory ${id} is malformed.`);
        }
        if (
            typeof advisory.github_advisory_id !== 'string' ||
            typeof advisory.module_name !== 'string' ||
            typeof advisory.severity !== 'string' ||
            typeof advisory.title !== 'string'
        ) {
            throw new Error(`Production dependency advisory ${id} omitted required identity fields.`);
        }
        const findings = advisory.findings.map((finding) => {
            if (
                !isRecord(finding) ||
                typeof finding.dev !== 'boolean' ||
                typeof finding.version !== 'string' ||
                !Array.isArray(finding.paths) ||
                finding.paths.some((path) => typeof path !== 'string')
            ) {
                throw new Error(`Production dependency advisory ${id} contains a malformed finding.`);
            }
            return finding as AuditFinding;
        });
        advisories[id] = { ...advisory, findings } as AuditAdvisory;
    }
    return { advisories };
}

export function parseDependencyAuditExceptions(serialized: string): DependencyAuditException[] {
    let value: unknown;
    try {
        value = JSON.parse(serialized) as unknown;
    } catch {
        throw new Error('Dependency audit exceptions file contains malformed JSON.');
    }
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.exceptions)) {
        throw new Error('Dependency audit exceptions file must use version 1 with an exceptions array.');
    }

    const parsed = value as ExceptionFile;
    const seen = new Set<string>();
    for (const [index, exception] of parsed.exceptions.entries()) {
        if (!isRecord(exception)) throw new Error(`Dependency audit exception ${String(index)} is malformed.`);
        for (const field of [
            'advisoryId',
            'counterevidence',
            'dependencyPath',
            'expiresOn',
            'invalidationCondition',
            'owner',
            'package',
            'reason',
            'runtimeReachability',
            'vulnerableVersion',
        ] as const) {
            if (typeof exception[field] !== 'string' || exception[field].trim() === '') {
                throw new Error(`Dependency audit exception ${String(index)} requires ${field}.`);
            }
        }
        if (
            !/^\d{4}-\d{2}-\d{2}$/u.test(exception.expiresOn) ||
            Number.isNaN(Date.parse(`${exception.expiresOn}T00:00:00Z`))
        ) {
            throw new Error(`Dependency audit exception ${String(index)} has an invalid expiresOn date.`);
        }
        const identity = exceptionIdentity(exception);
        if (seen.has(identity)) throw new Error(`Dependency audit exception ${String(index)} duplicates ${identity}.`);
        seen.add(identity);
    }
    return parsed.exceptions;
}

export function evaluateProductionAudit(
    report: ProductionAuditReport,
    exceptions: readonly DependencyAuditException[],
    now: Date
): ProductionAuditEvaluation {
    if (Number.isNaN(now.getTime())) throw new Error('Dependency audit evaluation requires a valid clock.');

    const paths = flattenProductionAuditPaths(report);
    const today = now.toISOString().slice(0, 10);
    const expiredExceptions = exceptions.filter((exception) => exception.expiresOn < today);
    const activeExceptions = exceptions.filter((exception) => exception.expiresOn >= today);
    const activeIdentities = new Set(activeExceptions.map(exceptionIdentity));
    const pathIdentities = new Set(paths.map(exceptionIdentity));

    return {
        activeExceptions,
        expiredExceptions,
        staleExceptions: activeExceptions.filter((exception) => !pathIdentities.has(exceptionIdentity(exception))),
        unexceptedPaths: paths.filter((path) => !activeIdentities.has(exceptionIdentity(path))),
    };
}

export function flattenProductionAuditPaths(report: ProductionAuditReport): ProductionAuditPath[] {
    return Object.values(report.advisories).flatMap((advisory) =>
        advisory.findings.flatMap((finding) =>
            finding.dev
                ? []
                : finding.paths.map((dependencyPath) => ({
                      advisoryId: advisory.github_advisory_id,
                      dependencyPath,
                      package: advisory.module_name,
                      severity: advisory.severity,
                      title: advisory.title,
                      vulnerableVersion: finding.version,
                  }))
        )
    );
}

async function runProductionAudit(): Promise<string> {
    const pnpmEntrypoint = process.env.npm_execpath;
    if (!pnpmEntrypoint) throw new Error('Production dependency audit must be started through a pnpm script.');

    const child = spawn(process.execPath, [pnpmEntrypoint, 'audit', '--prod', '--json'], {
        cwd: workspaceDirectory,
        env: process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    const output: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    const exitCode = await new Promise<number>((resolveExit, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolveExit(code ?? 2));
    });
    if (exitCode !== 0 && exitCode !== 1) {
        throw new Error(`pnpm production audit could not complete (exit code ${String(exitCode)}).`);
    }
    return Buffer.concat(output).toString('utf8');
}

function reportEvaluation(result: ProductionAuditEvaluation): void {
    const failures = [
        ...result.unexceptedPaths.map(
            (path) =>
                `Unexcepted ${path.severity} advisory ${path.advisoryId}: ${path.package}@${path.vulnerableVersion} via ${path.dependencyPath}`
        ),
        ...result.expiredExceptions.map(
            (exception) =>
                `Expired exception ${exception.advisoryId}: ${exception.package}@${exception.vulnerableVersion} via ${exception.dependencyPath}`
        ),
        ...result.staleExceptions.map(
            (exception) =>
                `Stale exception ${exception.advisoryId}: ${exception.package}@${exception.vulnerableVersion} via ${exception.dependencyPath}`
        ),
    ];
    if (failures.length > 0) throw new Error(failures.join('\n'));

    process.stdout.write(
        `Production dependency audit passed with ${String(result.activeExceptions.length)} exact active exception(s).\n`
    );
}

function exceptionIdentity(input: {
    advisoryId: string;
    dependencyPath: string;
    package: string;
    vulnerableVersion: string;
}): string {
    return [input.advisoryId, input.package, input.vulnerableVersion, input.dependencyPath].join('\u0000');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const checkedRoots = ['apps', 'packages', 'convex'] as const;
const checkedExtensions = new Set([
    '.cjs',
    '.cts',
    '.d.ts',
    '.js',
    '.jsx',
    '.json',
    '.md',
    '.mdx',
    '.mjs',
    '.mts',
    '.ts',
    '.tsx',
]);
const ignoredSegments = new Set(['node_modules', 'coverage', '.output', '.turbo', '.vite', '.vitest']);

type BannedPattern = {
    label: string;
    pattern: RegExp;
};

type PatternViolation = {
    column: number;
    file: string;
    label: string;
    line: number;
    text: string;
};

const bannedPatterns: BannedPattern[] = [
    { label: 'legacyId', pattern: /\blegacyId\b/g },
    { label: '*LegacyId', pattern: /\b[A-Za-z0-9_]+LegacyId\b/g },
    { label: 'by_legacy', pattern: /\bby_legacy\b/g },
    { label: 'anyApi', pattern: /\banyApi\b/g },
    { label: 'convexApi facade access', pattern: /\bconvexApi\./g },
    { label: 'runtime API shape cast', pattern: /\bapi\s+as\s+unknown\s+as\b/g },
    { label: 'old Convex API package boundary', pattern: /@neonflux\/convex\/api/g },
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const violations = await findMigrationEraPatternViolations(process.cwd());

    if (violations.length > 0) {
        process.stderr.write(formatPatternViolations(violations));
        process.exitCode = 1;
    }
}

export async function findMigrationEraPatternViolations(workspaceRoot: string): Promise<PatternViolation[]> {
    const violations: PatternViolation[] = [];

    for (const root of checkedRoots) {
        const rootPath = join(workspaceRoot, root);

        for await (const file of walkFiles(rootPath, workspaceRoot)) {
            if (!shouldCheckFile(file, workspaceRoot)) {
                continue;
            }

            const text = await readFile(file, 'utf8');

            violations.push(...findViolationsInFile(workspaceRoot, file, text));
        }
    }

    return violations;
}

export function formatPatternViolations(violations: readonly PatternViolation[]): string {
    const header = 'Migration-era Convex patterns are not allowed:\n';
    const body = violations
        .map((violation) => {
            return `${violation.file}:${String(violation.line)}:${String(violation.column)} ${violation.label}: ${violation.text}`;
        })
        .join('\n');

    return `${header}${body}\n`;
}

function findViolationsInFile(workspaceRoot: string, file: string, text: string): PatternViolation[] {
    const relativeFile = normalizePath(relative(workspaceRoot, file));
    const violations: PatternViolation[] = [];
    const lines = text.split(/\r?\n/u);

    for (const [lineIndex, line] of lines.entries()) {
        for (const bannedPattern of bannedPatterns) {
            bannedPattern.pattern.lastIndex = 0;

            for (const match of line.matchAll(bannedPattern.pattern)) {
                violations.push({
                    column: match.index + 1,
                    file: relativeFile,
                    label: bannedPattern.label,
                    line: lineIndex + 1,
                    text: line.trim(),
                });
            }
        }
    }

    return violations;
}

async function* walkFiles(directory: string, workspaceRoot: string): AsyncGenerator<string> {
    let entries;

    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
            if (!shouldEnterDirectory(path, workspaceRoot)) {
                continue;
            }

            yield* walkFiles(path, workspaceRoot);
        } else if (entry.isFile()) {
            yield path;
        }
    }
}

function shouldEnterDirectory(directory: string, workspaceRoot: string): boolean {
    const segments = normalizePath(relative(workspaceRoot, directory)).split('/');

    if (segments.some((segment) => ignoredSegments.has(segment))) {
        return false;
    }

    return !segments.includes('_generated');
}

function shouldCheckFile(file: string, workspaceRoot: string): boolean {
    const relativeFile = normalizePath(relative(workspaceRoot, file));

    if (relativeFile.includes('/_generated/')) {
        return false;
    }

    return checkedExtensions.has(extname(file));
}

function normalizePath(path: string): string {
    return sep === '/' ? path : path.split(sep).join('/');
}

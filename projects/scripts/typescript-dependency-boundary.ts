import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import ts from 'typescript';

export type TypeScriptDependencyBoundary = {
    entryPath: string;
    forbiddenStringLiterals: readonly string[];
    ignoreRelativeImport?: (input: { importer: string; sourceRoot: string; specifier: string }) => boolean;
    label: string;
    sourceRoot: string;
};

export async function assertTypeScriptDependencyBoundary(boundary: TypeScriptDependencyBoundary): Promise<void> {
    const normalizedRoot = resolve(boundary.sourceRoot);
    const visited = new Set<string>();
    const forbidden = new Set(boundary.forbiddenStringLiterals);

    async function visit(modulePath: string, chain: string[]): Promise<void> {
        const normalizedPath = resolve(modulePath);
        assertPathInsideSourceRoot(normalizedPath, normalizedRoot, boundary.label);
        if (visited.has(normalizedPath)) return;
        visited.add(normalizedPath);

        const source = await readFile(normalizedPath, 'utf8');
        const sourceFile = ts.createSourceFile(normalizedPath, source, ts.ScriptTarget.Latest, true);
        const forbiddenLiteral = findStringLiteral(sourceFile, forbidden);
        if (forbiddenLiteral) {
            const pathChain = [...chain, normalizedPath]
                .map((path) => relative(normalizedRoot, path).replaceAll('\\', '/'))
                .join(' -> ');
            throw new Error(`${boundary.label} reaches forbidden literal ${forbiddenLiteral} through ${pathChain}.`);
        }

        for (const specifier of moduleSpecifiers(sourceFile)) {
            if (!specifier.startsWith('.')) continue;
            if (
                boundary.ignoreRelativeImport?.({
                    importer: normalizedPath,
                    sourceRoot: normalizedRoot,
                    specifier,
                })
            ) {
                continue;
            }
            const dependency = await resolveTypeScriptModule(normalizedPath, specifier, normalizedRoot, boundary.label);
            await visit(dependency, [...chain, normalizedPath]);
        }
    }

    await visit(boundary.entryPath, []);
}

export function isGeneratedConvexImport(input: { importer: string; sourceRoot: string; specifier: string }): boolean {
    const unresolved = resolve(dirname(input.importer), input.specifier);
    const pathFromRoot = relative(input.sourceRoot, unresolved).replaceAll('\\', '/');
    return pathFromRoot === '_generated' || pathFromRoot.startsWith('_generated/');
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
    const specifiers: string[] = [];
    const visit = (node: ts.Node): void => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteralLike(node.moduleSpecifier)
        ) {
            specifiers.push(node.moduleSpecifier.text);
        } else if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments.length === 1 &&
            node.arguments[0] &&
            ts.isStringLiteralLike(node.arguments[0])
        ) {
            specifiers.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return specifiers;
}

function findStringLiteral(sourceFile: ts.SourceFile, forbidden: ReadonlySet<string>): string | undefined {
    let match: string | undefined;
    const visit = (node: ts.Node): void => {
        if (!match && ts.isStringLiteralLike(node) && forbidden.has(node.text)) match = node.text;
        if (!match) ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return match;
}

async function resolveTypeScriptModule(
    importer: string,
    specifier: string,
    sourceRoot: string,
    label: string
): Promise<string> {
    const unresolved = resolve(dirname(importer), specifier);
    assertPathInsideSourceRoot(unresolved, sourceRoot, label);
    const candidates = /\.[cm]?js$/u.test(unresolved)
        ? [unresolved.replace(/\.[cm]?js$/u, '.ts'), unresolved.replace(/\.[cm]?js$/u, '.tsx')]
        : [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`, resolve(unresolved, 'index.ts')];
    for (const candidate of candidates) {
        try {
            await readFile(candidate, 'utf8');
            return candidate;
        } catch {
            // Try the next TypeScript source candidate.
        }
    }
    throw new Error(`${label} cannot resolve relative dependency ${specifier} imported by ${importer}.`);
}

function assertPathInsideSourceRoot(path: string, sourceRoot: string, label: string): void {
    const pathFromRoot = relative(sourceRoot, path);
    if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
        throw new Error(`${label} dependency escapes its source root: ${path}.`);
    }
}

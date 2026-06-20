import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(new URL('./validate-release-tag.mjs', import.meta.url));
const temporaryRepos: string[] = [];

afterEach(() => {
    for (const repoPath of temporaryRepos.splice(0)) {
        rmSync(repoPath, { recursive: true, force: true });
    }
});

describe('validate-release-tag', () => {
    it('accepts an exact component release tag and writes GitHub outputs', () => {
        const repoPath = createGitRepo();
        const outputPath = join(repoPath, 'github-output.txt');

        const result = runValidator(repoPath, 'web-v1.2.3', outputPath);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Release tag accepted: web-v1.2.3; no previous web tag was found.');
        expect(readFileSync(outputPath, 'utf8')).toBe('component=web\nversion=1.2.3\ntag_name=web-v1.2.3\n');
    });

    it('rejects loose or malformed release tags with a clear message', () => {
        const repoPath = createGitRepo();

        const result = runValidator(repoPath, 'web-v1.2');

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Release tag "web-v1.2" is invalid. Use exactly web-vX.Y.Z or bot-vX.Y.Z.');
    });

    it('rejects versions lower than the latest same-component tag', () => {
        const repoPath = createGitRepo(['web-v1.2.0', 'web-v1.3.0']);

        const result = runValidator(repoPath, 'web-v1.2.9');

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Release tag "web-v1.2.9" must be newer than latest web tag "web-v1.3.0".');
    });

    it('accepts versions higher than the latest same-component tag', () => {
        const repoPath = createGitRepo(['web-v1.2.0', 'web-v1.3.0']);

        const result = runValidator(repoPath, 'web-v1.4.0');

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Release tag accepted: web-v1.4.0; previous web tag is web-v1.3.0.');
    });

    it('ignores malformed historical tags in the same prefix', () => {
        const repoPath = createGitRepo(['web-vold', 'web-v1.0.0']);

        const result = runValidator(repoPath, 'web-v1.1.0');

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Release tag accepted: web-v1.1.0; previous web tag is web-v1.0.0.');
    });

    it('keeps bot and web version streams independent', () => {
        const repoPath = createGitRepo(['web-v9.0.0']);

        const result = runValidator(repoPath, 'bot-v1.0.0');

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Release tag accepted: bot-v1.0.0; no previous bot tag was found.');
    });
});

function createGitRepo(tags: string[] = []): string {
    const repoPath = mkdtempSync(join(tmpdir(), 'neonflux-release-tag-'));
    temporaryRepos.push(repoPath);

    git(repoPath, ['init', '--quiet']);
    const objectId = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: repoPath,
        encoding: 'utf8',
        input: 'neonflux release tag test',
    }).trim();

    for (const tag of tags) {
        git(repoPath, ['tag', tag, objectId]);
    }

    return repoPath;
}

function git(cwd: string, args: string[]): void {
    execFileSync('git', args, {
        cwd,
        stdio: 'ignore',
    });
}

function runValidator(cwd: string, tagName: string, outputPath?: string) {
    return spawnSync(process.execPath, [scriptPath, tagName, ...(outputPath ? [outputPath] : [])], {
        cwd,
        encoding: 'utf8',
        env: {
            ...process.env,
            GITHUB_ACTIONS: '',
        },
    });
}

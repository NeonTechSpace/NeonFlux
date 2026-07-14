import { describe, expect, it } from 'vitest';

import { buildWorkflowRunsUrl, findSuccessfulMainCiRun } from './require-successful-ci.mjs';

type ReleaseCiRun = {
    id: number;
    html_url: string;
    head_sha: string;
    head_branch: string;
    event: string;
    status: string;
    conclusion: string | null;
};

const expectedSha = 'a'.repeat(40);

describe('release CI gate', () => {
    it('builds a query scoped to the exact main push commit', () => {
        const url = new URL(buildWorkflowRunsUrl('NeonTechSpace/NeonFlux', expectedSha));

        expect(url.pathname).toBe('/repos/NeonTechSpace/NeonFlux/actions/workflows/ci.yml/runs');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            branch: 'main',
            event: 'push',
            head_sha: expectedSha,
            per_page: '100',
            status: 'completed',
        });
    });

    it('accepts only a completed successful main push for the exact SHA', () => {
        const successful = run({ id: 5, conclusion: 'success' });
        const candidates = [
            run({ id: 1, head_sha: 'b'.repeat(40), conclusion: 'success' }),
            run({ id: 2, head_branch: 'feature', conclusion: 'success' }),
            run({ id: 3, event: 'pull_request', conclusion: 'success' }),
            run({ id: 4, status: 'in_progress', conclusion: null }),
            successful,
        ];

        expect(findSuccessfulMainCiRun(candidates, expectedSha)).toBe(successful);
    });

    it('rejects missing and failed runs', () => {
        expect(findSuccessfulMainCiRun([], expectedSha)).toBeUndefined();
        expect(findSuccessfulMainCiRun([run({ conclusion: 'failure' })], expectedSha)).toBeUndefined();
    });
});

function run(overrides: Partial<ReleaseCiRun> = {}): ReleaseCiRun {
    return {
        id: 1,
        html_url: 'https://github.com/NeonTechSpace/NeonFlux/actions/runs/1',
        head_sha: expectedSha,
        head_branch: 'main',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        ...overrides,
    };
}

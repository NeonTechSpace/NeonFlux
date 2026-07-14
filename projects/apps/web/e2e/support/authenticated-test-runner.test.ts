import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAuthenticatedTests } from './authenticated-test-runner.js';

describe.sequential('signed-in test runner', () => {
    beforeEach(() => {
        vi.stubEnv('GITHUB_STEP_SUMMARY', '');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('runs every independent phase in order and cleans up after phase failures', async () => {
        const events: string[] = [];
        const cleanup = vi.fn(async (started: boolean) => {
            events.push(`cleanup:${String(started)}`);
        });

        const result = runAuthenticatedTests({
            cleanup,
            phases: [
                { name: 'codegen', run: async () => void events.push('codegen') },
                {
                    name: 'services',
                    run: async () => {
                        events.push('services');
                        throw new Error('services failed');
                    },
                },
                { name: 'browser', run: async () => void events.push('browser') },
            ],
            start: async () => void events.push('start'),
        });

        await expect(result).rejects.toThrow('Signed-in test step services failed.');
        expect(events).toEqual(['start', 'codegen', 'services', 'browser', 'cleanup:true']);
        expect(cleanup).toHaveBeenCalledOnce();
    });

    it('does not run phases when startup fails and still invokes safe cleanup', async () => {
        const phase = vi.fn();
        const cleanup = vi.fn();

        await expect(
            runAuthenticatedTests({
                cleanup,
                phases: [{ name: 'codegen', run: phase }],
                start: async () => {
                    throw new Error('startup failed');
                },
            })
        ).rejects.toThrow('Signed-in test environment startup failed.');

        expect(phase).not.toHaveBeenCalled();
        expect(cleanup).toHaveBeenCalledWith(false);
    });

    it('aggregates phase and cleanup failures without skipping later phases', async () => {
        const laterPhase = vi.fn();

        const result = runAuthenticatedTests({
            cleanup: async () => {
                throw new Error('cleanup failed');
            },
            phases: [
                {
                    name: 'codegen',
                    run: async () => {
                        throw new Error('codegen failed');
                    },
                },
                { name: 'browser', run: laterPhase },
            ],
            start: async () => undefined,
        });

        await expect(result).rejects.toBeInstanceOf(AggregateError);
        expect(laterPhase).toHaveBeenCalledOnce();
    });

    it('appends escaped phase outcomes without error or payload content', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'neonflux-authenticated-runner-'));
        const summaryPath = join(directory, 'summary.md');
        vi.stubEnv('GITHUB_STEP_SUMMARY', summaryPath);

        try {
            const result = runAuthenticatedTests({
                cleanup: async () => {
                    throw new Error('cleanup credential must stay private');
                },
                phases: [
                    {
                        name: 'services | <unsafe> [link](https://example.invalid)',
                        run: async () => {
                            throw new Error('provider payload must stay private');
                        },
                    },
                    { name: 'browser', run: async () => undefined },
                ],
                start: async () => undefined,
            });

            await expect(result).rejects.toBeInstanceOf(AggregateError);
            const summary = await readFile(summaryPath, 'utf8');

            expect(summary).toContain('| Startup | Passed |');
            expect(summary).toContain(
                '| services \\| &lt;unsafe&gt; \\[link\\]\\(https://example.invalid\\) | Failed |'
            );
            expect(summary).toContain('| browser | Passed |');
            expect(summary).toContain('| Cleanup | Failed |');
            expect(summary).not.toContain('provider payload');
            expect(summary).not.toContain('cleanup credential');
            expect(summary).not.toContain('<unsafe>');
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });
});

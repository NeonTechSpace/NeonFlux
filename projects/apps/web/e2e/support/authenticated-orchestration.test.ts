import { describe, expect, it, vi } from 'vitest';

import { runAuthenticatedJourneyOrchestration } from './authenticated-orchestration.js';

describe('authenticated journey orchestration', () => {
    it('runs every independent phase in order and cleans up after phase failures', async () => {
        const events: string[] = [];
        const cleanup = vi.fn(async (started: boolean) => {
            events.push(`cleanup:${String(started)}`);
        });

        const result = runAuthenticatedJourneyOrchestration({
            cleanup,
            phases: [
                { name: 'codegen', run: async () => void events.push('codegen') },
                {
                    name: 'composition',
                    run: async () => {
                        events.push('composition');
                        throw new Error('composition failed');
                    },
                },
                { name: 'browser', run: async () => void events.push('browser') },
            ],
            start: async () => void events.push('start'),
        });

        await expect(result).rejects.toThrow('Authenticated journey phase composition failed.');
        expect(events).toEqual(['start', 'codegen', 'composition', 'browser', 'cleanup:true']);
        expect(cleanup).toHaveBeenCalledOnce();
    });

    it('does not run phases when startup fails and still invokes safe cleanup', async () => {
        const phase = vi.fn();
        const cleanup = vi.fn();

        await expect(
            runAuthenticatedJourneyOrchestration({
                cleanup,
                phases: [{ name: 'codegen', run: phase }],
                start: async () => {
                    throw new Error('startup failed');
                },
            })
        ).rejects.toThrow('Authenticated journey environment startup failed.');

        expect(phase).not.toHaveBeenCalled();
        expect(cleanup).toHaveBeenCalledWith(false);
    });

    it('aggregates phase and cleanup failures without skipping later phases', async () => {
        const laterPhase = vi.fn();

        const result = runAuthenticatedJourneyOrchestration({
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
});

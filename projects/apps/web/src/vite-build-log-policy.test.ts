import { describe, expect, it, vi } from 'vitest';

import { enforceBuildLogPolicy, shouldSuppressExpectedBuildLog } from '../vite-build-log-policy.js';

describe('shouldSuppressExpectedBuildLog', () => {
    const expectedLog = {
        id: 'C:\\workspace\\node_modules\\.pnpm\\shiki@4.2.0\\node_modules\\shiki\\dist\\onig.wasm',
        message: 'Failed to load the WebAssembly module; falling back to module mode: Cannot resolve module "env"',
        plugin: 'unwasm',
    };

    it('suppresses only the pinned Shiki Oniguruma module fallback', () => {
        expect(shouldSuppressExpectedBuildLog('warn', expectedLog)).toBe(true);
    });

    it('fails an unexplained build warning with its owner and message', () => {
        expect(() =>
            enforceBuildLogPolicy(
                'warn',
                { id: '/workspace/source.ts', message: 'A new warning', plugin: 'fixture' },
                vi.fn()
            )
        ).toThrow('Unexpected production build warning (fixture · /workspace/source.ts): A new warning');
    });

    it('delegates non-warning output to Vite', () => {
        const defaultHandler = vi.fn();
        const log = { message: 'Built successfully' };

        enforceBuildLogPolicy('info', log, defaultHandler);

        expect(defaultHandler).toHaveBeenCalledExactlyOnceWith('info', log);
    });

    it.each([
        ['error severity', 'error', expectedLog],
        ['another plugin', 'warn', { ...expectedLog, plugin: 'another-plugin' }],
        ['another package version', 'warn', { ...expectedLog, id: expectedLog.id.replace('4.2.0', '4.3.0') }],
        ['another WASM module', 'warn', { ...expectedLog, id: expectedLog.id.replace('onig.wasm', 'other.wasm') }],
        ['another warning', 'warn', { ...expectedLog, message: 'A different warning' }],
    ])('keeps %s visible', (_label, level, log) => {
        expect(shouldSuppressExpectedBuildLog(level, log)).toBe(false);
    });
});

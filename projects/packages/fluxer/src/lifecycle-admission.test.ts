import { describe, expect, it, vi } from 'vitest';

import { LifecycleAdmission } from './lifecycle-admission.js';

describe('LifecycleAdmission', () => {
    it('serializes each key while scheduling other keys fairly', async () => {
        const releases = [Promise.withResolvers<undefined>(), Promise.withResolvers<undefined>()];
        const started: string[] = [];
        const admission = createAdmission({ maxActive: 2 });

        const first = admission.admit('guild-1', async () => {
            started.push('guild-1:first');
            await releases[0]?.promise;
        });
        const second = admission.admit('guild-1', () => {
            started.push('guild-1:second');
            return Promise.resolve();
        });
        const other = admission.admit('guild-2', async () => {
            started.push('guild-2:first');
            await releases[1]?.promise;
        });

        expect(started).toStrictEqual(['guild-1:first', 'guild-2:first']);
        releases[0]?.resolve(undefined);
        if (first.accepted) await first.completion;
        expect(started).toStrictEqual(['guild-1:first', 'guild-2:first', 'guild-1:second']);
        releases[1]?.resolve(undefined);
        await Promise.all([
            second.accepted ? second.completion : Promise.resolve(),
            other.accepted ? other.completion : Promise.resolve(),
        ]);
    });

    it('rejects excess work with finite global and per-key queues', () => {
        const release = Promise.withResolvers<undefined>();
        const admission = createAdmission({ maxActive: 1, maxQueued: 2, maxQueuedPerKey: 1 });

        expect(admission.admit('guild-1', () => release.promise)).toMatchObject({ accepted: true });
        expect(admission.admit('guild-1', () => Promise.resolve())).toMatchObject({ accepted: true });
        expect(admission.admit('guild-1', () => Promise.resolve())).toStrictEqual({
            accepted: false,
            reason: 'key-queue-full',
        });
        expect(admission.admit('guild-2', () => Promise.resolve())).toMatchObject({ accepted: true });
        expect(admission.admit('guild-3', () => Promise.resolve())).toStrictEqual({
            accepted: false,
            reason: 'global-queue-full',
        });
        admission.cancelQueued();
        release.resolve(undefined);
    });

    it('expires queued work and reports handlers that exceed their deadline', async () => {
        vi.useFakeTimers();
        const handlerDeadline = vi.fn();
        const queueDeadline = vi.fn();
        const release = Promise.withResolvers<undefined>();
        const admission = createAdmission({
            handlerDeadlineMs: 20,
            maxActive: 1,
            onHandlerDeadline: handlerDeadline,
            onQueueDeadline: queueDeadline,
            queueDeadlineMs: 10,
        });
        const active = admission.admit('guild-1', () => release.promise);
        const queued = admission.admit('guild-2', () => Promise.resolve());

        await vi.advanceTimersByTimeAsync(20);

        expect(queueDeadline).toHaveBeenCalledWith('guild-2');
        expect(handlerDeadline).toHaveBeenCalledWith('guild-1');
        if (queued.accepted) await queued.completion;
        release.resolve(undefined);
        if (active.accepted) await active.completion;
        vi.useRealTimers();
    });
});

function createAdmission(overrides: Partial<ConstructorParameters<typeof LifecycleAdmission>[0]> = {}) {
    return new LifecycleAdmission({
        handlerDeadlineMs: 1_000,
        maxActive: 2,
        maxQueued: 10,
        maxQueuedPerKey: 5,
        queueDeadlineMs: 1_000,
        ...overrides,
    });
}

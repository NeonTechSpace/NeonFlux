export type DashboardRequestDeadline = {
    abort: () => void;
    dispose: () => void;
    signal: AbortSignal;
};

export function createDashboardRequestDeadline(
    parentSignal: AbortSignal | undefined,
    timeoutMs: number
): DashboardRequestDeadline {
    const controller = new AbortController();
    const handleParentAbort = () => controller.abort(readAbortReason(parentSignal));

    if (parentSignal?.aborted) handleParentAbort();
    else parentSignal?.addEventListener('abort', handleParentAbort, { once: true });

    const timeout = setTimeout(() => {
        controller.abort(new DOMException('Dashboard request timed out.', 'TimeoutError'));
    }, timeoutMs);

    return {
        abort: () => controller.abort(new DOMException('Dashboard request cancelled.', 'AbortError')),
        dispose: () => {
            clearTimeout(timeout);
            parentSignal?.removeEventListener('abort', handleParentAbort);
        },
        signal: controller.signal,
    };
}

export function settleDashboardRequestWithAbort<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();

    return new Promise<T>((resolve, reject) => {
        let settled = false;

        const cleanup = () => signal.removeEventListener('abort', handleAbort);
        const settle = (callback: () => void) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback();
        };
        const handleAbort = () => settle(() => reject(readAbortReason(signal)));

        signal.addEventListener('abort', handleAbort, { once: true });
        void request.then(
            (value) => settle(() => resolve(value)),
            (error: unknown) => settle(() => reject(error))
        );
        if (signal.aborted) handleAbort();
    });
}

function readAbortReason(signal: AbortSignal | undefined): Error {
    const reason: unknown = signal?.reason;
    if (reason instanceof Error) return reason;
    if (typeof reason === 'object' && reason !== null && 'name' in reason) {
        const name = (reason as { name?: unknown }).name;
        const message = 'message' in reason ? (reason as { message?: unknown }).message : undefined;
        if (typeof name === 'string') {
            const normalized = new Error(typeof message === 'string' ? message : 'Dashboard request aborted.');
            normalized.name = name;
            return normalized;
        }
    }
    return new DOMException('Dashboard request aborted.', 'AbortError');
}

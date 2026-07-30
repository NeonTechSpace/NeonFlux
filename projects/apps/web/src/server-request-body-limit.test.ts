import { describe, expect, it } from 'vitest';

import { admitServerFunctionRequest, SERVER_FUNCTION_BODY_LIMIT_BYTES } from '../server-request-body-limit.js';

describe('Server Function request-body admission', () => {
    it('rejects an oversized declared body before reading it', async () => {
        const request = createServerFunctionRequest(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(new Uint8Array([1]));
                    controller.close();
                },
            }),
            { 'Content-Length': String(SERVER_FUNCTION_BODY_LIMIT_BYTES + 1) }
        );

        const admitted = await admitServerFunctionRequest(request);

        expect(admitted).toBeInstanceOf(Response);
        expect((admitted as Response).status).toBe(413);
        expect(request.bodyUsed).toBe(false);
    });

    it('rejects chunked bodies as soon as their aggregate bytes exceed the ceiling', async () => {
        let cancelled = false;
        const request = createServerFunctionRequest(
            new ReadableStream({
                cancel() {
                    cancelled = true;
                },
                start(controller) {
                    controller.enqueue(new Uint8Array([1, 2]));
                    controller.enqueue(new Uint8Array([3, 4]));
                },
            })
        );

        const admitted = await admitServerFunctionRequest(request, 3);

        expect(admitted).toBeInstanceOf(Response);
        expect((admitted as Response).status).toBe(413);
        expect(cancelled).toBe(true);
    });

    it('forwards an at-limit body and preserves runtime request context', async () => {
        const waitUntil = () => undefined;
        const request = Object.assign(
            createServerFunctionRequest(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode('{"a":1}'));
                        controller.close();
                    },
                })
            ),
            {
                context: { requestId: 'request-1' },
                runtime: { name: 'node' },
                waitUntil,
            }
        );

        const admitted = await admitServerFunctionRequest(request, 7);

        expect(admitted).toBeInstanceOf(Request);
        expect(await (admitted as Request).json()).toStrictEqual({ a: 1 });
        expect((admitted as Request & { context?: unknown }).context).toBe(request.context);
        expect((admitted as Request & { runtime?: unknown }).runtime).toBe(request.runtime);
        expect((admitted as Request & { waitUntil?: unknown }).waitUntil).toBeTypeOf('function');
    });

    it('reconstructs runtime request adapters without native private state', async () => {
        const source = createServerFunctionRequest(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('{"adapter":true}'));
                    controller.close();
                },
            }),
            { 'Content-Type': 'application/json' }
        );
        const request = createRuntimeRequestAdapter(source);

        const admitted = await admitServerFunctionRequest(request, 16);

        expect(admitted).toBeInstanceOf(Request);
        expect(await (admitted as Request).json()).toStrictEqual({ adapter: true });
        expect((admitted as Request).headers.get('content-type')).toBe('application/json');
    });

    it('does not consume unrelated request bodies', async () => {
        const request = new Request('https://neonflux.test/api/upload', {
            body: 'unchanged',
            method: 'POST',
        });

        const admitted = await admitServerFunctionRequest(request);

        expect(admitted).toBe(request);
        expect(await request.text()).toBe('unchanged');
    });
});

function createServerFunctionRequest(body: ReadableStream<Uint8Array>, headers?: HeadersInit): Request {
    return new Request('https://neonflux.test/_serverFn/action-id', {
        body,
        duplex: 'half',
        headers,
        method: 'POST',
    } as RequestInit & { duplex: 'half' });
}

function createRuntimeRequestAdapter(source: Request): Request {
    const headers = Object.defineProperties(Object.create(Headers.prototype) as Headers, {
        entries: { value: source.headers.entries.bind(source.headers) },
        get: { value: source.headers.get.bind(source.headers) },
        [Symbol.iterator]: { value: source.headers[Symbol.iterator].bind(source.headers) },
    });

    return Object.defineProperties(Object.create(Request.prototype) as Request, {
        body: { value: source.body },
        headers: { value: headers },
        method: { value: source.method },
        signal: { value: source.signal },
        url: { value: source.url },
    });
}

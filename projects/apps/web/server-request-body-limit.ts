const serverFunctionPathPrefix = '/_serverFn/';

export const SERVER_FUNCTION_BODY_LIMIT_BYTES = 1_000_000;

type RuntimeRequest = Request & {
    context?: Record<string, unknown>;
    ip?: string;
    runtime?: unknown;
    waitUntil?: (promise: Promise<unknown>) => void | Promise<void>;
};

export async function admitServerFunctionRequest(
    request: RuntimeRequest,
    limitBytes = SERVER_FUNCTION_BODY_LIMIT_BYTES
): Promise<Request | Response> {
    if (request.method !== 'POST' || !new URL(request.url).pathname.startsWith(serverFunctionPathPrefix)) {
        return request;
    }

    if (declaredBodyExceedsLimit(request.headers.get('content-length'), limitBytes)) {
        return payloadTooLargeResponse();
    }

    if (!request.body) {
        return request;
    }

    const body = await readBoundedBody(request.body, limitBytes);
    if (!body) {
        return payloadTooLargeResponse();
    }

    const admitted = new Request(request, { body });
    copyRuntimeRequestContext(request, admitted);
    return admitted;
}

async function readBoundedBody(stream: ReadableStream<Uint8Array>, limitBytes: number): Promise<ArrayBuffer | null> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
        let result = await reader.read();
        while (!result.done) {
            totalBytes += result.value.byteLength;
            if (totalBytes > limitBytes) {
                await reader.cancel('server-function-body-limit-exceeded');
                return null;
            }
            chunks.push(result.value);
            result = await reader.read();
        }
    } finally {
        reader.releaseLock();
    }

    const body = new ArrayBuffer(totalBytes);
    const bytes = new Uint8Array(body);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
}

function declaredBodyExceedsLimit(value: string | null, limitBytes: number): boolean {
    if (!value || !/^\d+$/u.test(value)) return false;

    try {
        return BigInt(value) > BigInt(limitBytes);
    } catch {
        return false;
    }
}

function copyRuntimeRequestContext(source: RuntimeRequest, target: RuntimeRequest): void {
    if (source.context) target.context = source.context;
    if (source.ip) target.ip = source.ip;
    if (source.runtime) target.runtime = source.runtime;
    if (source.waitUntil) target.waitUntil = source.waitUntil.bind(source);
}

function payloadTooLargeResponse(): Response {
    return new Response('Payload too large.', {
        headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/plain; charset=utf-8',
        },
        status: 413,
    });
}

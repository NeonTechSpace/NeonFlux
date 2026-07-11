import {
    getFunctionName,
    type FunctionArgs,
    type FunctionReference,
    type FunctionReturnType,
    type OptionalRestArgs,
} from 'convex/server';
import { convexToJson, jsonToConvex, type JSONValue } from 'convex/values';

export type NeonFluxConvexAuthTokenProvider = () => Promise<string | undefined>;

export type NeonFluxConvexClientConfig = {
    authTokenProvider?: NeonFluxConvexAuthTokenProvider;
    url: string;
};

export type NeonFluxConvexRequestOptions = {
    signal?: AbortSignal;
};

export type NeonFluxConvexQueryReference = FunctionReference<'query'>;
export type NeonFluxConvexMutationReference = FunctionReference<'mutation'>;
export type NeonFluxConvexFunctionReference = NeonFluxConvexMutationReference | NeonFluxConvexQueryReference;

export type NeonFluxConvexHttpClient = {
    mutation<Mutation extends NeonFluxConvexMutationReference>(
        reference: Mutation,
        ...args: OptionalRestArgs<Mutation>
    ): Promise<FunctionReturnType<Mutation>>;
    query<Query extends NeonFluxConvexQueryReference>(
        reference: Query,
        args: FunctionArgs<Query>,
        options?: NeonFluxConvexRequestOptions
    ): Promise<FunctionReturnType<Query>>;
};

const safeConvexErrorCodes = new Set([
    'invalid-access-token',
    'invalid-defcon-level',
    'invalid-expiry',
    'invalid-refresh-token',
    'invalid-target-type',
    'missing-category',
    'missing-feature',
    'missing-fluxer-user-id',
    'missing-guild-id',
    'missing-input',
    'missing-scopes',
    'missing-session-id',
    'missing-target-id',
    'missing-token-type',
]);

export function createNeonFluxConvexHttpClient(config: NeonFluxConvexClientConfig): NeonFluxConvexHttpClient {
    return {
        mutation: async <Mutation extends NeonFluxConvexMutationReference>(
            reference: Mutation,
            ...args: OptionalRestArgs<Mutation>
        ): Promise<FunctionReturnType<Mutation>> =>
            callConvexFunction(config, 'mutation', reference, readOptionalArgs(args)),
        query: async <Query extends NeonFluxConvexQueryReference>(
            reference: Query,
            args: FunctionArgs<Query>,
            options?: NeonFluxConvexRequestOptions
        ): Promise<FunctionReturnType<Query>> => callConvexFunction(config, 'query', reference, args, options),
    };
}

async function callConvexFunction<FuncRef extends NeonFluxConvexFunctionReference>(
    config: NeonFluxConvexClientConfig,
    operation: 'mutation' | 'query',
    reference: FuncRef,
    args: FunctionArgs<FuncRef>,
    options?: NeonFluxConvexRequestOptions
): Promise<FunctionReturnType<FuncRef>> {
    const path = getFunctionName(reference);
    options?.signal?.throwIfAborted();
    const authToken = config.authTokenProvider
        ? await settleWithAbort(config.authTokenProvider(), options?.signal)
        : undefined;
    options?.signal?.throwIfAborted();
    const response = await fetch(new URL(`/api/${operation}`, config.url), {
        body: JSON.stringify({
            args: [convexToJson(args)],
            format: 'convex_encoded_json',
            path,
        }),
        headers: {
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            'Content-Type': 'application/json',
            'Convex-Client': 'neonflux-runtime-server',
        },
        method: 'POST',
        ...(options?.signal ? { signal: options.signal } : {}),
    });
    const body = await response.text();

    if (!response.ok && response.status !== 560) {
        throw new Error(`Convex ${operation} ${path} returned HTTP ${String(response.status)}.`);
    }

    const payload = parseConvexHttpJson(body, operation, path);

    if (payload.status === 'success') {
        return jsonToConvex(readJsonValue(payload.value, operation, path));
    }

    if (payload.status === 'error') {
        throw new Error(`Convex ${operation} ${path} failed: ${readSafeConvexErrorCode(payload.errorMessage)}.`);
    }

    throw new Error(`Convex ${operation} ${path} returned an unexpected payload.`);
}

function settleWithAbort<T>(request: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (!signal) return request;
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
        const handleAbort = () =>
            settle(() => {
                const reason: unknown = signal.reason;
                reject(reason instanceof Error ? reason : new DOMException('Convex request aborted.', 'AbortError'));
            });

        signal.addEventListener('abort', handleAbort, { once: true });
        void request.then(
            (value) => settle(() => resolve(value)),
            (error: unknown) =>
                settle(() =>
                    reject(error instanceof Error ? error : new Error('Convex authentication token request failed.'))
                )
        );
        if (signal.aborted) handleAbort();
    });
}

function readOptionalArgs<FuncRef extends NeonFluxConvexFunctionReference>(
    args: OptionalRestArgs<FuncRef>
): FunctionArgs<FuncRef> {
    return args[0] ?? {};
}

function parseConvexHttpJson(body: string, operation: 'mutation' | 'query', path: string): Record<string, unknown> {
    try {
        const payload = JSON.parse(body) as unknown;

        if (isRecord(payload)) {
            return payload;
        }
    } catch {
        throw new Error(`Convex ${operation} ${path} returned non-JSON content.`);
    }

    throw new Error(`Convex ${operation} ${path} returned a non-object payload.`);
}

function readJsonValue(value: unknown, operation: 'mutation' | 'query', path: string): JSONValue {
    if (isJsonValue(value)) {
        return value;
    }

    throw new Error(`Convex ${operation} ${path} returned a non-JSON value.`);
}

function readSafeConvexErrorCode(value: unknown): string {
    return typeof value === 'string' && safeConvexErrorCodes.has(value) ? value : 'unknown-error';
}

function isJsonValue(value: unknown): value is JSONValue {
    if (value === null) {
        return true;
    }

    const valueType = typeof value;

    if (valueType === 'boolean' || valueType === 'number' || valueType === 'string') {
        return true;
    }

    if (valueType !== 'object') {
        return false;
    }

    return Array.isArray(value)
        ? value.every(isJsonValue)
        : Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

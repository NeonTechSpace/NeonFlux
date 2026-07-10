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
        ...args: OptionalRestArgs<Query>
    ): Promise<FunctionReturnType<Query>>;
};

export function createNeonFluxConvexHttpClient(config: NeonFluxConvexClientConfig): NeonFluxConvexHttpClient {
    return {
        mutation: async <Mutation extends NeonFluxConvexMutationReference>(
            reference: Mutation,
            ...args: OptionalRestArgs<Mutation>
        ): Promise<FunctionReturnType<Mutation>> =>
            callConvexFunction(config, 'mutation', reference, readOptionalArgs(args)),
        query: async <Query extends NeonFluxConvexQueryReference>(
            reference: Query,
            ...args: OptionalRestArgs<Query>
        ): Promise<FunctionReturnType<Query>> => callConvexFunction(config, 'query', reference, readOptionalArgs(args)),
    };
}

async function callConvexFunction<FuncRef extends NeonFluxConvexFunctionReference>(
    config: NeonFluxConvexClientConfig,
    operation: 'mutation' | 'query',
    reference: FuncRef,
    args: FunctionArgs<FuncRef>
): Promise<FunctionReturnType<FuncRef>> {
    const path = getFunctionName(reference);
    const authToken = await config.authTokenProvider?.();
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
    });
    const body = await response.text();

    if (!response.ok && response.status !== 560) {
        throw new Error(`Convex ${operation} ${path} returned HTTP ${String(response.status)}: ${body}`);
    }

    const payload = parseConvexHttpJson(body, operation, path);

    if (payload.status === 'success') {
        return jsonToConvex(readJsonValue(payload.value, operation, path));
    }

    if (payload.status === 'error') {
        throw new Error(`Convex ${operation} ${path} failed: ${formatConvexErrorMessage(payload.errorMessage)}`);
    }

    throw new Error(`Convex ${operation} ${path} returned an unexpected payload: ${body}`);
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
    } catch (error) {
        throw new Error(`Convex ${operation} ${path} returned non-JSON content: ${body}`, { cause: error });
    }

    throw new Error(`Convex ${operation} ${path} returned a non-object payload: ${body}`);
}

function readJsonValue(value: unknown, operation: 'mutation' | 'query', path: string): JSONValue {
    if (isJsonValue(value)) {
        return value;
    }

    throw new Error(`Convex ${operation} ${path} returned a non-JSON value.`);
}

function formatConvexErrorMessage(value: unknown): string {
    return typeof value === 'string' && value.length > 0 ? value : 'unknown error';
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

import { getFunctionName } from 'convex/server';
import type { JSONValue } from 'convex/values';
import { convexToJson, jsonToConvex } from 'convex/values';

export type NeonFluxConvexClientConfig = {
    authToken?: string;
    url: string;
};

export type NeonFluxConvexFunctionReference = Parameters<typeof getFunctionName>[0];

export type NeonFluxConvexHttpClient = {
    mutation<Result = unknown>(
        reference: NeonFluxConvexFunctionReference,
        args: Record<string, unknown>
    ): Promise<Result>;
    query<Result = unknown>(reference: NeonFluxConvexFunctionReference, args: Record<string, unknown>): Promise<Result>;
};

export function createNeonFluxConvexHttpClient(config: NeonFluxConvexClientConfig): NeonFluxConvexHttpClient {
    return {
        mutation: async <Result>(
            reference: NeonFluxConvexFunctionReference,
            args: Record<string, unknown>
        ): Promise<Result> => callConvexFunction(config, 'mutation', reference, args),
        query: async <Result>(
            reference: NeonFluxConvexFunctionReference,
            args: Record<string, unknown>
        ): Promise<Result> => callConvexFunction(config, 'query', reference, args),
    };
}

async function callConvexFunction<Result>(
    config: NeonFluxConvexClientConfig,
    operation: 'mutation' | 'query',
    reference: NeonFluxConvexFunctionReference,
    args: Record<string, unknown>
): Promise<Result> {
    const path = getFunctionName(reference);
    const response = await fetch(new URL(`/api/${operation}`, config.url), {
        body: JSON.stringify({
            args: [convexToJson(args as never)],
            format: 'convex_encoded_json',
            path,
        }),
        headers: {
            ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
            'Content-Type': 'application/json',
            'Convex-Client': 'neonflux-runtime-server',
        },
        method: 'POST',
    });
    const body = await response.text();

    if (!response.ok && response.status !== 560) {
        throw new Error(`Convex ${operation} ${path} returned HTTP ${response.status}: ${body}`);
    }

    const payload = parseConvexHttpJson(body, operation, path);

    if (payload.status === 'success') {
        return jsonToConvex(payload.value as JSONValue) as Result;
    }

    if (payload.status === 'error') {
        throw new Error(`Convex ${operation} ${path} failed: ${formatConvexErrorMessage(payload.errorMessage)}`);
    }

    throw new Error(`Convex ${operation} ${path} returned an unexpected payload: ${body}`);
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

function formatConvexErrorMessage(value: unknown): string {
    return typeof value === 'string' && value.length > 0 ? value : 'unknown error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

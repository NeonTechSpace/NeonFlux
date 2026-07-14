import {
    DashboardBlueprintRequestError,
    withDashboardBlueprintRequestTimeout,
} from './dashboard-blueprint-progress.js';
import type { DashboardBlueprintReadSlice } from './dashboard-blueprint-runtime-context.js';

const dashboardBlueprintRequestTimeoutMs = 12_000;
type StructureRequest = Promise<{ type: string }>;

export function createDashboardBlueprintReadRegistry(guildId: string): DashboardBlueprintReadSlice {
    const requestByKey = new Map<string, StructureRequest>();

    return async (slice, expectedType, createRequest) => {
        const key = `${guildId}:${slice}`;
        let request = requestByKey.get(key);
        if (!request) {
            request = createRequest();
            requestByKey.set(key, request);
            void request
                .finally(() => {
                    if (requestByKey.get(key) === request) requestByKey.delete(key);
                })
                .catch(() => undefined);
        }

        const result = await withDashboardBlueprintRequestTimeout(request, dashboardBlueprintRequestTimeoutMs);
        if (result.type !== expectedType) {
            throw new DashboardBlueprintRequestError(
                `BLUEPRINT_LOAD_${result.type.replaceAll('-', '_').toUpperCase()}`
            );
        }
        return result as never;
    };
}

import {
    DashboardStructureRequestError,
    withDashboardStructureRequestTimeout,
} from './dashboard-structure-progress.js';
import type { DashboardStructureReadSlice } from './dashboard-structure-runtime-context.js';

const dashboardStructureRequestTimeoutMs = 12_000;
type StructureRequest = Promise<{ type: string }>;

export function createDashboardStructureReadRegistry(guildId: string): DashboardStructureReadSlice {
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

        const result = await withDashboardStructureRequestTimeout(request, dashboardStructureRequestTimeoutMs);
        if (result.type !== expectedType) {
            throw new DashboardStructureRequestError(
                `BLUEPRINT_LOAD_${result.type.replaceAll('-', '_').toUpperCase()}`
            );
        }
        return result as never;
    };
}

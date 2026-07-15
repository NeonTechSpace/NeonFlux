import { createFileRoute } from '@tanstack/react-router';
import { type } from 'arktype';

import { DashboardBlueprintDeployRoute } from '../../../../components/dashboard-blueprint-deploy-route.js';

const deploySearch = type({
    'plan?': 'string',
    'step?': "'source'|'configure'|'review'|'safety'|'confirm'|'deploy'",
});

export const Route = createFileRoute('/dashboard/$guildId/blueprint/deploy')({
    component: BlueprintDeployRouteComponent,
    validateSearch: (search) => {
        const result = deploySearch(search);
        return result instanceof type.errors ? {} : result;
    },
});

function BlueprintDeployRouteComponent() {
    const search = Route.useSearch();
    return <DashboardBlueprintDeployRoute requestedPlanId={search.plan} requestedStep={search.step} />;
}

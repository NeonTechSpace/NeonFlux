import { createContext, use } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import type { DashboardBlueprintPolicy } from '../server/dashboard-blueprint-contracts.js';
import type { DashboardBlueprintProgressTransport } from './dashboard-blueprint-run-progress.js';
import type { DashboardBlueprintExplorerSource } from './dashboard-blueprint-explorer-types.js';
import type { DashboardBlueprintSurface } from './dashboard-blueprint-surface.js';

type StructureRequestResult = { type: string };

export type DashboardBlueprintReadSlice = <TResult extends StructureRequestResult, TExpected extends TResult['type']>(
    key: 'backups' | 'runs' | 'status',
    expectedType: TExpected,
    createRequest: () => Promise<TResult>
) => Promise<Extract<TResult, { type: TExpected }>>;

export type DashboardBlueprintDeployFlow =
    | { type: 'latest' }
    | { type: 'choose' }
    | { type: 'plan'; plan: DashboardBlueprintPlan };

export type DashboardBlueprintRuntimeValue = {
    guildId: string;
    importJson: string;
    setImportJson: Dispatch<SetStateAction<string>>;
    structurePolicy: DashboardBlueprintPolicy;
    setStructurePolicy: Dispatch<SetStateAction<DashboardBlueprintPolicy>>;
    deployFlow: DashboardBlueprintDeployFlow;
    setDeployFlow: Dispatch<SetStateAction<DashboardBlueprintDeployFlow>>;
    comparisonSource?: DashboardBlueprintExplorerSource;
    setComparisonSource: Dispatch<SetStateAction<DashboardBlueprintExplorerSource | undefined>>;
    navigateToSurface: (surface: DashboardBlueprintSurface) => Promise<void>;
    readSlice: DashboardBlueprintReadSlice;
    statusError: unknown;
    statusRefreshing: boolean;
    retryStatus: () => void;
    activePlan?: Pick<DashboardBlueprintPlan, 'id' | 'run'>;
    runProgress: {
        run?: NonNullable<DashboardBlueprintPlan['run']> | null;
        issueCode?: string;
        retry: () => void;
        retrying: boolean;
        transport: DashboardBlueprintProgressTransport;
    };
};

const DashboardBlueprintRuntimeContext = createContext<DashboardBlueprintRuntimeValue | undefined>(undefined);

export function DashboardBlueprintRuntimeProvider({
    value,
    children,
}: {
    value: DashboardBlueprintRuntimeValue;
    children: ReactNode;
}) {
    return <DashboardBlueprintRuntimeContext value={value}>{children}</DashboardBlueprintRuntimeContext>;
}

export function useDashboardBlueprintRuntime(): DashboardBlueprintRuntimeValue {
    const runtime = use(DashboardBlueprintRuntimeContext);
    if (!runtime) throw new Error('Server Blueprint route rendered outside its persistent runtime.');
    return runtime;
}

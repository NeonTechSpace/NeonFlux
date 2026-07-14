import { createContext, use } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

import type { DashboardStructureImportRun } from '../server/dashboard-structure-model.js';
import type { DashboardStructurePolicy } from '../server/dashboard-structure-contracts.js';
import type { DashboardStructureProgressTransport } from './dashboard-structure-execution-progress.js';
import type { DashboardStructureExplorerSource } from './dashboard-structure-explorer-types.js';
import type { DashboardStructureSurface } from './dashboard-structure-surface.js';

type StructureRequestResult = { type: string };

export type DashboardStructureReadSlice = <TResult extends StructureRequestResult, TExpected extends TResult['type']>(
    key: 'backups' | 'runs' | 'status',
    expectedType: TExpected,
    createRequest: () => Promise<TResult>
) => Promise<Extract<TResult, { type: TExpected }>>;

export type DashboardStructureDeployFlow =
    | { type: 'latest' }
    | { type: 'choose' }
    | { type: 'run'; run: DashboardStructureImportRun };

export type DashboardStructureRuntimeValue = {
    guildId: string;
    importJson: string;
    setImportJson: Dispatch<SetStateAction<string>>;
    structurePolicy: DashboardStructurePolicy;
    setStructurePolicy: Dispatch<SetStateAction<DashboardStructurePolicy>>;
    deployFlow: DashboardStructureDeployFlow;
    setDeployFlow: Dispatch<SetStateAction<DashboardStructureDeployFlow>>;
    comparisonSource?: DashboardStructureExplorerSource;
    setComparisonSource: Dispatch<SetStateAction<DashboardStructureExplorerSource | undefined>>;
    navigateToSurface: (surface: DashboardStructureSurface) => Promise<void>;
    readSlice: DashboardStructureReadSlice;
    statusError: unknown;
    statusRefreshing: boolean;
    retryStatus: () => void;
    activeExecutionRun?: Pick<DashboardStructureImportRun, 'id' | 'execution'>;
    executionProgress: {
        execution?: NonNullable<DashboardStructureImportRun['execution']> | null;
        issueCode?: string;
        retry: () => void;
        retrying: boolean;
        transport: DashboardStructureProgressTransport;
    };
};

const DashboardStructureRuntimeContext = createContext<DashboardStructureRuntimeValue | undefined>(undefined);

export function DashboardStructureRuntimeProvider({
    value,
    children,
}: {
    value: DashboardStructureRuntimeValue;
    children: ReactNode;
}) {
    return <DashboardStructureRuntimeContext value={value}>{children}</DashboardStructureRuntimeContext>;
}

export function useDashboardStructureRuntime(): DashboardStructureRuntimeValue {
    const runtime = use(DashboardStructureRuntimeContext);
    if (!runtime) throw new Error('Server Blueprint route rendered outside its persistent runtime.');
    return runtime;
}

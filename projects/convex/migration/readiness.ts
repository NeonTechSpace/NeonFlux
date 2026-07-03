export type ConvexMigrationReadiness = {
    cutoverRehearsed: boolean;
    finalDeltaPlanReady: boolean;
    invariantValidationPassed: boolean;
    postgresSnapshotReady: boolean;
    rollbackPlanReady: boolean;
};

export const convexMigrationFoundation = {
    cutoverMode: 'big-bang-after-rehearsal',
    durableTableCount: 59,
    phase: 'foundation',
    productionCutoverAllowed: false,
} as const;

export function isConvexProductionCutoverAllowed(readiness: ConvexMigrationReadiness): boolean {
    return (
        readiness.cutoverRehearsed &&
        readiness.finalDeltaPlanReady &&
        readiness.invariantValidationPassed &&
        readiness.postgresSnapshotReady &&
        readiness.rollbackPlanReady
    );
}

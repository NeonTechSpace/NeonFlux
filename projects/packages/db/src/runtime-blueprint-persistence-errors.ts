import type { BlueprintRepositoryError } from './contracts-blueprint.js';

const predictablePlanSizeErrors = [
    'blueprint-artifact-chunk-document-too-large',
    'blueprint-artifact-too-large',
    'blueprint-plan-authority-too-large',
    'blueprint-plan-cold-payload-too-large',
    'blueprint-plan-decision-too-large',
    'blueprint-plan-execution-authority-bucket-too-large',
    'blueprint-plan-execution-authority-manifest-too-large',
    'blueprint-plan-ledger-too-large',
    'blueprint-plan-metadata-too-large',
    'blueprint-plan-step-too-large',
] as const;

export function mapBlueprintPlanPersistenceError(error: unknown): BlueprintRepositoryError {
    const message = error instanceof Error ? error.message : String(error);
    return predictablePlanSizeErrors.some((errorType) => message.includes(errorType))
        ? { type: 'blueprint-plan-too-large' }
        : { type: 'database-error' };
}

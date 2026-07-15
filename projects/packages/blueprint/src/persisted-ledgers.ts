import type {
    BlueprintPlanDecisionLedgerEntryV1,
    BlueprintPlanStepLedgerEntryV1,
} from './persisted-authority-types.js';
import {
    normalizeBlueprintPlanDecision,
    normalizeBlueprintPlanStep,
    type BlueprintContractResult,
} from './runtime-contracts.js';

const maximumLedgerEntries = 10_000;

export function normalizeBlueprintPlanStepLedger(
    value: unknown
): BlueprintContractResult<BlueprintPlanStepLedgerEntryV1[]> {
    if (!Array.isArray(value) || value.length > maximumLedgerEntries) {
        return invalid('Blueprint plan step ledger must be a bounded array.');
    }
    const entries: BlueprintPlanStepLedgerEntryV1[] = [];
    for (const [index, rawEntry] of value.entries()) {
        const entry = normalizeStepLedgerEntry(rawEntry);
        if (entry?.sequence !== index) {
            return invalid('Blueprint plan step ledger must have a contiguous zero-based sequence.');
        }
        entries.push(entry);
    }
    return { type: 'valid', value: entries };
}

export function normalizeBlueprintPlanDecisionLedger(
    value: unknown
): BlueprintContractResult<BlueprintPlanDecisionLedgerEntryV1[]> {
    if (!Array.isArray(value) || value.length > maximumLedgerEntries) {
        return invalid('Blueprint plan decision ledger must be a bounded array.');
    }
    const entries: BlueprintPlanDecisionLedgerEntryV1[] = [];
    for (const [index, rawEntry] of value.entries()) {
        const entry = normalizeDecisionLedgerEntry(rawEntry);
        if (entry?.sequence !== index) {
            return invalid('Blueprint plan decision ledger must have a contiguous zero-based sequence.');
        }
        entries.push(entry);
    }
    return { type: 'valid', value: entries };
}

function normalizeStepLedgerEntry(value: unknown): BlueprintPlanStepLedgerEntryV1 | undefined {
    if (!isRecord(value) || !isSequence(value.sequence)) return undefined;
    const rawStep = isRecord(value.step)
        ? value.step
        : {
              actionType: value.actionType,
              targetType: value.targetType,
              ...(value.targetId === undefined || value.targetId === null ? {} : { targetId: value.targetId }),
              label: isRecord(value.details) ? value.details.label : undefined,
              details: value.details,
          };
    const step = normalizeBlueprintPlanStep(rawStep);
    return step.type === 'valid' ? { sequence: value.sequence, step: step.value } : undefined;
}

function normalizeDecisionLedgerEntry(value: unknown): BlueprintPlanDecisionLedgerEntryV1 | undefined {
    if (!isRecord(value) || !isSequence(value.sequence)) return undefined;
    const details = isRecord(value.details) ? value.details : undefined;
    const rawDecision = isRecord(value.decision)
        ? value.decision
        : {
              targetType: value.targetType,
              classification: value.classification,
              ...(value.sourceId === undefined || value.sourceId === null ? {} : { sourceId: value.sourceId }),
              ...(value.targetId === undefined || value.targetId === null ? {} : { targetId: value.targetId }),
              reason: details?.reason,
              ...(details?.changes === undefined ? {} : { changes: details.changes }),
              ...(details?.candidateTargetIds === undefined ? {} : { candidateTargetIds: details.candidateTargetIds }),
          };
    const decision = normalizeBlueprintPlanDecision(rawDecision);
    return decision.type === 'valid' ? { sequence: value.sequence, decision: decision.value } : undefined;
}

function isSequence(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid<T>(message: string): BlueprintContractResult<T> {
    return { type: 'invalid', message };
}

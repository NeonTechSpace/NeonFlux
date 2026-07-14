import type { BlueprintContractResult } from './runtime-contracts.js';

export const blueprintPreflightStepStatuses = [
    'ready',
    'stale',
    'mapping-required',
    'destructive-approval-required',
    'unsupported',
    'invalid-plan',
] as const;

export type BlueprintPreflightStepStatus = (typeof blueprintPreflightStepStatuses)[number];

export type BlueprintPreflightReportStep = {
    planStepId: string;
    actionType: string;
    targetType: string;
    targetId?: string;
    label?: string;
    status: BlueprintPreflightStepStatus;
    message: string;
};

export type BlueprintPreflightReportSummary = {
    total: number;
    ready: number;
    stale: number;
    mappingRequired: number;
    destructiveApprovalRequired: number;
    unsupported: number;
    invalidPlan: number;
};

export type BlueprintPreflightReport = {
    summary: BlueprintPreflightReportSummary;
    steps: BlueprintPreflightReportStep[];
};

export function isBlueprintPreflightReportReady(report: BlueprintPreflightReport): boolean {
    const { summary } = report;
    return (
        summary.stale + summary.mappingRequired + summary.unsupported + summary.invalidPlan === 0 &&
        summary.ready + summary.destructiveApprovalRequired === summary.total
    );
}

const maximumPreflightSteps = 10_000;
const statusSet = new Set<string>(blueprintPreflightStepStatuses);

export function normalizeBlueprintPreflightReport(value: unknown): BlueprintContractResult<BlueprintPreflightReport> {
    if (!isRecord(value) || !hasOnlyKeys(value, ['summary', 'steps'])) {
        return invalid('Blueprint preflight report must contain summary and steps.');
    }
    if (!isRecord(value.summary) || !hasOnlyKeys(value.summary, summaryFields)) {
        return invalid('Blueprint preflight report summary is malformed.');
    }
    if (!Array.isArray(value.steps) || value.steps.length > maximumPreflightSteps) {
        return invalid('Blueprint preflight report steps must be a bounded array.');
    }

    const summary = normalizeSummary(value.summary);
    if (!summary) return invalid('Blueprint preflight report summary counts are malformed.');
    const steps: BlueprintPreflightReportStep[] = [];
    for (const step of value.steps) {
        const normalized = normalizeStep(step);
        if (!normalized) return invalid('Blueprint preflight report contains a malformed step.');
        steps.push(normalized);
    }
    if (summary.total !== steps.length || !summaryMatchesSteps(summary, steps)) {
        return invalid('Blueprint preflight report summary does not match its steps.');
    }

    return { type: 'valid', value: { summary, steps } };
}

const summaryFields = [
    'total',
    'ready',
    'stale',
    'mappingRequired',
    'destructiveApprovalRequired',
    'unsupported',
    'invalidPlan',
] as const;

function normalizeSummary(value: Record<string, unknown>): BlueprintPreflightReportSummary | undefined {
    if (summaryFields.some((field) => !isCount(value[field]))) return undefined;
    return Object.fromEntries(summaryFields.map((field) => [field, value[field]])) as BlueprintPreflightReportSummary;
}

function normalizeStep(value: unknown): BlueprintPreflightReportStep | undefined {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, ['planStepId', 'actionType', 'targetType', 'targetId', 'label', 'status', 'message']) ||
        !isText(value.planStepId) ||
        !isText(value.actionType) ||
        !isText(value.targetType) ||
        !isText(value.message) ||
        typeof value.status !== 'string' ||
        !statusSet.has(value.status) ||
        (value.targetId !== undefined && !isText(value.targetId)) ||
        (value.label !== undefined && !isText(value.label))
    ) {
        return undefined;
    }

    return value as BlueprintPreflightReportStep;
}

function summaryMatchesSteps(
    summary: BlueprintPreflightReportSummary,
    steps: readonly BlueprintPreflightReportStep[]
): boolean {
    const count = (status: BlueprintPreflightStepStatus) => steps.filter((step) => step.status === status).length;
    return (
        summary.ready === count('ready') &&
        summary.stale === count('stale') &&
        summary.mappingRequired === count('mapping-required') &&
        summary.destructiveApprovalRequired === count('destructive-approval-required') &&
        summary.unsupported === count('unsupported') &&
        summary.invalidPlan === count('invalid-plan')
    );
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const allowed = new Set(keys);
    return Object.keys(value).every((key) => allowed.has(key));
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid<T>(message: string): BlueprintContractResult<T> {
    return { type: 'invalid', message };
}

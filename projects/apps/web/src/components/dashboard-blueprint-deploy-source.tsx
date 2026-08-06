import { FileCheck2, FileJson2, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';

import type { DashboardBlueprintPolicy } from '../server/dashboard-blueprint-contracts.js';
import type { DashboardBlueprintRoleMappingConflict } from '../server/dashboard-blueprint-model.js';
import { readDashboardBlueprintSourceSnapshot } from './dashboard-blueprint-deploy-stage.js';
import type { DashboardBlueprintSourceState } from './dashboard-blueprint-deploy-source-state.js';
import {
    dashboardCompactFieldClassName,
    dashboardFieldClassName,
    dashboardPrimaryActionClassName,
    dashboardSecondaryActionClassName,
} from './dashboard-ui.js';

const deploymentPolicies = [
    {
        value: 'merge',
        label: 'Merge without deletions',
        description:
            'Create missing items and update matching names, permissions, parents, and order without deleting target-only items.',
    },
    {
        value: 'synchronize',
        label: 'Match blueprint (recommended)',
        description: 'Match eligible roles and channels, including deleting eligible target-only objects.',
    },
    {
        value: 'rebuild',
        label: 'Reset and rebuild',
        description: 'Delete all eligible roles and channels, retain protected objects, then recreate the blueprint.',
    },
] as const satisfies ReadonlyArray<{
    value: DashboardBlueprintPolicy;
    label: string;
    description: string;
}>;

export function DashboardBlueprintDeploySource({
    mode,
    pasteJson,
    roleMappingConflicts,
    roleMappings,
    sourceState,
    step,
    structurePolicy,
    targetGuildId,
    targetGuildName,
    onChangeSource,
    onFilesSelected,
    onInspectSource,
    onModeChange,
    onPasteJsonChange,
    onRoleMappingChange,
    onStructurePolicyChange,
}: {
    mode: 'file' | 'paste';
    pasteJson: string;
    roleMappingConflicts: DashboardBlueprintRoleMappingConflict[];
    roleMappings: Record<string, string>;
    sourceState: DashboardBlueprintSourceState;
    step: 'source' | 'configure';
    structurePolicy: DashboardBlueprintPolicy;
    targetGuildId: string;
    targetGuildName: string;
    onChangeSource: () => void;
    onFilesSelected: (files: readonly File[]) => void;
    onInspectSource: () => void;
    onModeChange: (mode: 'file' | 'paste') => void;
    onPasteJsonChange: (value: string) => void;
    onRoleMappingChange: (sourceId: string, targetId: string) => void;
    onStructurePolicyChange: (policy: DashboardBlueprintPolicy) => void;
}) {
    const sourceSummary = sourceState.status === 'ready' ? readSourceSummary(sourceState.json) : undefined;

    if (step === 'source') {
        return (
            <div className='py-5 sm:py-6'>
                <div className='flex gap-2' role='tablist' aria-label='Blueprint source method'>
                    {(['file', 'paste'] as const).map((sourceMode) => (
                        <button
                            key={sourceMode}
                            type='button'
                            role='tab'
                            aria-selected={mode === sourceMode}
                            onClick={() => onModeChange(sourceMode)}
                            className={
                                mode === sourceMode
                                    ? dashboardPrimaryActionClassName
                                    : dashboardSecondaryActionClassName
                            }>
                            {sourceMode === 'file' ? 'File' : 'Paste JSON'}
                        </button>
                    ))}
                </div>

                {mode === 'file' ? (
                    <BlueprintFileDropZone sourceState={sourceState} onFilesSelected={onFilesSelected} />
                ) : (
                    <div className='mt-5 max-w-3xl'>
                        <label
                            htmlFor='server-blueprint-import-json'
                            className='text-sm font-semibold text-[var(--dash-text)]'>
                            Blueprint JSON
                        </label>
                        <textarea
                            id='server-blueprint-import-json'
                            value={pasteJson}
                            onChange={(event) => onPasteJsonChange(event.currentTarget.value)}
                            rows={12}
                            spellCheck={false}
                            className={`${dashboardFieldClassName} mt-2 resize-y py-2 font-mono text-xs`}
                            placeholder='Paste Blueprint JSON.'
                            aria-describedby={sourceState.status === 'invalid' ? 'blueprint-source-error' : undefined}
                        />
                        {sourceState.status === 'invalid' ? (
                            <p
                                id='blueprint-source-error'
                                className='mt-2 text-xs text-[var(--dash-danger)]'
                                role='alert'>
                                {sourceState.message}
                            </p>
                        ) : null}
                    </div>
                )}

                {sourceSummary && sourceState.status === 'ready' ? (
                    <SourceSummary
                        sourceState={sourceState}
                        summary={sourceSummary}
                        targetGuildId={targetGuildId}
                        targetGuildName={targetGuildName}
                    />
                ) : null}
            </div>
        );
    }

    const mappingRows = roleMappingConflicts.flatMap((conflict) =>
        conflict.sourceIds.map((sourceId) => ({ conflict, sourceId }))
    );

    return (
        <div className='py-5 sm:py-6'>
            {sourceSummary && sourceState.status === 'ready' ? (
                <div className='max-w-4xl rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-raised)] p-4 sm:p-5'>
                    <div className='flex flex-wrap items-start justify-between gap-3'>
                        <div>
                            <p className='text-sm font-semibold text-[var(--dash-text)]'>Validated source</p>
                            <p className='mt-1 text-xs text-[var(--dash-text-muted)]'>
                                {sourceSummary.guildName ?? sourceSummary.guildId ?? 'Portable blueprint'} ·{' '}
                                {sourceSummary.roles} roles · {sourceSummary.categories} categories ·{' '}
                                {sourceSummary.channels} channels
                            </p>
                        </div>
                        <button type='button' onClick={onChangeSource} className={dashboardSecondaryActionClassName}>
                            Change source
                        </button>
                    </div>
                    <dl className='mt-4 grid gap-3 text-xs text-[var(--dash-text-muted)] sm:grid-cols-2'>
                        <SourceSummaryDetails
                            sourceState={sourceState}
                            summary={sourceSummary}
                            targetGuildId={targetGuildId}
                            targetGuildName={targetGuildName}
                        />
                    </dl>
                    <button
                        type='button'
                        onClick={onInspectSource}
                        className={`mt-4 ${dashboardSecondaryActionClassName}`}>
                        Inspect source
                    </button>
                </div>
            ) : null}

            <fieldset className='mt-5 max-w-3xl' aria-label='Deployment policy'>
                <legend className='text-sm font-semibold text-[var(--dash-text)]'>Deployment policy</legend>
                <div className='mt-3 grid gap-2'>
                    {deploymentPolicies.map((option) => (
                        <label
                            key={option.value}
                            htmlFor={`structure-policy-${option.value}`}
                            aria-label={option.label}
                            className={`flex cursor-pointer items-start gap-3 rounded-[var(--dash-radius-control)] border p-4 transition-[border-color,background-color,box-shadow] focus-within:shadow-[var(--dash-shadow-focus)] ${
                                structurePolicy === option.value
                                    ? 'border-[var(--dash-primary)] bg-[var(--dash-primary-ring)]'
                                    : 'border-[var(--dash-border)] bg-[var(--dash-surface-raised)]'
                            }`}>
                            <input
                                id={`structure-policy-${option.value}`}
                                type='radio'
                                name='structure-policy'
                                value={option.value}
                                checked={structurePolicy === option.value}
                                onChange={() => onStructurePolicyChange(option.value)}
                                className='mt-1 size-4 border-[var(--dash-border-strong)] bg-[var(--dash-bg)] text-[var(--dash-primary)]'
                            />
                            <span>
                                <strong className='block text-sm text-[var(--dash-text)]'>{option.label}</strong>
                                <span className='mt-1 block text-xs leading-5 text-[var(--dash-text-muted)]'>
                                    {option.description}
                                </span>
                            </span>
                        </label>
                    ))}
                </div>
            </fieldset>

            {mappingRows.length > 0 ? (
                <div
                    className='mt-5 max-w-3xl rounded-[var(--dash-radius-control)] border border-[color:var(--dash-warning)]/35 bg-[var(--dash-warning-soft)] p-4 sm:p-5'
                    role='alert'>
                    <h4 className='text-sm font-semibold text-[var(--dash-warning)]'>
                        Match duplicate blueprint items
                    </h4>
                    <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                        Select each existing target role once. No server changes occur until the reviewed plan is
                        applied.
                    </p>
                    <div className='mt-4 space-y-4'>
                        {mappingRows.map(({ conflict, sourceId }) => (
                            <label key={sourceId} className='block text-xs text-[var(--dash-text-muted)]'>
                                <span className='mb-1 block font-semibold text-[var(--dash-text)]'>
                                    Source {conflict.targetType} {conflict.name} ({sourceId})
                                </span>
                                <select
                                    aria-label={`Target ${conflict.targetType} for ${conflict.name} ${sourceId}`}
                                    value={roleMappings[sourceId] ?? ''}
                                    onChange={(event) => onRoleMappingChange(sourceId, event.currentTarget.value)}
                                    className={dashboardCompactFieldClassName}>
                                    <option value=''>Choose an existing target {conflict.targetType}</option>
                                    {conflict.candidateTargetIds.map((targetId) => {
                                        const selectedElsewhere = Object.entries(roleMappings).some(
                                            ([selectedSourceId, selectedTargetId]) =>
                                                selectedSourceId !== sourceId && selectedTargetId === targetId
                                        );
                                        return (
                                            <option key={targetId} value={targetId} disabled={selectedElsewhere}>
                                                {conflict.name} ({targetId})
                                            </option>
                                        );
                                    })}
                                </select>
                            </label>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function BlueprintFileDropZone({
    sourceState,
    onFilesSelected,
}: {
    sourceState: DashboardBlueprintSourceState;
    onFilesSelected: (files: readonly File[]) => void;
}) {
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const invalid = sourceState.mode === 'file' && sourceState.status === 'invalid';
    const ready = sourceState.mode === 'file' && sourceState.status === 'ready';
    const DropZoneIcon = dragActive ? UploadCloud : ready ? FileCheck2 : FileJson2;

    return (
        <div className='mt-5 max-w-3xl'>
            <input
                ref={fileInputRef}
                tabIndex={-1}
                type='file'
                accept='application/json,.json'
                aria-label='Blueprint JSON file input'
                aria-describedby={invalid ? 'blueprint-source-file-error' : 'blueprint-source-file-help'}
                onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = '';
                    onFilesSelected(files);
                }}
                className='sr-only'
            />
            <div
                tabIndex={0}
                role='button'
                aria-label='Choose a Blueprint JSON file'
                aria-describedby={invalid ? 'blueprint-source-file-error' : 'blueprint-source-file-help'}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    fileInputRef.current?.click();
                }}
                onDragEnter={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                }}
                onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                }}
                onDragLeave={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                }}
                onDrop={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                    onFilesSelected(Array.from(event.dataTransfer.files));
                }}
                className={`flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-[var(--dash-radius-control)] border border-dashed px-5 py-7 text-center transition-[border-color,background-color,box-shadow] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none ${
                    dragActive
                        ? 'border-[var(--dash-primary)] bg-[var(--dash-primary-soft)]'
                        : invalid
                          ? 'border-[var(--dash-danger)] bg-[var(--dash-danger-soft)]'
                          : 'border-[var(--dash-border-strong)] bg-[var(--dash-surface-raised)] hover:border-[var(--dash-primary)] hover:bg-[var(--dash-primary-soft)]'
                }`}>
                <DropZoneIcon
                    className={`size-8 transition-transform motion-reduce:transition-none ${
                        dragActive
                            ? 'scale-110 text-[var(--dash-primary-strong)]'
                            : invalid
                              ? 'text-[var(--dash-danger)]'
                              : ready
                                ? 'text-[var(--dash-success)]'
                                : 'text-[var(--dash-primary)]'
                    }`}
                    aria-hidden='true'
                />
                <span className='mt-3 text-sm font-semibold text-[var(--dash-text)]'>
                    {sourceState.status === 'reading'
                        ? `Reading ${sourceState.fileName}…`
                        : 'Choose a Blueprint JSON file'}
                </span>
                <span id='blueprint-source-file-help' className='mt-1 text-xs text-[var(--dash-text-muted)]'>
                    or drag it here
                </span>
                <span className='mt-1 text-[11px] text-[var(--dash-text-subtle)]'>JSON · maximum 4 MiB</span>
            </div>
            {invalid ? (
                <p id='blueprint-source-file-error' className='mt-2 text-xs text-[var(--dash-danger)]' role='alert'>
                    {sourceState.message}
                </p>
            ) : null}
        </div>
    );
}

function SourceSummary({
    sourceState,
    summary,
    targetGuildId,
    targetGuildName,
}: {
    sourceState: Extract<DashboardBlueprintSourceState, { status: 'ready' }>;
    summary: NonNullable<ReturnType<typeof readSourceSummary>>;
    targetGuildId: string;
    targetGuildName: string;
}) {
    return (
        <div className='mt-5 max-w-4xl rounded-[var(--dash-radius-control)] border border-[color:var(--dash-success)]/35 bg-[var(--dash-success-soft)] p-4 sm:p-5'>
            <p className='text-sm font-semibold text-[var(--dash-text)]'>Blueprint ready</p>
            <p className='mt-1 text-xs text-[var(--dash-text-muted)]'>
                {summary.roles} roles · {summary.categories} categories · {summary.channels} channels
            </p>
            <dl className='mt-4 grid gap-3 text-xs text-[var(--dash-text-muted)] sm:grid-cols-2'>
                <SourceSummaryDetails
                    sourceState={sourceState}
                    summary={summary}
                    targetGuildId={targetGuildId}
                    targetGuildName={targetGuildName}
                />
            </dl>
        </div>
    );
}

function SourceSummaryDetails({
    sourceState,
    summary,
    targetGuildId,
    targetGuildName,
}: {
    sourceState: Extract<DashboardBlueprintSourceState, { status: 'ready' }>;
    summary: NonNullable<ReturnType<typeof readSourceSummary>>;
    targetGuildId: string;
    targetGuildName: string;
}) {
    return (
        <>
            {sourceState.file ? (
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>File</dt>
                    <dd>
                        {sourceState.file.name} · {formatFileSize(sourceState.file.size)}
                    </dd>
                </div>
            ) : null}
            <div>
                <dt className='text-[var(--dash-text-subtle)]'>Source server</dt>
                <dd>{summary.guildName ?? summary.guildId ?? 'Not identified in this blueprint'}</dd>
            </div>
            <div>
                <dt className='text-[var(--dash-text-subtle)]'>Blueprint</dt>
                <dd>
                    Version {summary.version}
                    {summary.exportedAt ? ` · Exported ${formatDate(summary.exportedAt)}` : ''}
                </dd>
            </div>
            <div>
                <dt className='text-[var(--dash-text-subtle)]'>Target</dt>
                <dd>{targetGuildName}</dd>
            </div>
            <div>
                <dt className='text-[var(--dash-text-subtle)]'>Deployment scope</dt>
                <dd>{formatDeploymentScope(summary.guildId, targetGuildId)}</dd>
            </div>
        </>
    );
}

function readSourceSummary(value: string) {
    const source = readDashboardBlueprintSourceSnapshot(value);
    if (!source) return undefined;
    return {
        version: source.version,
        guildId: source.guildId,
        guildName: source.guildName,
        exportedAt: source.exportedAt,
        roles: source.roles.length,
        categories: source.categories.length,
        channels: source.channels.length,
    };
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
}

function formatDeploymentScope(sourceGuildId: string | undefined, targetGuildId: string): string {
    if (!sourceGuildId) return 'Source server ID not included';
    return sourceGuildId === targetGuildId ? 'Same-server deployment' : 'Cross-server deployment';
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US');
}

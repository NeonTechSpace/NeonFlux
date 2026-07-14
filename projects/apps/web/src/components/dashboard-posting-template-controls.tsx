import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';

import { getDashboardAuditEventsBaseQueryKey, getDashboardPostingTemplatesQueryKey } from '../dashboard-query-keys.js';
import {
    deleteDashboardPostingTemplateRouteData,
    readDashboardPostingTemplatesRouteData,
    saveDashboardPostingTemplateRouteData,
} from '../server/dashboard-posting-templates-route-data.js';
import type { DashboardMessageTemplate } from '../server/dashboard-posting-templates.server.js';
import {
    canRetryDashboardGuildRead,
    DashboardGuildReadError,
    readDashboardGuildReadFailureType,
} from './dashboard-guild-read-error.js';
import {
    dashboardConfirmationTransition,
    dashboardConfirmationVariants,
    dashboardTactile,
} from './dashboard-motion.js';
import {
    dashboardDangerActionClassName,
    dashboardFieldClassName,
    dashboardSecondaryActionClassName,
} from './dashboard-ui.js';

type TemplateControlsMessage = {
    type: 'error' | 'success' | 'warning';
    text: string;
};

type TemplateConfirmation = { type: 'apply' | 'delete'; templateId: string };

export function DashboardPostingTemplateControls({
    guildId,
    content,
    embeds,
    payloadError,
    onApplyTemplate,
    onMessage,
}: {
    guildId: string;
    content: string;
    embeds: unknown[];
    payloadError?: string;
    onApplyTemplate: (template: DashboardMessageTemplate) => void;
    onMessage: (message: TemplateControlsMessage) => void;
}) {
    const queryClient = useQueryClient();
    const [templateName, setTemplateName] = useState('');
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [confirmation, setConfirmation] = useState<TemplateConfirmation>();
    const [templatesRetrying, setTemplatesRetrying] = useState(false);

    const templatesQuery = useQuery({
        queryKey: getDashboardPostingTemplatesQueryKey(guildId),
        queryFn: async ({ queryKey }) => {
            const queryGuildId = queryKey[2];
            const result = await readDashboardPostingTemplatesRouteData({
                data: {
                    guildId: queryGuildId,
                },
            });

            if (result.type !== 'templates') {
                throw new DashboardGuildReadError(result.type);
            }

            return result.templates;
        },
        retry: false,
    });
    const templateFailureType = templatesQuery.isError
        ? readDashboardGuildReadFailureType(templatesQuery.error)
        : undefined;
    const templatesUnavailable = templatesQuery.isError || templatesRetrying;
    const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
    const selectedTemplate = useMemo(
        () => templates.find((template) => template.id === selectedTemplateId),
        [selectedTemplateId, templates]
    );

    const saveMutation = useMutation({
        mutationFn: (payload: {
            name: string;
            content?: string;
            embeds: unknown[];
            template?: DashboardMessageTemplate;
        }) =>
            saveDashboardPostingTemplateRouteData({
                data: {
                    guildId,
                    name: payload.name,
                    ...(payload.content ? { content: payload.content } : {}),
                    embeds: payload.embeds,
                    ...(payload.template
                        ? { expectedUpdatedAt: payload.template.updatedAt, templateId: payload.template.id }
                        : {}),
                },
            }),
        onSuccess: async (result) => {
            switch (result.type) {
                case 'saved':
                    setTemplateName('');
                    setSelectedTemplateId(result.template.id);
                    onMessage({ type: 'success', text: `Template saved: ${result.template.name}.` });
                    await invalidateTemplateQueries(queryClient, guildId);
                    return;

                case 'invalid-template':
                    onMessage({ type: 'error', text: result.message });
                    return;

                case 'template-conflict':
                    onMessage({
                        type: 'warning',
                        text:
                            result.field === 'name'
                                ? 'That template name is already in use.'
                                : 'This template changed elsewhere. Reload it before saving.',
                    });
                    await invalidateTemplateQueries(queryClient, guildId);
                    return;

                case 'auth-required':
                    onMessage({ type: 'error', text: 'Sign in again before saving templates.' });
                    return;

                case 'not-found':
                    onMessage({ type: 'error', text: 'This server is not available for this account.' });
                    return;

                case 'deployment-config-not-found':
                case 'database-error':
                case 'guild-lookup-failed':
                    onMessage({ type: 'error', text: 'Could not save this template. Try again.' });
                    return;
            }
        },
        onError: () => {
            onMessage({ type: 'error', text: 'Could not save this template. Try again.' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (template: DashboardMessageTemplate) =>
            deleteDashboardPostingTemplateRouteData({
                data: {
                    guildId,
                    expectedUpdatedAt: template.updatedAt,
                    templateId: template.id,
                },
            }),
        onSuccess: async (result) => {
            switch (result.type) {
                case 'deleted':
                    setSelectedTemplateId('');
                    setConfirmation(undefined);
                    onMessage({ type: 'success', text: 'Template deleted.' });
                    await invalidateTemplateQueries(queryClient, guildId);
                    return;

                case 'auth-required':
                    onMessage({ type: 'error', text: 'Sign in again before deleting templates.' });
                    return;

                case 'not-found':
                    onMessage({ type: 'error', text: 'Template no longer exists.' });
                    await invalidateTemplateQueries(queryClient, guildId);
                    return;

                case 'template-conflict':
                    onMessage({ type: 'warning', text: 'This template changed elsewhere. Reload it before deleting.' });
                    await invalidateTemplateQueries(queryClient, guildId);
                    return;

                case 'deployment-config-not-found':
                case 'database-error':
                case 'guild-lookup-failed':
                    onMessage({ type: 'error', text: 'Could not delete this template. Try again.' });
                    return;
            }
        },
        onError: () => {
            onMessage({ type: 'error', text: 'Could not delete this template. Try again.' });
        },
    });

    function saveCurrentTemplate(): void {
        const name = templateName.trim();
        const trimmedContent = content.trim();

        if (!name) {
            onMessage({ type: 'error', text: 'Template name is required.' });
            return;
        }

        if (payloadError) {
            onMessage({ type: 'error', text: payloadError });
            return;
        }

        if (!trimmedContent && embeds.length === 0) {
            onMessage({ type: 'error', text: 'Add message content or at least one embed before saving.' });
            return;
        }

        saveMutation.mutate({
            name,
            ...(trimmedContent ? { content: trimmedContent } : {}),
            embeds,
            ...(selectedTemplate ? { template: selectedTemplate } : {}),
        });
    }

    function applySelectedTemplate(): void {
        if (!selectedTemplate) {
            onMessage({ type: 'error', text: 'Choose a template first.' });
            return;
        }

        const composerHasContent = Boolean(content.trim() || embeds.length > 0 || payloadError);
        if (
            composerHasContent &&
            !(confirmation?.type === 'apply' && confirmation.templateId === selectedTemplate.id)
        ) {
            setConfirmation({ type: 'apply', templateId: selectedTemplate.id });
            onMessage({
                type: 'warning',
                text: `Replace the current message with ${selectedTemplate.name}? Select replace again to confirm.`,
            });
            return;
        }

        setConfirmation(undefined);
        onApplyTemplate(selectedTemplate);
        setTemplateName(selectedTemplate.name);
    }

    function deleteSelectedTemplate(): void {
        if (!selectedTemplate) {
            onMessage({ type: 'error', text: 'Choose a template first.' });
            return;
        }

        if (!(confirmation?.type === 'delete' && confirmation.templateId === selectedTemplate.id)) {
            setConfirmation({ type: 'delete', templateId: selectedTemplate.id });
            onMessage({
                type: 'warning',
                text: `Delete ${selectedTemplate.name}? This removes the saved template, not any messages already sent.`,
            });
            return;
        }

        deleteMutation.mutate(selectedTemplate);
    }

    return (
        <section className='space-y-3 border-t border-[var(--dash-border)] pt-5' aria-label='Posting templates'>
            <div>
                <h3 className='text-sm font-semibold text-[var(--dash-text)]'>Templates</h3>
                <p className='mt-1 text-xs text-[var(--dash-text-muted)]'>
                    Save and reuse dashboard-only message payloads.
                </p>
            </div>

            <div className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]'>
                <label className='space-y-2 text-sm font-medium text-[var(--dash-text)]'>
                    <span>Saved templates</span>
                    <select
                        value={selectedTemplateId}
                        onChange={(event) => {
                            const nextTemplateId = event.currentTarget.value;
                            setSelectedTemplateId(nextTemplateId);
                            const nextTemplate = templates.find((template) => template.id === nextTemplateId);
                            setTemplateName(nextTemplate?.name ?? '');
                            setConfirmation(undefined);
                        }}
                        className={fieldClassName}
                        disabled={templatesQuery.isPending || templatesUnavailable || templates.length === 0}>
                        <option value=''>
                            {templatesQuery.isPending
                                ? 'Loading templates...'
                                : templates.length === 0
                                  ? 'No saved templates'
                                  : 'Choose template'}
                        </option>
                        {templates.map((template) => (
                            <option key={template.id} value={template.id}>
                                {template.name}
                            </option>
                        ))}
                    </select>
                </label>

                <div className='flex flex-wrap items-end gap-2'>
                    <motion.button
                        type='button'
                        onClick={applySelectedTemplate}
                        disabled={
                            templatesUnavailable ||
                            !selectedTemplate ||
                            deleteMutation.isPending ||
                            saveMutation.isPending
                        }
                        className={secondaryButtonClassName}
                        {...dashboardTactile}>
                        {confirmation?.type === 'apply' && confirmation.templateId === selectedTemplate?.id
                            ? 'Confirm replace'
                            : 'Apply'}
                    </motion.button>
                    {confirmation?.type === 'apply' && confirmation.templateId === selectedTemplate?.id ? (
                        <motion.button
                            key='cancel-replace'
                            data-dashboard-motion='confirmation'
                            type='button'
                            onClick={() => setConfirmation(undefined)}
                            className={secondaryButtonClassName}
                            variants={dashboardConfirmationVariants}
                            initial='initial'
                            animate='enter'
                            transition={dashboardConfirmationTransition}
                            {...dashboardTactile}>
                            Cancel replace
                        </motion.button>
                    ) : null}
                    <motion.button
                        type='button'
                        onClick={deleteSelectedTemplate}
                        disabled={
                            templatesUnavailable ||
                            !selectedTemplate ||
                            deleteMutation.isPending ||
                            saveMutation.isPending
                        }
                        className={dangerButtonClassName}
                        {...dashboardTactile}>
                        {deleteMutation.isPending
                            ? 'Deleting…'
                            : confirmation?.type === 'delete' && confirmation.templateId === selectedTemplate?.id
                              ? 'Confirm delete'
                              : 'Delete'}
                    </motion.button>
                    {confirmation?.type === 'delete' && confirmation.templateId === selectedTemplate?.id ? (
                        <motion.button
                            key='cancel-delete'
                            data-dashboard-motion='confirmation'
                            type='button'
                            onClick={() => setConfirmation(undefined)}
                            className={secondaryButtonClassName}
                            variants={dashboardConfirmationVariants}
                            initial='initial'
                            animate='enter'
                            transition={dashboardConfirmationTransition}
                            {...dashboardTactile}>
                            Cancel
                        </motion.button>
                    ) : null}
                </div>
            </div>

            <div className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]'>
                <label className='space-y-2 text-sm font-medium text-[var(--dash-text)]'>
                    <span>Template name</span>
                    <input
                        value={templateName}
                        onChange={(event) => setTemplateName(event.currentTarget.value)}
                        className={fieldClassName}
                        placeholder='Release update'
                    />
                </label>
                <div className='flex items-end'>
                    <motion.button
                        type='button'
                        onClick={saveCurrentTemplate}
                        disabled={templatesUnavailable || saveMutation.isPending || deleteMutation.isPending}
                        className={secondaryButtonClassName}
                        {...dashboardTactile}>
                        {saveMutation.isPending ? 'Saving…' : 'Save current'}
                    </motion.button>
                </div>
            </div>
            <AnimatePresence initial={false}>
                {templatesUnavailable ? (
                    <motion.div
                        role='alert'
                        data-dashboard-motion='confirmation'
                        className='flex flex-wrap items-center gap-2 text-sm text-[var(--dash-danger)]'
                        variants={dashboardConfirmationVariants}
                        initial='initial'
                        animate='enter'
                        transition={dashboardConfirmationTransition}>
                        <span>{getTemplateLoadErrorMessage(templateFailureType ?? 'database-error')}</span>
                        {templatesRetrying ||
                        (templateFailureType && canRetryDashboardGuildRead(templateFailureType)) ? (
                            <button
                                type='button'
                                onClick={() => {
                                    if (templatesRetrying) return;
                                    setTemplatesRetrying(true);
                                    void templatesQuery.refetch().finally(() => setTemplatesRetrying(false));
                                }}
                                disabled={templatesRetrying}
                                aria-busy={templatesRetrying || undefined}
                                className={`${dashboardSecondaryActionClassName} min-h-8 text-xs`}>
                                {templatesRetrying ? 'Retrying…' : 'Retry templates'}
                            </button>
                        ) : null}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </section>
    );
}

function getTemplateLoadErrorMessage(type: string): string {
    switch (type) {
        case 'auth-required':
            return 'Sign in again to load templates before saving or deleting.';
        case 'not-found':
            return 'Templates are unavailable because this server is no longer accessible.';
        case 'deployment-config-not-found':
            return 'Templates are unavailable because this deployment is not fully configured.';
        case 'database-error':
        case 'guild-lookup-failed':
            return 'Templates could not be loaded. Retry before saving or deleting.';
        default:
            return 'Templates could not be loaded.';
    }
}

const fieldClassName = `${dashboardFieldClassName} py-2`;
const secondaryButtonClassName = `${dashboardSecondaryActionClassName} inline-flex items-center justify-center`;
const dangerButtonClassName = `${dashboardDangerActionClassName} inline-flex items-center justify-center`;

async function invalidateTemplateQueries(queryClient: ReturnType<typeof useQueryClient>, guildId: string) {
    await Promise.all([
        queryClient.invalidateQueries({
            queryKey: getDashboardPostingTemplatesQueryKey(guildId),
        }),
        queryClient.invalidateQueries({
            queryKey: getDashboardAuditEventsBaseQueryKey(guildId),
        }),
    ]);
}

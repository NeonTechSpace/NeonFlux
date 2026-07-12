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
    dashboardConfirmationTransition,
    dashboardConfirmationVariants,
    dashboardTactile,
} from './dashboard-motion.js';

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

    const templatesQuery = useQuery({
        queryKey: getDashboardPostingTemplatesQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardPostingTemplatesRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'templates') {
                throw new Error('Could not load posting templates.');
            }

            return result.templates;
        },
    });
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
                        disabled={templatesQuery.isPending || templatesQuery.isError || templates.length === 0}>
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
                            templatesQuery.isError ||
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
                            templatesQuery.isError ||
                            !selectedTemplate ||
                            deleteMutation.isPending ||
                            saveMutation.isPending
                        }
                        className={dangerButtonClassName}
                        {...dashboardTactile}>
                        {confirmation?.type === 'delete' && confirmation.templateId === selectedTemplate?.id
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
                        disabled={templatesQuery.isError || saveMutation.isPending || deleteMutation.isPending}
                        className={secondaryButtonClassName}
                        {...dashboardTactile}>
                        {saveMutation.isPending ? 'Saving…' : 'Save current'}
                    </motion.button>
                </div>
            </div>
            <AnimatePresence initial={false}>
                {templatesQuery.isError ? (
                    <motion.p
                        role='alert'
                        data-dashboard-motion='confirmation'
                        className='text-sm text-rose-300'
                        variants={dashboardConfirmationVariants}
                        initial='initial'
                        animate='enter'
                        transition={dashboardConfirmationTransition}>
                        Templates could not be loaded. Reload them before saving or deleting.
                    </motion.p>
                ) : null}
            </AnimatePresence>
        </section>
    );
}

const fieldClassName =
    'min-h-10 w-full rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] px-3 py-2 text-sm text-[var(--dash-text)] outline-none transition placeholder:text-[var(--dash-text-disabled)] focus:border-[var(--dash-primary)] focus:ring-2 focus:ring-[var(--dash-primary-ring)] disabled:cursor-not-allowed disabled:text-[var(--dash-text-disabled)]';
const secondaryButtonClassName =
    'inline-flex min-h-10 items-center justify-center rounded-[var(--dash-radius-control)] border border-[var(--dash-border-interactive)] px-3 text-sm font-semibold text-[var(--dash-text)] transition hover:border-[var(--dash-primary)] hover:text-[var(--dash-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dash-primary)] disabled:cursor-not-allowed disabled:border-[var(--dash-border)] disabled:text-[var(--dash-text-disabled)]';
const dangerButtonClassName =
    'inline-flex min-h-10 items-center justify-center rounded-[var(--dash-radius-control)] border border-rose-400/45 px-3 text-sm font-semibold text-rose-100 transition hover:border-rose-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300 disabled:cursor-not-allowed disabled:border-[var(--dash-border)] disabled:text-[var(--dash-text-disabled)]';

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

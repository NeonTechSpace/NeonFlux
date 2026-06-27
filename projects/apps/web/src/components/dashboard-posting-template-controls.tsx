import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardAuditEventsQueryKey, getDashboardPostingTemplatesQueryKey } from '../dashboard-query-keys.js';
import {
    deleteDashboardPostingTemplateRouteData,
    readDashboardPostingTemplatesRouteData,
    saveDashboardPostingTemplateRouteData,
} from '../server/dashboard-posting-templates-route-data.js';
import type { DashboardMessageTemplate } from '../server/dashboard-posting-templates.server.js';

type TemplateControlsMessage = {
    type: 'error' | 'success' | 'warning';
    text: string;
};

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
        mutationFn: (payload: { name: string; content?: string; embeds: unknown[] }) =>
            saveDashboardPostingTemplateRouteData({
                data: {
                    guildId,
                    name: payload.name,
                    ...(payload.content ? { content: payload.content } : {}),
                    embeds: payload.embeds,
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
        mutationFn: (templateId: string) =>
            deleteDashboardPostingTemplateRouteData({
                data: {
                    guildId,
                    templateId,
                },
            }),
        onSuccess: async (result) => {
            switch (result.type) {
                case 'deleted':
                    setSelectedTemplateId('');
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
        });
    }

    function applySelectedTemplate(): void {
        if (!selectedTemplate) {
            onMessage({ type: 'error', text: 'Choose a template first.' });
            return;
        }

        onApplyTemplate(selectedTemplate);
    }

    return (
        <section className='space-y-3 border-t border-neutral-800 pt-4' aria-label='Posting templates'>
            <div>
                <h3 className='text-sm font-semibold text-white'>Templates</h3>
                <p className='mt-1 text-xs text-neutral-500'>Save and reuse dashboard-only message payloads.</p>
            </div>

            <div className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]'>
                <label className='space-y-2 text-sm font-medium text-neutral-200'>
                    <span>Saved templates</span>
                    <select
                        value={selectedTemplateId}
                        onChange={(event) => setSelectedTemplateId(event.currentTarget.value)}
                        className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white transition outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                        disabled={templatesQuery.isPending || templates.length === 0}>
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

                <div className='flex items-end gap-2'>
                    <button
                        type='button'
                        onClick={applySelectedTemplate}
                        disabled={!selectedTemplate || deleteMutation.isPending || saveMutation.isPending}
                        className='inline-flex min-h-10 items-center rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-neutral-500 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:outline-none disabled:cursor-not-allowed disabled:text-neutral-500'>
                        Apply
                    </button>
                    <button
                        type='button'
                        onClick={() => selectedTemplate && deleteMutation.mutate(selectedTemplate.id)}
                        disabled={!selectedTemplate || deleteMutation.isPending || saveMutation.isPending}
                        className='inline-flex min-h-10 items-center rounded-md border border-rose-800/70 px-3 text-sm font-semibold text-rose-200 transition hover:border-rose-500 focus:ring-2 focus:ring-rose-300 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:outline-none disabled:cursor-not-allowed disabled:text-neutral-500'>
                        Delete
                    </button>
                </div>
            </div>

            <div className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]'>
                <label className='space-y-2 text-sm font-medium text-neutral-200'>
                    <span>Template name</span>
                    <input
                        value={templateName}
                        onChange={(event) => setTemplateName(event.currentTarget.value)}
                        className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                        placeholder='Release update'
                    />
                </label>
                <div className='flex items-end'>
                    <button
                        type='button'
                        onClick={saveCurrentTemplate}
                        disabled={saveMutation.isPending || deleteMutation.isPending}
                        className='inline-flex min-h-10 items-center rounded-md bg-neutral-100 px-3 text-sm font-semibold text-neutral-950 transition hover:bg-white focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:outline-none disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        {saveMutation.isPending ? 'Saving...' : 'Save current'}
                    </button>
                </div>
            </div>
        </section>
    );
}

async function invalidateTemplateQueries(queryClient: ReturnType<typeof useQueryClient>, guildId: string) {
    await Promise.all([
        queryClient.invalidateQueries({
            queryKey: getDashboardPostingTemplatesQueryKey(guildId),
        }),
        queryClient.invalidateQueries({
            queryKey: getDashboardAuditEventsQueryKey(guildId),
        }),
    ]);
}

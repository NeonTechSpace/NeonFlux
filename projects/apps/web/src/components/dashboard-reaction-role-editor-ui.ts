export function getReactionRoleSaveErrorMessage(type: string, message?: string): string {
    if (message) return message;

    switch (type) {
        case 'invalid-input':
            return 'Check the message, emoji, and role options before saving.';
        case 'auth-required':
            return 'Sign in again before changing settings.';
        case 'bot-token-missing':
            return 'Reaction-role editing is not configured for this deployment.';
        case 'edit-failed':
            return 'Fluxer could not edit this reaction-role message.';
        case 'send-failed':
            return 'Fluxer could not publish this menu.';
        case 'not-found':
            return 'This reaction-role menu is not available anymore.';
        case 'operation-busy':
            return 'This menu already has a synchronization in progress.';
        case 'revision-conflict':
            return 'This menu changed elsewhere. Reload it before saving.';
        case 'idempotency-conflict':
            return 'This submission changed after it was queued. Try saving again.';
        default:
            return 'Could not save this reaction-role menu.';
    }
}

export function getReactionRoleEditorMessageTone(
    type: 'error' | 'success' | 'warning'
): 'danger' | 'success' | 'warning' {
    if (type === 'success') return 'success';
    if (type === 'warning') return 'warning';
    return 'danger';
}

export const reactionRoleEditorFieldClassName =
    'min-h-32 w-full resize-y rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] px-3 py-2 text-base text-[var(--dash-text)] outline-none transition placeholder:text-[var(--dash-text-disabled)] focus:border-[var(--dash-primary)] focus:ring-2 focus:ring-[var(--dash-primary-ring)]';
export const reactionRolePrimaryButtonClassName =
    'inline-flex min-h-10 items-center justify-center rounded-[var(--dash-radius-control)] bg-[var(--dash-primary)] px-4 text-sm font-semibold text-[#06111a] transition hover:bg-[var(--dash-primary-strong)] disabled:cursor-not-allowed disabled:bg-[var(--dash-surface-muted)] disabled:text-[var(--dash-text-disabled)]';
export const reactionRoleSecondaryButtonClassName =
    'inline-flex min-h-10 items-center justify-center rounded-[var(--dash-radius-control)] border border-[var(--dash-border-interactive)] px-3 text-sm font-semibold text-[var(--dash-text)] transition hover:border-[var(--dash-primary)] hover:text-[var(--dash-primary)] disabled:cursor-not-allowed disabled:border-[var(--dash-border)] disabled:text-[var(--dash-text-disabled)]';

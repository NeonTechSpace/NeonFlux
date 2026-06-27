import '@tanstack/react-start/server-only';

import {
    createProfileSubmission,
    findProfileFormByGuildName,
    listProfileFieldsByFormId,
    recordBotActionEvent,
} from '@neonflux/db';
import { listFluxerCurrentUserGuilds } from '@neonflux/fluxer/guilds';

import { getWebDatabaseClient } from './database.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';
import { normalizeProfileBuilderValues, toDashboardProfileField } from './profile-builder-shared.js';
import type { DashboardProfileField } from './profile-builder-shared.js';

export type PublicProfileBuilderPageResult =
    | {
          type: 'form';
          guildId: string;
          formId: string;
          formName: string;
          approvalRequired: boolean;
          fields: DashboardProfileField[];
      }
    | { type: 'not-found' }
    | { type: 'database-error' };

export type PublicProfileBuilderSubmitInput = {
    guildId: string;
    formName: string;
    values?: Record<string, unknown>;
};

export type PublicProfileBuilderSubmitResult =
    | {
          type: 'submitted';
          submissionId: string;
          status: 'pending' | 'approved';
      }
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'not-member' }
    | { type: 'invalid-input'; field: string }
    | { type: 'guild-lookup-failed' }
    | { type: 'database-error' };

export async function loadPublicProfileBuilderPage(input: {
    guildId: string;
    formName?: string;
}): Promise<PublicProfileBuilderPageResult> {
    const guildId = input.guildId.trim();
    const formName = (input.formName?.trim() || 'default').toLowerCase();

    if (!guildId || !formName) {
        return { type: 'not-found' };
    }

    const database = getWebDatabaseClient();
    const formResult = await findProfileFormByGuildName(database.db, {
        guildId,
        name: formName,
        enabledOnly: true,
    });

    if (formResult.isErr()) {
        return formResult.error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
    }

    const fieldsResult = await listProfileFieldsByFormId(database.db, { formId: formResult.value.id });

    if (fieldsResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'form',
        guildId: formResult.value.guildId,
        formId: formResult.value.id,
        formName: formResult.value.name,
        approvalRequired: formResult.value.approvalRequired,
        fields: fieldsResult.value.map(toDashboardProfileField),
    };
}

export async function submitPublicProfileBuilderForm(
    request: Request,
    input: PublicProfileBuilderSubmitInput
): Promise<PublicProfileBuilderSubmitResult> {
    const pageResult = await loadPublicProfileBuilderPage({
        guildId: input.guildId,
        formName: input.formName,
    });

    if (pageResult.type !== 'form') {
        return pageResult;
    }

    if (pageResult.fields.length === 0) {
        return { type: 'invalid-input', field: 'fields' };
    }

    const authContextResult = await readAuthenticatedFluxerContext(request);

    if (authContextResult.isErr()) {
        return authContextResult.error === 'database-error' ? { type: 'database-error' } : { type: 'auth-required' };
    }

    const memberResult = await verifyProfileBuilderGuildMembership({
        accessToken: authContextResult.value.accessToken,
        guildId: pageResult.guildId,
    });

    if (memberResult !== 'member') {
        return memberResult;
    }

    const valuesResult = normalizeProfileBuilderValues(pageResult.fields, input.values ?? {});

    if (valuesResult.type !== 'valid') {
        return valuesResult;
    }

    const status = pageResult.approvalRequired ? 'pending' : 'approved';
    const database = getWebDatabaseClient();
    const submissionResult = await createProfileSubmission(database.db, {
        guildId: pageResult.guildId,
        formId: pageResult.formId,
        userId: authContextResult.value.fluxerUserId,
        values: valuesResult.values,
        status,
    });

    if (submissionResult.isErr()) {
        return submissionResult.error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
    }

    const auditResult = await recordBotActionEvent(database.db, {
        guildId: pageResult.guildId,
        feature: 'profile_builder',
        action: 'submission.created',
        actorUserId: authContextResult.value.fluxerUserId,
        targetId: submissionResult.value.id,
        metadata: {
            submissionId: submissionResult.value.id,
            formId: pageResult.formId,
            formName: pageResult.formName,
            status,
            fieldCount: Object.keys(valuesResult.values).length,
            source: 'public-profile-builder',
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'submitted',
        submissionId: submissionResult.value.id,
        status,
    };
}

async function verifyProfileBuilderGuildMembership(input: {
    accessToken: string;
    guildId: string;
}): Promise<'member' | { type: 'not-member' } | { type: 'guild-lookup-failed' }> {
    const guildsResult = await listFluxerCurrentUserGuilds({
        accessToken: input.accessToken,
        limit: 200,
    });

    if (guildsResult.isErr()) {
        return { type: 'guild-lookup-failed' };
    }

    return guildsResult.value.some((guild) => guild.id === input.guildId) ? 'member' : { type: 'not-member' };
}

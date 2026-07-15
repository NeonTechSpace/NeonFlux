/* eslint-disable testing-library/prefer-screen-queries -- Playwright locators query a live browser page. */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRuntimeConfig } from '@neonflux/config';
import {
    claimNextDashboardPostingOperation,
    createRuntimeDb,
    createWebSession,
    listDashboardPostingOperationsByGuild,
    markDashboardPostingOperationSendStarted,
    markDashboardPostingOperationUnknown,
    upsertBotInstallation,
    upsertDeploymentConfig,
    upsertFluxerOAuthTokenSet,
} from '@neonflux/db';
import type { RuntimeDbClient } from '@neonflux/db';
import type { Result } from 'neverthrow';

import { encryptFluxerToken } from '../../src/server/fluxer-token-crypto.js';
import { createSessionCookie, createSessionId, SESSION_COOKIE_NAME } from '../../src/server/session-cookie.js';
import { observePageDiagnostics } from '../support/page-diagnostics.js';

const sentinel = 'neonflux-e2e-ephemeral-v1';
const userId = 'e2e-browser-user-1';
const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const providerStatePath = resolve(webDirectory, '.e2e-runtime', 'provider-state.json');
let guildId: string;
let botDatabase: RuntimeDbClient;
let webDatabase: RuntimeDbClient;
let sessionCookieValue: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    if (process.env.NEONFLUX_E2E_AUTHENTICATED !== sentinel) {
        throw new Error('Signed-in browser tests require the exact temporary-test sentinel.');
    }
    const config = loadRuntimeConfig(process.env);
    guildId = `e2e-browser-guild-${randomUUID()}`;
    const sessionId = createSessionId();
    botDatabase = await createRuntimeDb(config, { serviceName: 'bot' });
    webDatabase = await createRuntimeDb(config, { serviceName: 'web' });

    requireOk(await upsertDeploymentConfig(botDatabase.db, { instanceMode: 'multi', ownerIds: [userId] }));
    requireOk(await upsertBotInstallation(botDatabase.db, { guildId }));
    requireOk(
        await createWebSession(webDatabase.db, {
            expiresAt: new Date(Date.now() + 60 * 60_000),
            fluxerUserId: userId,
            sessionId,
        })
    );
    const encryptedToken = encryptFluxerToken({
        encryptionKey: process.env.FLUXER_TOKEN_ENCRYPTION_KEY,
        token: 'e2e-fake-oauth-access-token',
    });
    if (encryptedToken.isErr()) throw new Error('Could not encrypt the authenticated browser OAuth fixture.');
    requireOk(
        await upsertFluxerOAuthTokenSet(webDatabase.db, {
            accessToken: encryptedToken.value,
            accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
            fluxerUserId: userId,
            scopes: ['identify', 'guilds'],
            tokenType: 'Bearer',
        })
    );

    const cookie = createSessionCookie({
        appEnv: 'development',
        sessionId,
        sessionSecret: process.env.SESSION_SECRET,
    });
    if (cookie.isErr()) throw new Error('Could not sign the authenticated browser session cookie.');
    const cookiePair = cookie.value.split(';', 1)[0];
    sessionCookieValue = cookiePair.slice(cookiePair.indexOf('=') + 1);
    if (!sessionCookieValue) throw new Error('Authenticated browser session cookie was empty.');
});

test.beforeEach(async ({ context }) => {
    await writeProviderState('Original');
    await context.addCookies([
        {
            domain: '127.0.0.1',
            httpOnly: true,
            name: SESSION_COOKIE_NAME,
            path: '/',
            sameSite: 'Lax',
            secure: false,
            value: sessionCookieValue,
        },
    ]);
});

test.afterAll(async () => {
    await Promise.all([botDatabase.close(), webDatabase.close()]);
});

test('composes and queues a message, observes the durable unknown status, and records operator resolution', async ({
    page,
}) => {
    const diagnostics = observePageDiagnostics(page);
    await page.goto(`/dashboard/${guildId}/messaging/message-builder`);
    await expect(page.getByRole('heading', { name: 'Message Builder' })).toBeVisible();

    await page.getByRole('combobox', { name: 'Channel' }).click();
    await page.getByRole('option', { name: /general/u }).click();
    await page.getByRole('textbox', { name: 'Message content' }).fill('Authenticated browser test');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText(/Queued for #general/u)).toBeVisible();

    const operations = requireOk(await listDashboardPostingOperationsByGuild(webDatabase.db, { guildId, limit: 5 }));
    const operation = operations.find(({ status }) => status === 'queued');
    if (!operation) throw new Error('Browser enqueue did not create a durable queued operation.');
    const now = new Date();
    const leaseId = 'authenticated-browser-unknown-lease';
    const claimed = requireOk(
        await claimNextDashboardPostingOperation(botDatabase.db, {
            leaseExpiresAt: new Date(now.getTime() + 30_000),
            leaseId,
            leaseOwner: 'authenticated-browser-fixture',
            now,
        })
    );
    if (claimed?.id !== operation.id) throw new Error('Authenticated browser fixture claimed the wrong operation.');
    requireOk(
        await markDashboardPostingOperationSendStarted(botDatabase.db, { leaseId, now, operationId: operation.id })
    );
    requireOk(
        await markDashboardPostingOperationUnknown(botDatabase.db, {
            channelName: 'general',
            errorCode: 'e2e_ambiguous_provider_outcome',
            leaseId,
            now: new Date(now.getTime() + 1),
            operationId: operation.id,
        })
    );

    await expect(page.getByRole('button', { name: 'I found the message' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'I found the message' }).click();
    await expect(page.getByText('Recorded that you found the message.')).toBeVisible();
    await expect(page.getByText(/operator reported finding the message/u)).toBeVisible();
    diagnostics.assertClean();
});

test('creates and approves a Blueprint plan, then refuses the stale live target during the safety check', async ({
    page,
}) => {
    const diagnostics = observePageDiagnostics(page);
    await page.goto(`/dashboard/${guildId}/blueprint/deploy`);
    await expect(page.getByRole('heading', { name: 'Deploy a blueprint' })).toBeVisible();

    await page.getByRole('tab', { name: 'Paste JSON' }).click();
    await page.getByRole('textbox', { name: 'Blueprint JSON' }).fill(JSON.stringify(blueprintDocument('Desired')));
    await page.getByRole('button', { name: 'Continue to configuration' }).click();
    await page.getByRole('radio', { name: 'Merge without deletions' }).check();
    await page.getByRole('button', { name: 'Generate review plan' }).click();
    await expect(page.getByText(/plan created with 1 change/u)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to final check' })).toBeVisible();

    await writeProviderState('Changed after review');
    await page.getByRole('button', { name: 'Continue to final check' }).click();
    await expect(page.getByText(/blocking changes? found\./u)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Locked until every prior check passes.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Apply /u })).toHaveCount(0);
    diagnostics.assertClean();
});

async function writeProviderState(roleName: string): Promise<void> {
    const state = {
        guild: { id: guildId, name: 'E2E Guild', owner_id: userId, permissions: '32' },
        sentinel,
        structure: providerStructure(roleName),
    };
    await writeFile(providerStatePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function providerStructure(roleName: string) {
    return {
        botHighestRolePosition: 2,
        categories: [],
        channels: [
            {
                id: 'channel-1',
                name: 'general',
                parentId: null,
                permissionOverwrites: [],
                position: 0,
                type: 0,
            },
        ],
        guildId,
        guildName: 'E2E Guild',
        roles: [
            {
                color: 0,
                hierarchyRank: 0,
                hoist: false,
                id: 'role-1',
                mentionable: false,
                name: roleName,
                permissions: '0',
                position: 1,
            },
        ],
    };
}

function blueprintDocument(roleName: string) {
    return { version: 1, ...providerStructure(roleName) };
}

function requireOk<T, TError>(result: Result<T, TError>): T {
    if (result.isErr()) throw new Error('Authenticated browser fixture persistence failed.');
    return result.value;
}

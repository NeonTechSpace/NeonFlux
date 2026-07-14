import { err, ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadRuntimeConfig } from '@neonflux/config';
import {
    createRuntimeDb,
    createWebSession,
    findLatestBlueprintRunForPlan,
    listDashboardPostingOperationsByGuild,
    upsertBotInstallation,
    upsertDeploymentConfig,
    upsertFluxerOAuthTokenSet,
} from '@neonflux/db';
import type { RuntimeDbClient } from '@neonflux/db';

import { runNextDashboardPostingOperation } from '../../../bot/src/bot-posting-worker.js';
import { runNextBlueprintRun } from '../../../bot/src/bot-blueprint-run-worker.js';
import { closeWebDb } from '../../src/server/db.server.js';
import { applyDashboardBlueprintPlan } from '../../src/server/dashboard-blueprint-apply.server.js';
import {
    approveDashboardBlueprintPlan,
    createDashboardBlueprintPlan,
} from '../../src/server/dashboard-blueprint-plans.server.js';
import { preflightDashboardBlueprintPlan } from '../../src/server/dashboard-blueprint-preflight.server.js';
import { isDashboardBlueprintPreflightReady } from '../../src/server/dashboard-blueprint-preflight.js';
import { loadDashboardGuildAccess } from '../../src/server/dashboard-guild-access.server.js';
import {
    postDashboardGuildMessage,
    resolveDashboardGuildPostingUnknown,
} from '../../src/server/dashboard-posting.server.js';
import { encryptFluxerToken } from '../../src/server/fluxer-token-crypto.js';
import { createSessionCookie } from '../../src/server/session-cookie.js';

const fakeProvider = vi.hoisted(() => ({
    applyBlueprint: vi.fn(),
    createPlatform: vi.fn(),
    listGuilds: vi.fn(),
    readBlueprint: vi.fn(),
    readWebStructure: vi.fn(),
    readUser: vi.fn(),
}));

vi.mock('@neonflux/fluxer/guilds', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    listFluxerCurrentUserGuilds: fakeProvider.listGuilds,
}));

vi.mock('@neonflux/fluxer/users', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    getFluxerCurrentUser: fakeProvider.readUser,
}));

vi.mock('@neonflux/fluxer/platform', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    createFluxerPlatform: fakeProvider.createPlatform,
}));

vi.mock('@neonflux/fluxer', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    applyFluxerBotGuildStructureActions: fakeProvider.applyBlueprint,
    readFluxerBotGuildStructure: fakeProvider.readBlueprint,
}));

vi.mock('../../src/server/bot-read-client.server.js', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    readDashboardBotGuildStructure: fakeProvider.readWebStructure,
}));

const enabled = process.env.NEONFLUX_E2E_AUTHENTICATED === 'neonflux-e2e-ephemeral-v1';
const guildId = 'e2e-composition-guild-1';
const userId = 'e2e-composition-user-1';
const sessionId = 'composition0123456789abcdefghijklmnopqrstuv';
let botDatabase: RuntimeDbClient;
let webDatabase: RuntimeDbClient;
let authenticatedRequest: Request;

describe.runIf(enabled)('authenticated production composition with owned Convex and fake provider', () => {
    beforeAll(async () => {
        const config = loadRuntimeConfig(process.env);
        botDatabase = await createRuntimeDb(config, { serviceName: 'bot' });
        webDatabase = await createRuntimeDb(config, { serviceName: 'web' });

        const deployment = await upsertDeploymentConfig(botDatabase.db, {
            instanceMode: 'multi',
            ownerIds: [userId],
        });
        if (deployment.isErr()) throw new Error('Could not seed the E2E deployment configuration.');
        const installation = await upsertBotInstallation(botDatabase.db, { guildId });
        if (installation.isErr()) throw new Error('Could not seed the E2E bot installation.');
        const session = await createWebSession(webDatabase.db, {
            expiresAt: new Date(Date.now() + 60 * 60_000),
            fluxerUserId: userId,
            sessionId,
        });
        if (session.isErr()) throw new Error('Could not seed the E2E web session.');

        const encryptedToken = encryptFluxerToken({
            encryptionKey: process.env.FLUXER_TOKEN_ENCRYPTION_KEY,
            token: 'e2e-fake-oauth-access-token',
        });
        if (encryptedToken.isErr()) throw new Error('Could not encrypt the E2E OAuth fixture.');
        const tokenSet = await upsertFluxerOAuthTokenSet(webDatabase.db, {
            accessToken: encryptedToken.value,
            accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
            fluxerUserId: userId,
            scopes: ['identify', 'guilds'],
            tokenType: 'Bearer',
        });
        if (tokenSet.isErr()) throw new Error('Could not seed the E2E OAuth token set.');

        const cookie = createSessionCookie({
            appEnv: 'development',
            sessionId,
            sessionSecret: process.env.SESSION_SECRET,
        });
        if (cookie.isErr()) throw new Error('Could not create the signed E2E session cookie.');
        authenticatedRequest = new Request(`http://127.0.0.1/dashboard/${guildId}`, {
            headers: { Cookie: cookie.value.split(';')[0] ?? '' },
        });

        fakeProvider.listGuilds.mockResolvedValue(
            ok([{ id: guildId, name: 'E2E Guild', ownerId: userId, permissions: '32' }])
        );
        fakeProvider.readUser.mockResolvedValue(ok({ id: userId, username: 'e2e-user', globalName: 'E2E User' }));

        const access = await loadDashboardGuildAccess(authenticatedRequest);
        if (access.isErr() || access.value.type !== 'authorized') {
            throw new Error('The production dashboard authorization path rejected the seeded E2E identity.');
        }
        const authorizedGuild = access.value.guilds.find((guild) => guild.id === guildId);
        if (!authorizedGuild?.botInstalled || !authorizedGuild.canManage) {
            throw new Error('The seeded E2E guild was not authorized with its durable installation.');
        }
    }, 60_000);

    afterAll(async () => {
        await closeWebDb();
        await Promise.all([botDatabase.close(), webDatabase.close()]);
    });

    it('composes authorized enqueue, durable worker success/retry/rejection, and ambiguous settlement', async () => {
        const readPostingStructure = vi.fn();
        const sendMessage = vi.fn();
        fakeProvider.createPlatform.mockReturnValue({
            guildStructure: { read: readPostingStructure },
            messages: { sendDashboard: sendMessage },
        });

        readPostingStructure.mockResolvedValue(ok(postingStructure(0)));
        sendMessage.mockResolvedValue(ok({ channelId: 'channel-1', id: 'message-success' }));
        const success = await enqueueMessage('message-success', 'Success');
        expect(success.type).toBe('operation');
        await expect(runPostingWorker()).resolves.toMatchObject({ status: 'sent' });

        readPostingStructure.mockResolvedValueOnce(ok(postingStructure(5)));
        const rejected = await enqueueMessage('message-rejected', 'Reject');
        expect(rejected.type).toBe('operation');
        await expect(runPostingWorker()).resolves.toMatchObject({
            errorCode: 'channel_not_postable',
            status: 'permanent_failure',
        });

        const retryStart = new Date();
        readPostingStructure.mockResolvedValueOnce(err({ type: 'operation-failed', error: new Error('pre-call') }));
        const retry = await enqueueMessage('message-retry', 'Retry');
        expect(retry.type).toBe('operation');
        await expect(runPostingWorker(retryStart)).resolves.toMatchObject({ status: 'deferred' });
        readPostingStructure.mockResolvedValue(ok(postingStructure(0)));
        sendMessage.mockResolvedValue(ok({ channelId: 'channel-1', id: 'message-retry-success' }));
        await expect(runPostingWorker(new Date(retryStart.getTime() + 3_000))).resolves.toMatchObject({
            status: 'sent',
        });

        sendMessage.mockResolvedValueOnce(err({ type: 'operation-failed', error: new Error('ambiguous') }));
        const ambiguous = await enqueueMessage('message-unknown', 'Unknown');
        if (ambiguous.type !== 'operation') throw new Error('Expected an ambiguous operation.');
        await expect(runPostingWorker()).resolves.toMatchObject({ status: 'unknown' });
        const seen = await resolveDashboardGuildPostingUnknown(authenticatedRequest, {
            guildId,
            operationId: ambiguous.operation.id,
            resolution: 'reported_seen',
        });
        expect(seen).toMatchObject({
            type: 'resolved',
            operation: { resolution: 'reported_seen', resolvedByUserId: userId, status: 'unknown' },
        });

        sendMessage.mockResolvedValueOnce(err({ type: 'operation-failed', error: new Error('ambiguous') }));
        const missing = await enqueueMessage('message-not-seen', 'Not seen');
        if (missing.type !== 'operation') throw new Error('Expected a second ambiguous operation.');
        await expect(runPostingWorker()).resolves.toMatchObject({ status: 'unknown' });
        const notSeen = await resolveDashboardGuildPostingUnknown(authenticatedRequest, {
            guildId,
            operationId: missing.operation.id,
            resolution: 'reported_not_seen',
        });
        expect(notSeen).toMatchObject({
            type: 'resolved',
            operation: { resolution: 'reported_not_seen', resolvedByUserId: userId, status: 'unknown' },
        });

        sendMessage.mockResolvedValueOnce(err({ type: 'operation-failed', error: new Error('ambiguous') }));
        const duplicateRisk = await enqueueMessage('message-duplicate-risk', 'Duplicate risk');
        if (duplicateRisk.type !== 'operation') throw new Error('Expected a third ambiguous operation.');
        await expect(runPostingWorker()).resolves.toMatchObject({ status: 'unknown' });
        const followup = await postDashboardGuildMessage(authenticatedRequest, {
            channelId: 'channel-1',
            content: 'Duplicate risk',
            guildId,
            requestKey: 'message-duplicate-risk-followup',
            retryOfOperationId: duplicateRisk.operation.id,
        });
        if (followup.type !== 'operation') throw new Error('Expected a duplicate-risk follow-up operation.');
        expect(followup.operation).toMatchObject({ retryOfOperationId: duplicateRisk.operation.id, status: 'queued' });
        await expect(runPostingWorker()).resolves.toMatchObject({ status: 'sent' });

        const operations = await listDashboardPostingOperationsByGuild(webDatabase.db, { guildId, limit: 20 });
        expect(operations.isOk()).toBe(true);
        const operationRecords = operations._unsafeUnwrap();
        expect(operationRecords.map(({ status }) => status)).toEqual(
            expect.arrayContaining(['sent', 'permanent_failure', 'unknown'])
        );
        expect(operationRecords.find(({ id }) => id === duplicateRisk.operation.id)).toMatchObject({
            followupOperationId: followup.operation.id,
            resolution: 'duplicate_risk_accepted',
            resolvedByUserId: userId,
        });
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                channelId: 'channel-1',
                message: expect.objectContaining({ allowedMentions: { parse: [] } }),
            })
        );
    }, 60_000);

    it('rejects a stale Blueprint target, then restores, applies, and verifies a fresh approved plan', async () => {
        const desired = blueprintSnapshot('Desired');
        let live = blueprintSnapshot('Original');
        fakeProvider.readWebStructure.mockImplementation(() => Promise.resolve(ok(live)));
        fakeProvider.readBlueprint.mockImplementation(() => Promise.resolve(ok(live)));
        fakeProvider.applyBlueprint.mockImplementation(async (unknownInput: unknown) => {
            const input = unknownInput as FakeBlueprintApplyInput;
            const results: FakeBlueprintActionResult[] = [];
            for (const action of input.actions) {
                if ((await input.beforeAction?.(action)) === false) break;
                if ((await input.beforeMutation?.()) === false) break;
                const result = { id: action.id, status: 'applied' as const };
                results.push(result);
                if ((await input.onActionResult?.(result, input.idMap)) === false) break;
            }
            live = desired;
            return ok({ actions: results, idMap: input.idMap });
        });

        const stalePlan = await createPlan(desired);
        expect(stalePlan.type).toBe('plan-created');
        if (stalePlan.type !== 'plan-created') throw new Error('Expected stale candidate plan.');
        expect((await approvePlan(stalePlan.plan)).type).toBe('approved');
        live = blueprintSnapshot('Changed after review');
        const stalePreflight = await preflightDashboardBlueprintPlan(authenticatedRequest, {
            guildId,
            planId: stalePlan.plan.id,
        });
        expect(stalePreflight.type).toBe('preflight');
        if (stalePreflight.type !== 'preflight') throw new Error('Expected stale preflight report.');
        expect(stalePreflight.report.summary.stale).toBeGreaterThan(0);

        const freshPlan = await createPlan(desired);
        expect(freshPlan.type).toBe('plan-created');
        if (freshPlan.type !== 'plan-created') throw new Error('Expected fresh plan.');
        expect((await approvePlan(freshPlan.plan)).type).toBe('approved');
        const freshPreflight = await preflightDashboardBlueprintPlan(authenticatedRequest, {
            guildId,
            planId: freshPlan.plan.id,
        });
        expect(freshPreflight.type).toBe('preflight');
        if (freshPreflight.type !== 'preflight' || !freshPreflight.preflightDigest) {
            throw new Error('Expected ready preflight.');
        }
        expect(isDashboardBlueprintPreflightReady(freshPreflight.report)).toBe(true);
        const queued = await applyDashboardBlueprintPlan(authenticatedRequest, {
            guildId,
            planId: freshPlan.plan.id,
            planDigest: freshPlan.plan.planDigest,
            preflightDigest: freshPreflight.preflightDigest,
        });
        expect(queued.type).toBe('queued');

        await expect(
            runNextBlueprintRun({
                botToken: 'fake-provider-token',
                database: botDatabase,
                leaseOwner: 'e2e-blueprint-worker',
            })
        ).resolves.toBe('progressed');
        const run = await findLatestBlueprintRunForPlan(botDatabase.db, {
            guildId,
            planId: freshPlan.plan.id,
        });
        expect(run.isOk()).toBe(true);
        expect(run._unsafeUnwrap()).toMatchObject({ status: 'succeeded', verificationStatus: 'matched' });
        expect(fakeProvider.applyBlueprint).toHaveBeenCalledOnce();
    }, 60_000);

    it('persists an ambiguous Blueprint mutation as outcome unknown and never replays it', async () => {
        const desired = blueprintSnapshot('Ambiguous desired');
        const live = blueprintSnapshot('Desired');
        fakeProvider.readWebStructure.mockResolvedValue(ok(live));
        fakeProvider.readBlueprint.mockResolvedValue(ok(live));
        fakeProvider.applyBlueprint.mockClear();
        fakeProvider.applyBlueprint.mockImplementation(async (unknownInput: unknown) => {
            const input = unknownInput as FakeBlueprintApplyInput;
            const action = input.actions[0];
            await input.beforeAction?.(action);
            await input.beforeMutation?.();
            const result: FakeBlueprintActionResult = {
                errorType: 'operation-failed',
                id: action.id,
                mutationOutcome: 'unknown',
                status: 'failed',
            };
            await input.onActionResult?.(result, input.idMap);
            return ok({ actions: [result], idMap: input.idMap });
        });

        const plan = await createPlan(desired);
        if (plan.type !== 'plan-created') throw new Error('Expected ambiguous candidate plan.');
        expect((await approvePlan(plan.plan)).type).toBe('approved');
        const preflight = await preflightDashboardBlueprintPlan(authenticatedRequest, {
            guildId,
            planId: plan.plan.id,
        });
        if (preflight.type !== 'preflight' || !preflight.preflightDigest) {
            throw new Error('Expected ready ambiguous-case preflight.');
        }
        expect(isDashboardBlueprintPreflightReady(preflight.report)).toBe(true);
        expect(
            (
                await applyDashboardBlueprintPlan(authenticatedRequest, {
                    guildId,
                    planId: plan.plan.id,
                    planDigest: plan.plan.planDigest,
                    preflightDigest: preflight.preflightDigest,
                })
            ).type
        ).toBe('queued');

        await expect(
            runNextBlueprintRun({
                botToken: 'fake-provider-token',
                database: botDatabase,
                leaseOwner: 'e2e-blueprint-worker-unknown',
            })
        ).resolves.toBe('progressed');
        const run = await findLatestBlueprintRunForPlan(botDatabase.db, {
            guildId,
            planId: plan.plan.id,
        });
        expect(run.isOk()).toBe(true);
        expect(run._unsafeUnwrap()).toMatchObject({ status: 'outcome_unknown' });

        await expect(
            runNextBlueprintRun({
                botToken: 'fake-provider-token',
                database: botDatabase,
                leaseOwner: 'e2e-blueprint-worker-replay-check',
            })
        ).resolves.toBe('idle');
        expect(fakeProvider.applyBlueprint).toHaveBeenCalledOnce();
    }, 60_000);
});

async function enqueueMessage(requestKey: string, content: string) {
    return postDashboardGuildMessage(authenticatedRequest, {
        channelId: 'channel-1',
        content,
        guildId,
        requestKey,
    });
}

function runPostingWorker(now = new Date()) {
    return runNextDashboardPostingOperation(
        {
            appEnv: 'development',
            client: {} as never,
            db: botDatabase.db,
            guildDefconOverride: 3,
            logger: { warn: vi.fn() },
            mode: { instanceMode: 'multi' },
        },
        { leaseOwner: 'e2e-posting-worker', now }
    );
}

function postingStructure(channelType: number) {
    return {
        categories: [],
        channels: [{ id: 'channel-1', name: 'general', parentId: null, position: 0, type: channelType }],
        guildId,
        guildName: 'E2E Guild',
        roles: [],
    };
}

function blueprintSnapshot(roleName: string) {
    return {
        categories: [],
        channels: [],
        guildId,
        guildName: 'E2E Guild',
        roles: [
            {
                color: 0,
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

function createPlan(desired: ReturnType<typeof blueprintSnapshot>) {
    return createDashboardBlueprintPlan(authenticatedRequest, {
        backupJson: JSON.stringify({ version: 1, ...desired }),
        guildId,
        policy: 'merge',
    });
}

function approvePlan(plan: { id: string; planDigest: string }) {
    return approveDashboardBlueprintPlan(authenticatedRequest, {
        guildId,
        planId: plan.id,
        planDigest: plan.planDigest,
    });
}

type FakeBlueprintAction = { id: string };
type FakeBlueprintActionResult = {
    errorType?: string;
    id: string;
    mutationOutcome?: 'unknown';
    status: 'applied' | 'failed';
};
type FakeBlueprintApplyInput = {
    actions: FakeBlueprintAction[];
    idMap: Record<string, string>;
    beforeAction?: (action: FakeBlueprintAction) => Promise<boolean>;
    beforeMutation?: () => Promise<boolean>;
    onActionResult?: (result: FakeBlueprintActionResult, idMap: Record<string, string>) => Promise<boolean>;
};

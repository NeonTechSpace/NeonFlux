import { err, ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDocumentSize } from 'convex/values';

import { loadRuntimeConfig } from '@neonflux/config';
import { createBlueprintMutationFenceManifest, createBlueprintPreflightEvidenceDigests } from '@neonflux/blueprint';
import type { BlueprintSnapshot } from '@neonflux/blueprint';
import {
    createRuntimeDb,
    createWebSession,
    getBlueprintPlanAuthority,
    listLatestBlueprintRunSummaries,
    listDashboardPostingOperationsByGuild,
    upsertBotInstallation,
    upsertDeploymentConfig,
    upsertFluxerOAuthTokenSet,
} from '@neonflux/db';
import type { RuntimeDbClient } from '@neonflux/db';

import { runNextDashboardPostingOperation } from '../../../bot/src/bot-posting-worker.js';
import { runNextBlueprintRun } from '../../../bot/src/bot-blueprint-run-executor.js';
import { closeWebDb } from '../../src/server/db.server.js';
import { applyDashboardBlueprintPlan } from '../../src/server/dashboard-blueprint-apply.server.js';
import {
    approveDashboardBlueprintPlan,
    createDashboardBlueprintPlan,
} from '../../src/server/dashboard-blueprint-plans.server.js';
import { preflightDashboardBlueprintPlan } from '../../src/server/dashboard-blueprint-preflight.server.js';
import { isDashboardBlueprintPreflightReady } from '../../src/server/dashboard-blueprint-preflight.js';
import { loadDashboardBlueprintRuns } from '../../src/server/dashboard-blueprint-runs.server.js';
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

vi.mock('../../src/server/bot-internal-api-client.server.js', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    readDashboardBotGuildStructure: fakeProvider.readWebStructure,
}));

const enabled = process.env.NEONFLUX_E2E_AUTHENTICATED === 'neonflux-e2e-ephemeral-v1';
const guildId = 'e2e-services-guild-1';
const userId = 'e2e-services-user-1';
const sessionId = 'services0123456789abcdefghijklmnopqrstuvwxy';
let botDatabase: RuntimeDbClient;
let webDatabase: RuntimeDbClient;
let authenticatedRequest: Request;

describe.runIf(enabled)('signed-in services with owned Convex and a fake provider', () => {
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
        if (cookie.isErr()) {
            throw new Error(`Could not create the signed E2E session cookie: ${cookie.error}.`);
        }
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
        expect(sendMessage).toHaveBeenCalledWith({
            channelId: 'channel-1',
            message: { content: 'Success', embeds: [] },
        });
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
        const runs = await listLatestBlueprintRunSummaries(botDatabase.db, {
            guildId,
            planIds: [freshPlan.plan.id],
        });
        expect(runs.isOk()).toBe(true);
        expect(runs._unsafeUnwrap()[freshPlan.plan.id]).toMatchObject({
            status: 'succeeded',
            verificationStatus: 'matched',
        });
        expect(fakeProvider.applyBlueprint).toHaveBeenCalledOnce();
    }, 60_000);

    it.runIf(process.env.NEONFLUX_BLUEPRINT_IO_ACCEPTANCE === 'neonflux-blueprint-io-v1')(
        'passes Blueprint I/O acceptance with twenty plans and a 474-step worker run',
        async () => {
            const { baseline, desired } = blueprintIoAcceptanceSnapshots();
            let live: BlueprintSnapshot = baseline;
            let appliedCreateCount = 0;
            let rateLimitInjected = false;

            fakeProvider.readWebStructure.mockImplementation(async () => ok(live));
            fakeProvider.readBlueprint.mockImplementation(async () => ok(live));
            fakeProvider.applyBlueprint.mockClear();
            fakeProvider.applyBlueprint.mockImplementation(async (unknownInput: unknown) => {
                const input = unknownInput as FakeBlueprintApplyInput;
                const results: FakeBlueprintActionResult[] = [];
                for (const action of input.actions) {
                    if ((await input.beforeAction?.(action)) === false) break;
                    if ((await input.beforeMutation?.()) === false) break;
                    if (!rateLimitInjected && appliedCreateCount === 400) {
                        rateLimitInjected = true;
                        const result: FakeBlueprintActionResult = {
                            errorType: 'rate-limited',
                            id: action.id,
                            retryAfterMs: 0,
                            status: 'failed',
                        };
                        results.push(result);
                        await input.onActionResult?.(result, input.idMap);
                        break;
                    }
                    const createdId =
                        action.actionType === 'create' && action.targetId ? `created-${action.targetId}` : undefined;
                    if (action.targetId && createdId) input.idMap[action.targetId] = createdId;
                    const result: FakeBlueprintActionResult = {
                        ...(createdId ? { createdId } : {}),
                        id: action.id,
                        status: 'applied',
                    };
                    results.push(result);
                    if (createdId) appliedCreateCount += 1;
                    if ((await input.onActionResult?.(result, input.idMap)) === false) break;
                }
                if (rateLimitInjected && appliedCreateCount === 473) {
                    live = {
                        ...desired,
                        channels: desired.channels.map((channel) => {
                            const targetId = input.idMap[channel.id];
                            return targetId ? { ...channel, id: targetId } : channel;
                        }),
                    };
                }
                return ok({ actions: results, idMap: input.idMap });
            });

            const planIds = new Set<string>();
            for (let index = 0; index < 19; index += 1) {
                const summaryPlan = await createPlan({
                    ...baseline,
                    roles: baseline.roles.map((role) => ({ ...role, name: `I/O summary ${String(index)}` })),
                });
                if (summaryPlan.type !== 'plan-created') throw new Error('Expected a unique summary plan.');
                expect(planIds.has(summaryPlan.plan.id)).toBe(false);
                planIds.add(summaryPlan.plan.id);
            }

            const largePlan = await createPlan(desired);
            if (largePlan.type !== 'plan-created') throw new Error('Expected the large I/O acceptance plan.');
            expect(planIds.has(largePlan.plan.id)).toBe(false);
            planIds.add(largePlan.plan.id);
            expect(planIds.size).toBe(20);
            expect(largePlan.plan.planStepCount).toBe(474);
            const authorityResult = await getBlueprintPlanAuthority(botDatabase.db, {
                guildId,
                planId: largePlan.plan.id,
            });
            if (authorityResult.isErr()) throw new Error('Expected the persisted I/O acceptance authority.');
            const { id: _authorityId, createdAt: authorityCreatedAt, ...authorityDocument } = authorityResult.value;
            const authorityBytes = getDocumentSize({
                ...authorityDocument,
                createdAt: authorityCreatedAt.toISOString(),
            });
            expect(authorityBytes).toBeGreaterThanOrEqual(600 * 1024);
            expect(authorityBytes).toBeLessThanOrEqual(690 * 1024);
            expect((await approvePlan(largePlan.plan)).type).toBe('approved');
            const preflight = await preflightDashboardBlueprintPlan(authenticatedRequest, {
                guildId,
                planId: largePlan.plan.id,
            });
            if (preflight.type !== 'preflight' || !preflight.preflightDigest) {
                throw new Error('Expected the large I/O acceptance preflight.');
            }
            expect(isDashboardBlueprintPreflightReady(preflight.report)).toBe(true);
            expect(
                (
                    await applyDashboardBlueprintPlan(authenticatedRequest, {
                        guildId,
                        planId: largePlan.plan.id,
                        planDigest: largePlan.plan.planDigest,
                        preflightDigest: preflight.preflightDigest,
                    })
                ).type
            ).toBe('queued');
            await new Promise((resolve) => setTimeout(resolve, 5));
            const newerPreflight = await preflightDashboardBlueprintPlan(authenticatedRequest, {
                guildId,
                planId: largePlan.plan.id,
            });
            if (newerPreflight.type !== 'preflight' || !newerPreflight.checkedAt) {
                throw new Error('Expected a newer timestamped I/O acceptance preflight.');
            }

            await markBlueprintIoAcceptancePhase('NEONFLUX_BLUEPRINT_IO_WORKER_START_MARKER');
            await expect(
                runNextBlueprintRun({
                    botToken: 'fake-provider-token',
                    database: botDatabase,
                    leaseOwner: 'e2e-blueprint-io-worker-1',
                })
            ).resolves.toBe('progressed');
            await new Promise((resolve) => setTimeout(resolve, 10));
            await expect(
                runNextBlueprintRun({
                    botToken: 'fake-provider-token',
                    database: botDatabase,
                    leaseOwner: 'e2e-blueprint-io-worker-2',
                })
            ).resolves.toBe('progressed');
            expect(fakeProvider.applyBlueprint).toHaveBeenCalledTimes(2);
            expect((fakeProvider.applyBlueprint.mock.calls[0]?.[0] as FakeBlueprintApplyInput).actions).toHaveLength(
                474
            );
            expect((fakeProvider.applyBlueprint.mock.calls[1]?.[0] as FakeBlueprintApplyInput).actions).toHaveLength(
                74
            );
            expect(appliedCreateCount).toBe(473);
            await markBlueprintIoAcceptancePhase('NEONFLUX_BLUEPRINT_IO_WORKER_END_MARKER');

            await markBlueprintIoAcceptancePhase('NEONFLUX_BLUEPRINT_IO_HISTORY_START_MARKER');
            const history = await loadDashboardBlueprintRuns(authenticatedRequest, guildId);
            await markBlueprintIoAcceptancePhase('NEONFLUX_BLUEPRINT_IO_HISTORY_END_MARKER');
            expect(history.type).toBe('runs');
            if (history.type !== 'runs') throw new Error('Expected Blueprint History data.');
            expect(history.plans).toHaveLength(20);
            expect(history.plans[0]?.id).toBe(largePlan.plan.id);
            expect(history.plans[0]?.run?.status).toBe('succeeded');
            const latestPreflight = history.plans[0]?.preflight;
            if (!latestPreflight) throw new Error('Expected the persisted I/O acceptance preflight summary.');
            const mutationFenceManifest = await createBlueprintMutationFenceManifest(baseline);
            const evidenceDigests = await createBlueprintPreflightEvidenceDigests({
                report: newerPreflight.report,
                mutationFenceManifest,
            });
            const preflightEvidenceBytes = getDocumentSize({
                version: 1,
                preflightId: latestPreflight.id,
                planId: largePlan.plan.id,
                report: newerPreflight.report,
                mutationFenceManifest,
                ...evidenceDigests,
                createdAt: newerPreflight.checkedAt,
            });
            expect(preflightEvidenceBytes).toBeGreaterThanOrEqual(140 * 1024);
            expect(preflightEvidenceBytes).toBeLessThanOrEqual(200 * 1024);
        },
        600_000
    );

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
        const runs = await listLatestBlueprintRunSummaries(botDatabase.db, {
            guildId,
            planIds: [plan.plan.id],
        });
        expect(runs.isOk()).toBe(true);
        expect(runs._unsafeUnwrap()[plan.plan.id]).toMatchObject({ status: 'outcome_unknown' });

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

function blueprintSnapshot(roleName: string): BlueprintSnapshot {
    return {
        version: 1,
        botHighestRolePosition: 2,
        categories: [],
        channels: [],
        guildId,
        guildName: 'E2E Guild',
        roles: [
            {
                color: 0,
                hoist: false,
                id: 'role-1',
                hierarchyRank: 0,
                mentionable: false,
                name: roleName,
                permissions: '0',
                position: 1,
            },
        ],
    };
}

function blueprintIoAcceptanceSnapshots(): { baseline: BlueprintSnapshot; desired: BlueprintSnapshot } {
    const baseline: BlueprintSnapshot = {
        ...blueprintSnapshot('I/O baseline'),
        channels: Array.from({ length: 27 }, (_, index) =>
            blueprintIoChannel(`existing-${String(index)}`, index, 2_048, false)
        ),
    };
    return {
        baseline,
        desired: {
            ...baseline,
            channels: [
                ...baseline.channels,
                ...Array.from({ length: 473 }, (_, index) =>
                    blueprintIoChannel(`channel-${String(index)}`, index + baseline.channels.length, 340, true)
                ),
            ],
        },
    };
}

function blueprintIoChannel(
    id: string,
    position: number,
    urlLength: number,
    useMaximumNameLength: boolean
): BlueprintSnapshot['channels'][number] {
    const urlPrefix = 'https://example.invalid/';
    return {
        id,
        name: useMaximumNameLength ? `${id}-`.padEnd(100, 'n') : id,
        parentId: null,
        permissionOverwrites: [],
        position,
        type: 0,
        url: urlPrefix.padEnd(urlLength, 'x'),
    };
}

async function markBlueprintIoAcceptancePhase(
    markerEnvironmentKey:
        | 'NEONFLUX_BLUEPRINT_IO_WORKER_START_MARKER'
        | 'NEONFLUX_BLUEPRINT_IO_WORKER_END_MARKER'
        | 'NEONFLUX_BLUEPRINT_IO_HISTORY_START_MARKER'
        | 'NEONFLUX_BLUEPRINT_IO_HISTORY_END_MARKER'
): Promise<void> {
    const url = process.env.CONVEX_SELF_HOSTED_URL;
    const adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY;
    const marker = process.env[markerEnvironmentKey];
    if (!url || url !== process.env.CONVEX_URL || new URL(url).hostname !== '127.0.0.1' || !adminKey || !marker) {
        throw new Error('Blueprint I/O phase marker is not bound to the owned self-hosted deployment.');
    }
    const response = await fetch(`${url}/api/function`, {
        body: JSON.stringify({
            args: { marker },
            format: 'convex_encoded_json',
            path: 'runtime:blueprintIoAcceptanceMarker',
        }),
        headers: {
            Authorization: `Convex ${adminKey}`,
            'Content-Type': 'application/json',
        },
        method: 'POST',
    });
    const result = (await response.json()) as unknown;
    if (
        !response.ok ||
        typeof result !== 'object' ||
        result === null ||
        !('status' in result) ||
        result.status !== 'success' ||
        !('value' in result) ||
        result.value !== marker
    ) {
        throw new Error('Blueprint I/O phase marker invocation failed.');
    }
}

function createPlan(desired: BlueprintSnapshot) {
    return createDashboardBlueprintPlan(authenticatedRequest, {
        backupJson: JSON.stringify(desired),
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

type FakeBlueprintAction = { actionType?: string; id: string; targetId?: string };
type FakeBlueprintActionResult = {
    createdId?: string;
    errorType?: string;
    id: string;
    mutationOutcome?: 'unknown';
    retryAfterMs?: number;
    status: 'applied' | 'failed';
};
type FakeBlueprintApplyInput = {
    actions: FakeBlueprintAction[];
    idMap: Record<string, string>;
    beforeAction?: (action: FakeBlueprintAction) => Promise<boolean>;
    beforeMutation?: () => Promise<boolean>;
    onActionResult?: (result: FakeBlueprintActionResult, idMap: Record<string, string>) => Promise<boolean>;
};

import { describe, expect, it } from 'vitest';

import {
    decideFluxerOAuthRefreshLeaseClaim,
    isActiveSession,
    matchesFluxerOAuthRefreshLease,
    normalizeCredentialGeneration,
    normalizeEncryptedTokenPayload,
    normalizeFutureTimestamp,
    normalizeOptionalEncryptedTokenPayload,
    normalizeRequiredString,
    normalizeScopes,
    normalizeTimestamp,
} from './auth_store_model.js';

describe('Convex auth store model helpers', () => {
    it('normalizes migration-era credential generations', () => {
        expect(normalizeCredentialGeneration(undefined)).toEqual({ ok: true, value: 0 });
        expect(normalizeCredentialGeneration(4)).toEqual({ ok: true, value: 4 });
        expect(normalizeCredentialGeneration(-1)).toEqual({ error: 'invalid-generation', ok: false });
        expect(normalizeCredentialGeneration(1.5)).toEqual({ error: 'invalid-generation', ok: false });
    });

    it('claims refresh coordination only for the current generation without an active lease or cooldown', () => {
        const nowMs = Date.parse('2026-07-10T08:00:00.000Z');
        const state = {
            credentialGeneration: 3,
            refreshLeaseExpiresAt: '2026-07-10T08:00:10.000Z',
            refreshLeaseGeneration: 3,
            refreshLeaseId: 'lease-1',
        };

        expect(decideFluxerOAuthRefreshLeaseClaim(state, { expectedGeneration: 2, nowMs })).toEqual({
            status: 'stale',
        });
        expect(decideFluxerOAuthRefreshLeaseClaim(state, { expectedGeneration: 3, nowMs })).toEqual({
            retryAt: '2026-07-10T08:00:10.000Z',
            status: 'busy',
        });
        expect(
            decideFluxerOAuthRefreshLeaseClaim(
                {
                    ...state,
                    refreshLeaseExpiresAt: '2026-07-10T07:59:59.000Z',
                },
                { expectedGeneration: 3, nowMs }
            )
        ).toEqual({ status: 'claimable' });
        expect(
            decideFluxerOAuthRefreshLeaseClaim(
                {
                    credentialGeneration: 3,
                    refreshRetryAfter: '2026-07-10T08:00:05.000Z',
                },
                { expectedGeneration: 3, nowMs }
            )
        ).toEqual({
            retryAt: '2026-07-10T08:00:05.000Z',
            status: 'cooldown',
        });
        expect(decideFluxerOAuthRefreshLeaseClaim(null, { expectedGeneration: 0, nowMs })).toEqual({
            status: 'missing',
        });
    });

    it('matches refresh completion and terminal deletion to the exact lease generation', () => {
        const state = {
            credentialGeneration: 3,
            refreshLeaseGeneration: 3,
            refreshLeaseId: 'lease-1',
        };

        expect(matchesFluxerOAuthRefreshLease(state, { expectedGeneration: 3, leaseId: 'lease-1' })).toBe(true);
        expect(matchesFluxerOAuthRefreshLease(state, { expectedGeneration: 2, leaseId: 'lease-1' })).toBe(false);
        expect(matchesFluxerOAuthRefreshLease(state, { expectedGeneration: 3, leaseId: 'lease-2' })).toBe(false);
        expect(
            matchesFluxerOAuthRefreshLease(
                { ...state, invalidatedAt: '2026-07-10T08:00:00.000Z' },
                { expectedGeneration: 3, leaseId: 'lease-1' }
            )
        ).toBe(false);
    });

    it('normalizes required strings', () => {
        expect(normalizeRequiredString(' user-1 ', 'missing-fluxer-user-id')).toEqual({ ok: true, value: 'user-1' });
        expect(normalizeRequiredString('   ', 'missing-session-id')).toEqual({
            error: 'missing-session-id',
            ok: false,
        });
    });

    it('requires future session expiry timestamps', () => {
        expect(normalizeFutureTimestamp('2026-07-03T09:00:00.000Z', Date.parse('2026-07-03T08:00:00.000Z'))).toEqual({
            ok: true,
            value: {
                isoString: '2026-07-03T09:00:00.000Z',
                timeMs: Date.parse('2026-07-03T09:00:00.000Z'),
            },
        });
        expect(normalizeFutureTimestamp('2026-07-03T07:59:59.000Z', Date.parse('2026-07-03T08:00:00.000Z'))).toEqual({
            error: 'invalid-expiry',
            ok: false,
        });
    });

    it('normalizes arbitrary valid timestamps', () => {
        expect(normalizeTimestamp('2026-07-03T08:00:00.000+00:00')).toEqual({
            ok: true,
            value: '2026-07-03T08:00:00.000Z',
        });
        expect(normalizeTimestamp('not-a-date')).toEqual({ error: 'invalid-expiry', ok: false });
    });

    it('normalizes encrypted OAuth token payloads without decrypting them', () => {
        expect(
            normalizeEncryptedTokenPayload(
                {
                    authTag: ' tag ',
                    ciphertext: ' ciphertext ',
                    iv: ' iv ',
                    version: ' v1 ',
                },
                'invalid-access-token'
            )
        ).toEqual({
            ok: true,
            value: {
                authTag: 'tag',
                ciphertext: 'ciphertext',
                iv: 'iv',
                version: 'v1',
            },
        });
        expect(
            normalizeEncryptedTokenPayload(
                {
                    authTag: '',
                    ciphertext: 'ciphertext',
                    iv: 'iv',
                    version: 'v1',
                },
                'invalid-access-token'
            )
        ).toEqual({ error: 'invalid-access-token', ok: false });
    });

    it('normalizes optional refresh tokens', () => {
        expect(normalizeOptionalEncryptedTokenPayload(null)).toEqual({ ok: true, value: undefined });
    });

    it('requires at least one normalized scope', () => {
        expect(normalizeScopes([' identify ', '', 'guilds'])).toEqual({ ok: true, value: ['identify', 'guilds'] });
        expect(normalizeScopes(['  '])).toEqual({ error: 'missing-scopes', ok: false });
    });

    it('checks whether a session is active', () => {
        const nowMs = Date.parse('2026-07-03T08:00:00.000Z');

        expect(isActiveSession({ expiresAt: '2026-07-03T08:05:00.000Z' }, nowMs)).toBe(true);
        expect(
            isActiveSession({ expiresAt: '2026-07-03T08:05:00.000Z', revokedAt: '2026-07-03T08:01:00.000Z' }, nowMs)
        ).toBe(false);
        expect(isActiveSession({ expiresAt: '2026-07-03T07:59:59.000Z' }, nowMs)).toBe(false);
    });
});

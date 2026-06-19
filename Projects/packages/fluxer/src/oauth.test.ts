import { describe, expect, it } from 'vitest';

import { buildFluxerAuthorizeUrl } from './oauth.js';

describe('buildFluxerAuthorizeUrl', () => {
    it('builds the dev login URL', () => {
        expect(
            buildFluxerAuthorizeUrl({
                appId: '1517169145576165376',
                redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
                scopes: ['identify', 'guilds'],
            })
        ).toBe(
            'https://web.canary.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=identify+guilds&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Ffluxer%2Fcallback&response_type=code'
        );
    });

    it('encodes redirect URLs', () => {
        expect(
            buildFluxerAuthorizeUrl({
                appId: 'app-id',
                redirectUrl: 'http://localhost:3000/auth/fluxer/callback?next=/dashboard guilds',
                scopes: ['identify'],
            })
        ).toContain(
            'redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Ffluxer%2Fcallback%3Fnext%3D%2Fdashboard+guilds'
        );
    });

    it('preserves scope order', () => {
        expect(
            buildFluxerAuthorizeUrl({
                appId: 'app-id',
                redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
                scopes: ['guilds', 'identify', 'bot'],
            })
        ).toContain('scope=guilds+identify+bot');
    });

    it('throws for empty app id', () => {
        expect(() =>
            buildFluxerAuthorizeUrl({
                appId: ' ',
                redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
                scopes: ['identify'],
            })
        ).toThrow('appId is required');
    });

    it('throws for empty redirect URL', () => {
        expect(() =>
            buildFluxerAuthorizeUrl({
                appId: 'app-id',
                redirectUrl: ' ',
                scopes: ['identify'],
            })
        ).toThrow('redirectUrl is required');
    });

    it('throws for empty scopes', () => {
        expect(() =>
            buildFluxerAuthorizeUrl({
                appId: 'app-id',
                redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
                scopes: [],
            })
        ).toThrow('scopes is required');
    });
});

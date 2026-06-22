import { describe, expect, it } from 'vitest';

import { buildPublicWebUrl } from './public-url.js';

describe('buildPublicWebUrl', () => {
    it('builds an app URL from the public origin and path', () => {
        const result = buildPublicWebUrl({
            publicWebUrl: 'https://neonflux.example',
            path: '/dashboard',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toBe('https://neonflux.example/dashboard');
    });

    it('normalizes a trailing slash on the public origin', () => {
        const result = buildPublicWebUrl({
            publicWebUrl: ' https://neonflux.example/ ',
            path: '/dashboard',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toBe('https://neonflux.example/dashboard');
    });

    it('encodes record search params and skips nullish params', () => {
        const result = buildPublicWebUrl({
            publicWebUrl: 'https://neonflux.example',
            path: '/profile-builder',
            searchParams: {
                guildId: 'guild 1',
                edit: true,
                count: 2,
                empty: null,
                missing: undefined,
            },
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toBe(
            'https://neonflux.example/profile-builder?guildId=guild+1&edit=true&count=2'
        );
    });

    it('preserves URLSearchParams entries and repeated keys', () => {
        const searchParams = new URLSearchParams();

        searchParams.append('field', 'first');
        searchParams.append('field', 'second');

        const result = buildPublicWebUrl({
            publicWebUrl: 'https://neonflux.example',
            path: '/profile-builder',
            searchParams,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toBe('https://neonflux.example/profile-builder?field=first&field=second');
    });

    it('returns missing-public-web-url for blank origins', () => {
        const result = buildPublicWebUrl({
            publicWebUrl: '   ',
            path: '/dashboard',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-public-web-url');
    });

    it.each([
        'neonflux.example',
        'ftp://neonflux.example',
        'https://neonflux.example/docs',
        'https://neonflux.example?next=/dashboard',
        'https://neonflux.example#dashboard',
        'https://user:pass@neonflux.example',
    ])('returns invalid-public-web-url for %s', (publicWebUrl) => {
        const result = buildPublicWebUrl({
            publicWebUrl,
            path: '/dashboard',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-public-web-url');
    });

    it.each(['', 'dashboard', '//evil.example/dashboard', 'https://evil.example/dashboard'])(
        'returns invalid-path for %s',
        (path) => {
            const result = buildPublicWebUrl({
                publicWebUrl: 'https://neonflux.example',
                path,
            });

            expect(result.isErr()).toBe(true);
            expect(result._unsafeUnwrapErr()).toBe('invalid-path');
        }
    );
});

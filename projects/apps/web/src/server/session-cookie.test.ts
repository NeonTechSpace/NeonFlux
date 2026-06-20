import { describe, expect, it } from 'vitest';

import {
    createClearSessionCookie,
    createSessionCookie,
    createSessionId,
    readSessionCookie,
    SESSION_COOKIE_NAME,
} from './session-cookie.js';

const sessionSecret = 'test-session-secret';
const validSessionId = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const otherValidSessionId = '9876543210abcdefghijklmnopqrstuvwxyzABCDEFG';

describe('createSessionId', () => {
    it('generates nonempty unique URL and cookie safe ids', () => {
        const firstSessionId = createSessionId();
        const secondSessionId = createSessionId();

        expect(firstSessionId).toHaveLength(43);
        expect(secondSessionId).toHaveLength(43);
        expect(firstSessionId).toMatch(/^[\w-]+$/);
        expect(secondSessionId).toMatch(/^[\w-]+$/);
        expect(firstSessionId).not.toBe(secondSessionId);
    });
});

describe('createSessionCookie', () => {
    it('creates a development session cookie without Secure', () => {
        const cookie = unwrapSessionCookie(
            createSessionCookie({
                sessionId: validSessionId,
                sessionSecret,
                appEnv: 'development',
            })
        );

        expect(cookie).toMatch(
            new RegExp(
                `^${SESSION_COOKIE_NAME}=${validSessionId}\\.[A-Za-z0-9_-]+; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800$`
            )
        );
        expect(cookie).not.toContain('Secure');
    });

    it('creates a production session cookie with Secure', () => {
        const cookie = unwrapSessionCookie(
            createSessionCookie({
                sessionId: validSessionId,
                sessionSecret,
                appEnv: 'production',
            })
        );

        expect(cookie).toMatch(
            new RegExp(
                `^${SESSION_COOKIE_NAME}=${validSessionId}\\.[A-Za-z0-9_-]+; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800; Secure$`
            )
        );
    });

    it('fails when the session secret is missing', () => {
        const result = createSessionCookie({
            sessionId: validSessionId,
            sessionSecret: undefined,
            appEnv: 'development',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-secret');
    });

    it('fails when the session id does not match the generated shape', () => {
        const result = createSessionCookie({
            sessionId: 'session-id',
            sessionSecret,
            appEnv: 'development',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-cookie');
    });
});

describe('readSessionCookie', () => {
    it('reads a valid signed session cookie', () => {
        const cookie = createValidSessionCookie(validSessionId);

        const result = readSessionCookie({
            request: createSessionRequest(cookie),
            sessionSecret,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({ sessionId: validSessionId });
    });

    it('fails when the session cookie is missing', () => {
        const result = readSessionCookie({
            request: createSessionRequest('other=value'),
            sessionSecret,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-cookie');
    });

    it('fails when the session cookie is malformed', () => {
        const result = readSessionCookie({
            request: createSessionRequest(`${SESSION_COOKIE_NAME}=missing-signature`),
            sessionSecret,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-cookie');
    });

    it('fails when the session cookie is empty', () => {
        const result = readSessionCookie({
            request: createSessionRequest(`${SESSION_COOKIE_NAME}=`),
            sessionSecret,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-cookie');
    });

    it('fails when the session cookie value cannot be decoded', () => {
        const result = readSessionCookie({
            request: createSessionRequest(`${SESSION_COOKIE_NAME}=%E0%A4%A`),
            sessionSecret,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-cookie');
    });

    it('fails when the session id is tampered with', () => {
        const cookie = createValidSessionCookie(validSessionId);
        const tamperedCookie = cookie.replace(
            `${SESSION_COOKIE_NAME}=${validSessionId}.`,
            `${SESSION_COOKIE_NAME}=${otherValidSessionId}.`
        );

        const result = readSessionCookie({
            request: createSessionRequest(tamperedCookie),
            sessionSecret,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-signature');
    });

    it('fails when the session signature is tampered with', () => {
        const cookie = createValidSessionCookie(validSessionId);
        const tamperedCookie = cookie.replace(/\.[A-Za-z0-9_-]+;/, '.tampered;');

        const result = readSessionCookie({
            request: createSessionRequest(tamperedCookie),
            sessionSecret,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-signature');
    });

    it('fails when the session secret is missing', () => {
        const cookie = createValidSessionCookie(validSessionId);

        const result = readSessionCookie({
            request: createSessionRequest(cookie),
            sessionSecret: undefined,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-secret');
    });
});

describe('createClearSessionCookie', () => {
    it('creates a development clear cookie without Secure', () => {
        expect(createClearSessionCookie('development')).toBe(
            `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
        );
    });

    it('creates a production clear cookie with Secure', () => {
        expect(createClearSessionCookie('production')).toBe(
            `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`
        );
    });
});

function createValidSessionCookie(sessionId: string): string {
    return unwrapSessionCookie(
        createSessionCookie({
            sessionId,
            sessionSecret,
            appEnv: 'development',
        })
    );
}

function createSessionRequest(cookie: string): Request {
    return new Request('http://localhost:3000/dashboard', {
        headers: {
            Cookie: cookie,
        },
    });
}

function unwrapSessionCookie(result: ReturnType<typeof createSessionCookie>): string {
    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

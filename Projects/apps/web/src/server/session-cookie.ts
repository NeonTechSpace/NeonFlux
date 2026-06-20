import '@tanstack/react-start/server-only';

import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { AppEnv } from '@neonflux/config';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export const SESSION_COOKIE_NAME = 'neonflux_session';

const sessionIdByteLength = 32;
const sessionCookiePath = '/';
export const SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const sessionIdPattern = /^[A-Za-z0-9_-]{43}$/;

export type SessionCookieError = 'missing-cookie' | 'invalid-cookie' | 'invalid-signature' | 'missing-secret';

export function createSessionId(): string {
    return randomBytes(sessionIdByteLength).toString('base64url');
}

export function createSessionCookie(input: {
    sessionId: string;
    sessionSecret: string | undefined;
    appEnv: AppEnv;
}): Result<string, SessionCookieError> {
    if (!hasSessionSecret(input.sessionSecret)) {
        return err('missing-secret');
    }

    if (!isValidSessionId(input.sessionId)) {
        return err('invalid-cookie');
    }

    const signature = signSessionId(input.sessionId, input.sessionSecret);
    const value = `${input.sessionId}.${signature}`;

    return ok(createSessionCookieHeader(value, input.appEnv, SESSION_COOKIE_MAX_AGE_SECONDS));
}

export function readSessionCookie(input: {
    request: Request;
    sessionSecret: string | undefined;
}): Result<{ sessionId: string }, SessionCookieError> {
    if (!hasSessionSecret(input.sessionSecret)) {
        return err('missing-secret');
    }

    const rawCookieValue = readRawSessionCookieValue(input.request);

    if (rawCookieValue === undefined) {
        return err('missing-cookie');
    }

    let cookieValue: string;

    try {
        cookieValue = decodeURIComponent(rawCookieValue);
    } catch {
        return err('invalid-cookie');
    }

    const cookieParts = cookieValue.split('.');

    if (cookieParts.length !== 2) {
        return err('invalid-cookie');
    }

    const [sessionId, signature] = cookieParts;

    if (!isValidSessionId(sessionId) || signature.length === 0) {
        return err('invalid-cookie');
    }

    const expectedSignature = signSessionId(sessionId, input.sessionSecret);

    if (!signaturesMatch(signature, expectedSignature)) {
        return err('invalid-signature');
    }

    return ok({ sessionId });
}

export function createClearSessionCookie(appEnv: AppEnv): string {
    return createSessionCookieHeader('', appEnv, 0);
}

function hasSessionSecret(sessionSecret: string | undefined): sessionSecret is string {
    return sessionSecret !== undefined && sessionSecret.trim().length > 0;
}

function isValidSessionId(sessionId: string | undefined): sessionId is string {
    return sessionId !== undefined && sessionId.length > 0 && sessionIdPattern.test(sessionId);
}

function signSessionId(sessionId: string, sessionSecret: string): string {
    return createHmac('sha256', sessionSecret).update(sessionId).digest('base64url');
}

function signaturesMatch(actual: string, expected: string): boolean {
    const actualSignature = Buffer.from(actual);
    const expectedSignature = Buffer.from(expected);

    return actualSignature.length === expectedSignature.length && timingSafeEqual(actualSignature, expectedSignature);
}

function readRawSessionCookieValue(request: Request): string | undefined {
    const cookieHeader = request.headers.get('Cookie');

    if (!cookieHeader) {
        return undefined;
    }

    for (const cookie of cookieHeader.split(';')) {
        const [rawName, ...rawValueParts] = cookie.trim().split('=');

        if (rawName !== SESSION_COOKIE_NAME) {
            continue;
        }

        const rawValue = rawValueParts.join('=');

        return rawValue;
    }

    return undefined;
}

function createSessionCookieHeader(value: string, appEnv: AppEnv, maxAgeSeconds: number): string {
    const cookie = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
        'HttpOnly',
        'SameSite=Lax',
        `Path=${sessionCookiePath}`,
        `Max-Age=${maxAgeSeconds}`,
    ];

    if (appEnv === 'production') {
        cookie.push('Secure');
    }

    return cookie.join('; ');
}

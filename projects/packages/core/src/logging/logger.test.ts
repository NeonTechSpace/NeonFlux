import { beforeEach, describe, expect, it, vi } from 'vitest';

const evlogMock = vi.hoisted(() => {
    return {
        initLogger: vi.fn(),
        log: {
            debug: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
        },
    };
});

vi.mock('evlog', () => evlogMock);

import { createLogger } from './logger.js';

describe('createLogger', () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('keeps production logs machine-parseable and uncolored', () => {
        const logger = createLogger({ logLevel: 'info', nodeEnv: 'production' });

        logger.error('bot.message_created_route_failed', {
            error: 'database-error',
            guildId: 'guild-1',
            statusCode: 500,
        });

        expect(evlogMock.initLogger).toHaveBeenCalledWith({
            minLevel: 'info',
            pretty: false,
        });
        expect(evlogMock.log.error).toHaveBeenCalledWith({
            event: 'bot.message_created_route_failed',
            error: 'database-error',
            guildId: 'guild-1',
            statusCode: 500,
        });
    });

    it('respects NO_COLOR in development', () => {
        vi.stubEnv('NO_COLOR', '1');
        const logger = createLogger({ logLevel: 'info', nodeEnv: 'development' });

        logger.warn('bot.feature_route', {
            reason: 'defcon-denied',
            status: 'ignored',
        });

        expect(evlogMock.log.warn).toHaveBeenCalledWith({
            event: 'bot.feature_route',
            reason: 'defcon-denied',
            status: 'ignored',
        });
    });

    it('redacts nested and case-variant sensitive fields without hiding useful diagnostics', () => {
        const logger = createLogger({ logLevel: 'info', nodeEnv: 'production' });

        logger.error('web.request_failed', {
            authorization: 'Bearer secret',
            guildId: 'guild-1',
            nested: {
                Access_Token: 'access-secret',
                clientSecret: 'client-secret',
                cookieJar: 'cookie-secret',
                password: 'password-secret',
                privateKey: 'private-key-secret',
                rawPayload: { content: 'private' },
                statusCode: 503,
            },
            tokenCount: 4,
            tokenizer: 'safe-diagnostic',
        });

        expect(evlogMock.log.error).toHaveBeenCalledWith({
            event: 'web.request_failed',
            authorization: '[REDACTED]',
            guildId: 'guild-1',
            nested: {
                Access_Token: '[REDACTED]',
                clientSecret: '[REDACTED]',
                cookieJar: 'cookie-secret',
                password: '[REDACTED]',
                privateKey: '[REDACTED]',
                rawPayload: '[REDACTED]',
                statusCode: 503,
            },
            tokenCount: 4,
            tokenizer: 'safe-diagnostic',
        });
    });

    it('bounds cyclic, deep, large, and unsupported context values without throwing', () => {
        const logger = createLogger({ logLevel: 'info', nodeEnv: 'production' });
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        let deep: Record<string, unknown> = { value: 'end' };
        for (let index = 0; index < 10; index += 1) deep = { next: deep };

        expect(() =>
            logger.warn('worker.context_bounded', {
                cyclic,
                deep,
                list: Array.from({ length: 60 }, (_, index) => index),
                largeText: 'x'.repeat(3_000),
                bigint: 10n,
            })
        ).not.toThrow();

        const logged = vi.mocked(evlogMock.log.warn).mock.calls.at(-1)?.[0] as Record<string, unknown>;
        expect(logged.cyclic).toEqual({ self: '[Circular]' });
        expect(JSON.stringify(logged.deep)).toContain('[Maximum depth]');
        expect(logged.list).toHaveLength(51);
        expect(String(logged.largeText)).toContain('chars omitted');
        expect(logged.bigint).toBe('10n');
        expect(JSON.stringify(logged).length).toBeLessThan(25_000);
    });

    it('preserves bounded error identity and operational status fields', () => {
        const logger = createLogger({ logLevel: 'info', nodeEnv: 'production' });
        const error = Object.assign(new Error('provider unavailable'), {
            code: 'UPSTREAM_UNAVAILABLE',
            statusCode: 503,
        });

        logger.error('provider.request_failed', { error });

        expect(evlogMock.log.error).toHaveBeenCalledWith({
            event: 'provider.request_failed',
            error: {
                code: 'UPSTREAM_UNAVAILABLE',
                message: 'provider unavailable',
                name: 'Error',
                statusCode: 503,
            },
        });
    });
});

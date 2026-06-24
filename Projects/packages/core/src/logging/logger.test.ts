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

    it('colors scan-critical values in development pretty logs', () => {
        const logger = createLogger({ logLevel: 'debug', nodeEnv: 'development' });

        logger.info('bot.feature_route', {
            action: 'command.ping',
            guildDefconOverride: 'auto',
            guildId: 'guild-1',
            reason: 'bot-not-mentioned',
            status: 'handled',
        });

        expect(evlogMock.initLogger).toHaveBeenCalledWith({
            minLevel: 'debug',
            pretty: true,
        });
        expect(evlogMock.log.info).toHaveBeenCalledWith({
            event: '\u001B[36mbot.feature_route\u001B[0m',
            action: '\u001B[36mcommand.ping\u001B[0m',
            guildDefconOverride: '\u001B[35mauto\u001B[0m',
            guildId: '\u001B[34mguild-1\u001B[0m',
            reason: '\u001B[33mbot-not-mentioned\u001B[0m',
            status: '\u001B[32mhandled\u001B[0m',
        });
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
});

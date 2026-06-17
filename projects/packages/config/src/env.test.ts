import { describe, expect, it } from 'vitest';

import { loadConfig } from './env.js';

describe('loadConfig', () => {
    it('fails when single mode does not include SINGLE_GUILD_ID', () => {
        expect(() => loadConfig({ INSTANCE_MODE: 'single' })).toThrow('SINGLE_GUILD_ID is required');
    });

    it('loads single mode with SINGLE_GUILD_ID', () => {
        const config = loadConfig({
            INSTANCE_MODE: 'single',
            SINGLE_GUILD_ID: '123',
        });

        expect(config).toMatchObject({
            instanceMode: 'single',
            singleGuildId: '123',
        });
    });

    it('loads multi mode without SINGLE_GUILD_ID', () => {
        const config = loadConfig({
            INSTANCE_MODE: 'multi',
        });

        expect(config).toMatchObject({
            instanceMode: 'multi',
        });
        expect('singleGuildId' in config).toBe(false);
    });

    it('rejects staging because the project only has dev and prod bots', () => {
        expect(() => loadConfig({ APP_ENV: 'staging' })).toThrow('Invalid environment');
    });

    it('requires production secrets', () => {
        expect(() =>
            loadConfig({
                APP_ENV: 'production',
                INSTANCE_MODE: 'multi',
            })
        ).toThrow('DATABASE_URL is required');
    });
});

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
            autoMigrate: true,
            instanceMode: 'multi',
        });
        expect('singleGuildId' in config).toBe(false);
    });

    it('defaults AUTO_MIGRATE to true', () => {
        expect(loadConfig({}).autoMigrate).toBe(true);
    });

    it('loads AUTO_MIGRATE=false', () => {
        expect(loadConfig({ AUTO_MIGRATE: 'false' }).autoMigrate).toBe(false);
    });

    it('rejects invalid AUTO_MIGRATE values', () => {
        expect(() => loadConfig({ AUTO_MIGRATE: 'yes' })).toThrow('Invalid environment');
    });

    it('rejects staging because the project only has dev and prod bots', () => {
        expect(() => loadConfig({ APP_ENV: 'staging' })).toThrow('Invalid environment');
    });

    it('requires production database url', () => {
        expect(() =>
            loadConfig({
                APP_ENV: 'production',
                INSTANCE_MODE: 'multi',
            })
        ).toThrow('DATABASE_URL is required');
    });

    it('does not require service-specific secrets in the generic config loader', () => {
        expect(() =>
            loadConfig({
                APP_ENV: 'production',
                DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/neonflux_test',
                INSTANCE_MODE: 'multi',
            })
        ).not.toThrow();
    });
});

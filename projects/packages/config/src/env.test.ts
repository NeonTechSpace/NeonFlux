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

    it('loads the optional Fluxer token encryption key', () => {
        const config = loadConfig({
            FLUXER_TOKEN_ENCRYPTION_KEY: ' encryption-key ',
        });

        expect(config.fluxerTokenEncryptionKey).toBe('encryption-key');
    });

    it('loads and normalizes the optional public web origin', () => {
        const config = loadConfig({
            PUBLIC_WEB_URL: ' https://neonflux.example/ ',
        });

        expect(config.publicWebUrl).toBe('https://neonflux.example');
    });

    it('omits a blank public web origin', () => {
        const config = loadConfig({
            PUBLIC_WEB_URL: '   ',
        });

        expect(config.publicWebUrl).toBeUndefined();
    });

    it('rejects public web URLs with a path, query, hash, or credentials', () => {
        expect(() => loadConfig({ PUBLIC_WEB_URL: 'https://neonflux.example/docs' })).toThrow(
            'PUBLIC_WEB_URL must be an origin without path, query, hash, or credentials'
        );
        expect(() => loadConfig({ PUBLIC_WEB_URL: 'https://neonflux.example?x=1' })).toThrow(
            'PUBLIC_WEB_URL must be an origin without path, query, hash, or credentials'
        );
        expect(() => loadConfig({ PUBLIC_WEB_URL: 'https://neonflux.example#docs' })).toThrow(
            'PUBLIC_WEB_URL must be an origin without path, query, hash, or credentials'
        );
        expect(() => loadConfig({ PUBLIC_WEB_URL: 'https://user:pass@neonflux.example' })).toThrow(
            'PUBLIC_WEB_URL must be an origin without path, query, hash, or credentials'
        );
    });

    it('rejects non-http public web URLs', () => {
        expect(() => loadConfig({ PUBLIC_WEB_URL: 'ftp://neonflux.example' })).toThrow(
            'PUBLIC_WEB_URL must be a valid HTTP or HTTPS origin'
        );
    });

    it('rejects malformed public web URLs', () => {
        expect(() => loadConfig({ PUBLIC_WEB_URL: 'neonflux.example' })).toThrow(
            'PUBLIC_WEB_URL must be a valid HTTP or HTTPS origin'
        );
    });

    it('defaults guild DEFCON override to auto', () => {
        expect(loadConfig({}).guildDefconOverride).toBe('auto');
    });

    it('loads numeric guild DEFCON overrides', () => {
        expect(loadConfig({ GUILD_DEFCON_OVERRIDE: '1' }).guildDefconOverride).toBe(1);
        expect(loadConfig({ GUILD_DEFCON_OVERRIDE: '2' }).guildDefconOverride).toBe(2);
        expect(loadConfig({ GUILD_DEFCON_OVERRIDE: '3' }).guildDefconOverride).toBe(3);
    });

    it('loads explicit auto guild DEFCON override', () => {
        expect(loadConfig({ GUILD_DEFCON_OVERRIDE: 'auto' }).guildDefconOverride).toBe('auto');
    });

    it('rejects invalid guild DEFCON overrides', () => {
        expect(() => loadConfig({ GUILD_DEFCON_OVERRIDE: '4' })).toThrow('Invalid environment');
        expect(() => loadConfig({ GUILD_DEFCON_OVERRIDE: 'locked' })).toThrow('Invalid environment');
    });
});

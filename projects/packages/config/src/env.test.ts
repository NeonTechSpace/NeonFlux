import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadBotConfig, loadRuntimeConfig, loadWebConfig } from './env.js';

const originalCwd = process.cwd();
const originalFluxerBotInviteUrl = process.env.FLUXER_BOT_INVITE_URL;
const originalFluxerAppId = process.env.FLUXER_APP_ID;
const tempEnvDirs: string[] = [];

afterEach(() => {
    process.chdir(originalCwd);
    restoreProcessEnvValue('FLUXER_BOT_INVITE_URL', originalFluxerBotInviteUrl);
    restoreProcessEnvValue('FLUXER_APP_ID', originalFluxerAppId);

    for (const dir of tempEnvDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('loadBotConfig', () => {
    it('fails when single mode does not include SINGLE_GUILD_ID', () => {
        expect(() => loadBotConfig({ INSTANCE_MODE: 'single' })).toThrow('SINGLE_GUILD_ID is required');
    });

    it('loads single mode with SINGLE_GUILD_ID', () => {
        const config = loadBotConfig({
            INSTANCE_MODE: 'single',
            SINGLE_GUILD_ID: '123',
        });

        expect(config).toMatchObject({
            instanceMode: 'single',
            singleGuildId: '123',
        });
    });

    it('loads multi mode without SINGLE_GUILD_ID', () => {
        const config = loadBotConfig({
            INSTANCE_MODE: 'multi',
        });

        expect(config).toMatchObject({
            autoMigrate: true,
            instanceMode: 'multi',
        });
        expect('singleGuildId' in config).toBe(false);
    });

    it('loads and normalizes the optional public web origin', () => {
        const config = loadBotConfig({
            PUBLIC_WEB_URL: ' https://neonflux.example/ ',
        });

        expect(config.publicWebUrl).toBe('https://neonflux.example');
    });

    it('omits a blank public web origin', () => {
        const config = loadBotConfig({
            PUBLIC_WEB_URL: '   ',
        });

        expect(config.publicWebUrl).toBeUndefined();
    });

    it('loads optional bot custom status text', () => {
        const config = loadBotConfig({
            FLUXER_BOT_CUSTOM_STATUS: '  Testing NeonFlux  ',
        });

        expect(config.fluxerBotCustomStatusText).toBe('Testing NeonFlux');
    });

    it('omits a blank bot custom status text', () => {
        const config = loadBotConfig({
            FLUXER_BOT_CUSTOM_STATUS: '   ',
        });

        expect(config.fluxerBotCustomStatusText).toBeUndefined();
    });

    it('rejects public web URLs with a path, query, hash, or credentials', () => {
        expect(() => loadBotConfig({ PUBLIC_WEB_URL: 'https://neonflux.example/docs' })).toThrow(
            'PUBLIC_WEB_URL must be an origin without path, query, hash, or credentials'
        );
        expect(() => loadBotConfig({ PUBLIC_WEB_URL: 'https://neonflux.example?x=1' })).toThrow(
            'PUBLIC_WEB_URL must be an origin without path, query, hash, or credentials'
        );
        expect(() => loadBotConfig({ PUBLIC_WEB_URL: 'https://neonflux.example#docs' })).toThrow(
            'PUBLIC_WEB_URL must be an origin without path, query, hash, or credentials'
        );
        expect(() => loadBotConfig({ PUBLIC_WEB_URL: 'https://user:pass@neonflux.example' })).toThrow(
            'PUBLIC_WEB_URL must be an origin without path, query, hash, or credentials'
        );
    });

    it('rejects non-http public web URLs', () => {
        expect(() => loadBotConfig({ PUBLIC_WEB_URL: 'ftp://neonflux.example' })).toThrow(
            'PUBLIC_WEB_URL must be a valid HTTP or HTTPS origin'
        );
    });

    it('rejects malformed public web URLs', () => {
        expect(() => loadBotConfig({ PUBLIC_WEB_URL: 'neonflux.example' })).toThrow(
            'PUBLIC_WEB_URL must be a valid HTTP or HTTPS origin'
        );
    });
});

describe('loadWebConfig', () => {
    it('loads web-only OAuth and session secrets', () => {
        const config = loadWebConfig({
            FLUXER_APP_ID: ' app-id ',
            FLUXER_BOT_INVITE_URL:
                ' https://web.canary.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=bot&permissions=8 ',
            FLUXER_BOT_TOKEN: ' bot-token ',
            FLUXER_CLIENT_SECRET: ' client-secret ',
            FLUXER_OAUTH_REDIRECT_URL: ' redirect-url ',
            FLUXER_TOKEN_ENCRYPTION_KEY: ' encryption-key ',
            SESSION_SECRET: ' session-secret ',
        });

        expect(config).toMatchObject({
            fluxerAppId: 'app-id',
            fluxerBotInviteUrl:
                'https://web.canary.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=bot&permissions=8',
            fluxerBotToken: 'bot-token',
            fluxerClientSecret: 'client-secret',
            fluxerOauthRedirectUrl: 'redirect-url',
            fluxerTokenEncryptionKey: 'encryption-key',
            sessionSecret: 'session-secret',
        });
        expect('instanceMode' in config).toBe(false);
        expect('singleGuildId' in config).toBe(false);
        expect('ownerIds' in config).toBe(false);
        expect('publicWebUrl' in config).toBe(false);
    });

    it('omits a blank bot invite URL', () => {
        expect(loadWebConfig({ FLUXER_BOT_INVITE_URL: '   ' }).fluxerBotInviteUrl).toBeUndefined();
    });

    it('rejects non-http bot invite URLs', () => {
        expect(() => loadWebConfig({ FLUXER_BOT_INVITE_URL: 'discord://oauth2/authorize' })).toThrow(
            'FLUXER_BOT_INVITE_URL must be a valid HTTP or HTTPS URL'
        );
    });

    it('rejects malformed bot invite URLs', () => {
        expect(() => loadWebConfig({ FLUXER_BOT_INVITE_URL: 'web.canary.fluxer.app/oauth2/authorize' })).toThrow(
            'FLUXER_BOT_INVITE_URL must be a valid HTTP or HTTPS URL'
        );
    });

    it('loads local .env values into blank process env keys without overriding non-blank process values', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'neonflux-env-'));
        tempEnvDirs.push(tempDir);
        writeFileSync(
            join(tempDir, '.env'),
            [
                'FLUXER_APP_ID=file-app',
                'FLUXER_BOT_INVITE_URL=https://web.canary.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=bot&permissions=8',
            ].join('\n')
        );
        process.chdir(tempDir);
        process.env.FLUXER_APP_ID = 'runtime-app';
        process.env.FLUXER_BOT_INVITE_URL = '   ';
        vi.resetModules();

        const { loadWebConfig: loadWebConfigFromLocalEnv } = await import('./env.js');
        const config = loadWebConfigFromLocalEnv();

        expect(config.fluxerAppId).toBe('runtime-app');
        expect(config.fluxerBotInviteUrl).toBe(
            'https://web.canary.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=bot&permissions=8'
        );
    });
});

describe('loadRuntimeConfig', () => {
    it('defaults AUTO_MIGRATE to true', () => {
        expect(loadRuntimeConfig({}).autoMigrate).toBe(true);
    });

    it('loads AUTO_MIGRATE=false', () => {
        expect(loadRuntimeConfig({ AUTO_MIGRATE: 'false' }).autoMigrate).toBe(false);
    });

    it('rejects invalid AUTO_MIGRATE values', () => {
        expect(() => loadRuntimeConfig({ AUTO_MIGRATE: 'yes' })).toThrow('Invalid environment');
    });

    it('rejects staging because the project only has dev and prod bots', () => {
        expect(() => loadRuntimeConfig({ APP_ENV: 'staging' })).toThrow('Invalid environment');
    });

    it('requires production database url', () => {
        expect(() =>
            loadRuntimeConfig({
                APP_ENV: 'production',
            })
        ).toThrow('DATABASE_URL is required');
    });

    it('does not require service-specific secrets in the runtime config loader', () => {
        expect(() =>
            loadRuntimeConfig({
                APP_ENV: 'production',
                DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/neonflux_test',
            })
        ).not.toThrow();
    });

    it('defaults guild DEFCON override to auto', () => {
        expect(loadRuntimeConfig({}).guildDefconOverride).toBe('auto');
    });

    it('loads numeric guild DEFCON overrides', () => {
        expect(loadRuntimeConfig({ GUILD_DEFCON_OVERRIDE: '1' }).guildDefconOverride).toBe(1);
        expect(loadRuntimeConfig({ GUILD_DEFCON_OVERRIDE: '2' }).guildDefconOverride).toBe(2);
        expect(loadRuntimeConfig({ GUILD_DEFCON_OVERRIDE: '3' }).guildDefconOverride).toBe(3);
    });

    it('loads explicit auto guild DEFCON override', () => {
        expect(loadRuntimeConfig({ GUILD_DEFCON_OVERRIDE: 'auto' }).guildDefconOverride).toBe('auto');
    });

    it('rejects invalid guild DEFCON overrides', () => {
        expect(() => loadRuntimeConfig({ GUILD_DEFCON_OVERRIDE: '4' })).toThrow('Invalid environment');
        expect(() => loadRuntimeConfig({ GUILD_DEFCON_OVERRIDE: 'locked' })).toThrow('Invalid environment');
    });
});

function restoreProcessEnvValue(name: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
        return;
    }

    process.env[name] = value;
}

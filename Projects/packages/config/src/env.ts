import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { type } from 'arktype';
import { config as loadDotEnv } from 'dotenv';

const devDatabaseUrl = 'postgres://postgres:postgres@localhost:5432/neonflux_dev';

const appEnv = type("'development' | 'production'");
const instanceMode = type("'single' | 'multi'");
const logLevel = type("'debug' | 'info' | 'warn' | 'error'");
const nodeEnv = type("'development' | 'test' | 'production'");
const autoMigrate = type("'true' | 'false'");

const rawEnv = type({
    'APP_ENV?': appEnv,
    'INSTANCE_MODE?': instanceMode,
    'SINGLE_GUILD_ID?': 'string',
    'DATABASE_URL?': 'string',
    'AUTO_MIGRATE?': autoMigrate,
    'FLUXER_APP_ID?': 'string',
    'FLUXER_CLIENT_SECRET?': 'string',
    'FLUXER_BOT_TOKEN?': 'string',
    'FLUXER_OAUTH_REDIRECT_URL?': 'string',
    'FLUXER_TOKEN_ENCRYPTION_KEY?': 'string',
    'SESSION_SECRET?': 'string',
    'PUBLIC_WEB_URL?': 'string',
    'LOG_LEVEL?': logLevel,
    'NODE_ENV?': nodeEnv,
    'OWNER_IDS?': 'string',
});

export type AppEnv = 'development' | 'production';
export type InstanceMode = 'single' | 'multi';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type AppMode = { instanceMode: 'single'; singleGuildId: string } | { instanceMode: 'multi' };

export type AppConfig = AppMode & {
    appEnv: AppEnv;
    databaseUrl: string;
    autoMigrate: boolean;
    fluxerAppId?: string;
    fluxerClientSecret?: string;
    fluxerBotToken?: string;
    fluxerOauthRedirectUrl?: string;
    fluxerTokenEncryptionKey?: string;
    sessionSecret?: string;
    publicWebUrl?: string;
    logLevel: LogLevel;
    nodeEnv: 'development' | 'test' | 'production';
    ownerIds: string[];
};

let loadedDotEnvPath: string | undefined;

export function loadLocalEnv(startDir = process.cwd()): string | undefined {
    if (loadedDotEnvPath) {
        return loadedDotEnvPath;
    }

    let currentDir = resolve(startDir);
    let previousDir: string | undefined;

    while (currentDir !== previousDir) {
        const candidate = join(currentDir, '.env');

        if (existsSync(candidate)) {
            loadDotEnv({ path: candidate, override: false });
            loadedDotEnvPath = candidate;
            return candidate;
        }

        previousDir = currentDir;
        currentDir = dirname(currentDir);
    }

    return undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
    if (env === process.env) {
        loadLocalEnv();
    }

    const parsed = rawEnv(env);

    if (parsed instanceof type.errors) {
        throw new Error(`Invalid environment: ${parsed.summary}`);
    }

    const appEnvValue = parsed.APP_ENV ?? 'development';
    const instanceModeValue = parsed.INSTANCE_MODE ?? 'multi';
    const databaseUrl = valueOrFallback(parsed.DATABASE_URL, appEnvValue === 'production' ? undefined : devDatabaseUrl);
    const fluxerAppId = optionalValue(parsed.FLUXER_APP_ID);
    const fluxerClientSecret = optionalValue(parsed.FLUXER_CLIENT_SECRET);
    const fluxerBotToken = optionalValue(parsed.FLUXER_BOT_TOKEN);
    const fluxerOauthRedirectUrl = optionalValue(parsed.FLUXER_OAUTH_REDIRECT_URL);
    const fluxerTokenEncryptionKey = optionalValue(parsed.FLUXER_TOKEN_ENCRYPTION_KEY);
    const sessionSecret = optionalValue(parsed.SESSION_SECRET);
    const publicWebUrl = optionalPublicWebUrl(parsed.PUBLIC_WEB_URL);

    if (appEnvValue === 'production') {
        requireEnvValue(databaseUrl, 'DATABASE_URL');
    }

    const baseConfig = {
        appEnv: appEnvValue,
        databaseUrl,
        autoMigrate: parsed.AUTO_MIGRATE !== 'false',
        ...(fluxerAppId ? { fluxerAppId } : {}),
        ...(fluxerClientSecret ? { fluxerClientSecret } : {}),
        ...(fluxerBotToken ? { fluxerBotToken } : {}),
        ...(fluxerOauthRedirectUrl ? { fluxerOauthRedirectUrl } : {}),
        ...(fluxerTokenEncryptionKey ? { fluxerTokenEncryptionKey } : {}),
        ...(sessionSecret ? { sessionSecret } : {}),
        ...(publicWebUrl ? { publicWebUrl } : {}),
        logLevel: parsed.LOG_LEVEL ?? 'info',
        nodeEnv: parsed.NODE_ENV ?? 'development',
        ownerIds: parseCsvIds(parsed.OWNER_IDS),
    } satisfies Omit<AppConfig, keyof AppMode>;

    switch (instanceModeValue) {
        case 'single': {
            const singleGuildId = optionalValue(parsed.SINGLE_GUILD_ID);
            requireEnvValue(singleGuildId, 'SINGLE_GUILD_ID');

            return {
                ...baseConfig,
                instanceMode: 'single',
                singleGuildId,
            };
        }

        case 'multi':
            return {
                ...baseConfig,
                instanceMode: 'multi',
            };
    }
}

function optionalValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function valueOrFallback(value: string | undefined, fallback: string | undefined): string {
    const parsedValue = optionalValue(value) ?? fallback;
    requireEnvValue(parsedValue, 'DATABASE_URL');
    return parsedValue;
}

function optionalPublicWebUrl(value: string | undefined): string | undefined {
    const normalizedValue = optionalValue(value);

    if (!normalizedValue) {
        return undefined;
    }

    let url: URL;

    try {
        url = new URL(normalizedValue);
    } catch {
        throw new Error('PUBLIC_WEB_URL must be a valid HTTP or HTTPS origin');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('PUBLIC_WEB_URL must be a valid HTTP or HTTPS origin');
    }

    if (
        url.pathname !== '/' ||
        url.search.length > 0 ||
        url.hash.length > 0 ||
        url.username.length > 0 ||
        url.password.length > 0
    ) {
        throw new Error('PUBLIC_WEB_URL must be an origin without path, query, hash, or credentials');
    }

    return url.origin;
}

function requireEnvValue(value: string | undefined, name: string): asserts value is string {
    if (!value) {
        throw new Error(`${name} is required`);
    }
}

function parseCsvIds(value: string | undefined): string[] {
    return (
        value
            ?.split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0) ?? []
    );
}

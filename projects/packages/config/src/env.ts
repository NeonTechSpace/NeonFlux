import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { type } from 'arktype';
import { config as loadDotEnv } from 'dotenv';

const devDatabaseUrl = 'postgres://postgres:postgres@localhost:5432/neonflux_dev';

const appEnv = type("'development' | 'production'");
const instanceMode = type("'single' | 'multi'");
const guildDefconOverride = type("'auto' | '1' | '2' | '3'");
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
    'FLUXER_BOT_CUSTOM_STATUS?': 'string',
    'FLUXER_BOT_TOKEN?': 'string',
    'FLUXER_OAUTH_REDIRECT_URL?': 'string',
    'FLUXER_TOKEN_ENCRYPTION_KEY?': 'string',
    'SESSION_SECRET?': 'string',
    'PUBLIC_WEB_URL?': 'string',
    'GUILD_DEFCON_OVERRIDE?': guildDefconOverride,
    'LOG_LEVEL?': logLevel,
    'NODE_ENV?': nodeEnv,
    'OWNER_IDS?': 'string',
});

export type AppEnv = 'development' | 'production';
export type InstanceMode = 'single' | 'multi';
export type GuildDefconLevel = 1 | 2 | 3;
export type GuildDefconOverride = 'auto' | GuildDefconLevel;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type AppMode = { instanceMode: 'single'; singleGuildId: string } | { instanceMode: 'multi' };

export type RuntimeConfig = {
    appEnv: AppEnv;
    databaseUrl: string;
    autoMigrate: boolean;
    guildDefconOverride: GuildDefconOverride;
    logLevel: LogLevel;
    nodeEnv: 'development' | 'test' | 'production';
};

export type BotConfig = RuntimeConfig &
    AppMode & {
        fluxerBotCustomStatusText?: string;
        fluxerBotToken?: string;
        publicWebUrl?: string;
        ownerIds: string[];
    };

export type WebConfig = RuntimeConfig & {
    fluxerAppId?: string;
    fluxerBotToken?: string;
    fluxerClientSecret?: string;
    fluxerOauthRedirectUrl?: string;
    fluxerTokenEncryptionKey?: string;
    sessionSecret?: string;
};

export type AppConfig = BotConfig;

type ParsedEnv = typeof rawEnv.infer;

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

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
    return createRuntimeConfig(parseEnv(env));
}

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
    const parsed = parseEnv(env);
    const runtimeConfig = createRuntimeConfig(parsed);
    const instanceModeValue = parsed.INSTANCE_MODE ?? 'multi';
    const fluxerBotCustomStatusText = optionalValue(parsed.FLUXER_BOT_CUSTOM_STATUS);
    const fluxerBotToken = optionalValue(parsed.FLUXER_BOT_TOKEN);
    const publicWebUrl = optionalPublicWebUrl(parsed.PUBLIC_WEB_URL);

    const botBaseConfig = {
        ...runtimeConfig,
        ...(fluxerBotCustomStatusText ? { fluxerBotCustomStatusText } : {}),
        ...(fluxerBotToken ? { fluxerBotToken } : {}),
        ...(publicWebUrl ? { publicWebUrl } : {}),
        ownerIds: parseCsvIds(parsed.OWNER_IDS),
    } satisfies Omit<BotConfig, keyof AppMode>;

    switch (instanceModeValue) {
        case 'single': {
            const singleGuildId = optionalValue(parsed.SINGLE_GUILD_ID);
            requireEnvValue(singleGuildId, 'SINGLE_GUILD_ID');

            return {
                ...botBaseConfig,
                instanceMode: 'single',
                singleGuildId,
            };
        }

        case 'multi':
            return {
                ...botBaseConfig,
                instanceMode: 'multi',
            };
    }
}

export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
    const parsed = parseEnv(env);
    const runtimeConfig = createRuntimeConfig(parsed);
    const fluxerAppId = optionalValue(parsed.FLUXER_APP_ID);
    const fluxerBotToken = optionalValue(parsed.FLUXER_BOT_TOKEN);
    const fluxerClientSecret = optionalValue(parsed.FLUXER_CLIENT_SECRET);
    const fluxerOauthRedirectUrl = optionalValue(parsed.FLUXER_OAUTH_REDIRECT_URL);
    const fluxerTokenEncryptionKey = optionalValue(parsed.FLUXER_TOKEN_ENCRYPTION_KEY);
    const sessionSecret = optionalValue(parsed.SESSION_SECRET);

    return {
        ...runtimeConfig,
        ...(fluxerAppId ? { fluxerAppId } : {}),
        ...(fluxerBotToken ? { fluxerBotToken } : {}),
        ...(fluxerClientSecret ? { fluxerClientSecret } : {}),
        ...(fluxerOauthRedirectUrl ? { fluxerOauthRedirectUrl } : {}),
        ...(fluxerTokenEncryptionKey ? { fluxerTokenEncryptionKey } : {}),
        ...(sessionSecret ? { sessionSecret } : {}),
    };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
    return loadBotConfig(env);
}

function parseEnv(env: NodeJS.ProcessEnv): ParsedEnv {
    if (env === process.env) {
        loadLocalEnv();
    }

    const parsed = rawEnv(env);

    if (parsed instanceof type.errors) {
        throw new Error(`Invalid environment: ${parsed.summary}`);
    }

    return parsed;
}

function createRuntimeConfig(parsed: ParsedEnv): RuntimeConfig {
    const appEnvValue = parsed.APP_ENV ?? 'development';
    const databaseUrl = valueOrFallback(parsed.DATABASE_URL, appEnvValue === 'production' ? undefined : devDatabaseUrl);

    if (appEnvValue === 'production') {
        requireEnvValue(databaseUrl, 'DATABASE_URL');
    }

    return {
        appEnv: appEnvValue,
        databaseUrl,
        autoMigrate: parsed.AUTO_MIGRATE !== 'false',
        guildDefconOverride: parseGuildDefconOverride(parsed.GUILD_DEFCON_OVERRIDE),
        logLevel: parsed.LOG_LEVEL ?? 'info',
        nodeEnv: parsed.NODE_ENV ?? 'development',
    };
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

function parseGuildDefconOverride(value: 'auto' | '1' | '2' | '3' | undefined): GuildDefconOverride {
    switch (value ?? 'auto') {
        case 'auto':
            return 'auto';
        case '1':
            return 1;
        case '2':
            return 2;
        case '3':
            return 3;
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

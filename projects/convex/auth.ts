import type { UserIdentity } from 'convex/server';

export type NeonFluxConvexUserIdentity = {
    fluxerUserId: string;
    kind: 'user';
    manageableGuildIds: string[];
    sessionId: string;
    subject: string;
    tokenIdentifier: string;
};

export type NeonFluxConvexServiceIdentity = {
    kind: 'service';
    serviceName: 'bot' | 'web';
    subject: string;
    tokenIdentifier: string;
};

export type NeonFluxConvexIdentity = NeonFluxConvexUserIdentity | NeonFluxConvexServiceIdentity;

export type NeonFluxAuthContext = {
    auth: {
        getUserIdentity(): Promise<UserIdentity | null>;
    };
};

export async function requireNeonFluxUser(ctx: NeonFluxAuthContext): Promise<NeonFluxConvexUserIdentity> {
    const identity = await readNeonFluxIdentity(ctx);

    if (identity?.kind !== 'user') {
        throw new Error('NeonFlux user authentication required');
    }

    return identity;
}

export async function requireNeonFluxService(
    ctx: NeonFluxAuthContext,
    allowedServices: ReadonlyArray<NeonFluxConvexServiceIdentity['serviceName']>
): Promise<NeonFluxConvexServiceIdentity> {
    const identity = await readNeonFluxIdentity(ctx);

    if (identity?.kind !== 'service' || !allowedServices.includes(identity.serviceName)) {
        throw new Error('NeonFlux service authentication required');
    }

    return identity;
}

export async function requireGuildAccess(
    ctx: NeonFluxAuthContext,
    guildId: string
): Promise<NeonFluxConvexUserIdentity> {
    const identity = await requireNeonFluxUser(ctx);

    if (!identity.manageableGuildIds.includes(guildId)) {
        throw new Error('NeonFlux guild access required');
    }

    return identity;
}

export async function readNeonFluxIdentity(ctx: NeonFluxAuthContext): Promise<NeonFluxConvexIdentity | null> {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
        return null;
    }

    const kind = readStringClaim(identity, 'kind');

    switch (kind) {
        case 'user':
            return readUserIdentity(identity);

        case 'service':
            return readServiceIdentity(identity);

        case undefined:
            return null;

        default:
            return null;
    }
}

function readUserIdentity(identity: UserIdentity): NeonFluxConvexUserIdentity | null {
    if (!matchesIdentityIssuer(identity, process.env.NEONFLUX_USER_AUTH_JWT_ISSUER)) return null;

    const fluxerUserId = readStringClaim(identity, 'fluxerUserId');
    const sessionId = readStringClaim(identity, 'sessionId');
    const manageableGuildIds = readStringArrayClaim(identity, 'manageableGuildIds') ?? [];

    if (!fluxerUserId || !sessionId) {
        return null;
    }

    return {
        fluxerUserId,
        kind: 'user',
        manageableGuildIds,
        sessionId,
        subject: identity.subject,
        tokenIdentifier: identity.tokenIdentifier,
    };
}

function readServiceIdentity(identity: UserIdentity): NeonFluxConvexServiceIdentity | null {
    const serviceName = readStringClaim(identity, 'serviceName');

    if (serviceName !== 'bot' && serviceName !== 'web') {
        return null;
    }

    const expectedIssuer =
        serviceName === 'bot' ? process.env.NEONFLUX_BOT_AUTH_JWT_ISSUER : process.env.NEONFLUX_WEB_AUTH_JWT_ISSUER;

    if (!matchesIdentityIssuer(identity, expectedIssuer)) return null;

    return {
        kind: 'service',
        serviceName,
        subject: identity.subject,
        tokenIdentifier: identity.tokenIdentifier,
    };
}

function matchesIdentityIssuer(identity: UserIdentity, expectedIssuer: string | undefined): boolean {
    const normalizedExpectedIssuer = normalizeIssuer(expectedIssuer);
    return Boolean(normalizedExpectedIssuer && identity.issuer === normalizedExpectedIssuer);
}

function normalizeIssuer(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    if (!normalized) return undefined;

    try {
        return new URL(normalized).toString();
    } catch {
        return undefined;
    }
}

function readStringClaim(identity: UserIdentity, name: string): string | undefined {
    const value = readNeonFluxClaim(identity, name);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringArrayClaim(identity: UserIdentity, name: string): string[] | undefined {
    const value = readNeonFluxClaim(identity, name);

    if (!Array.isArray(value)) {
        return undefined;
    }

    const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
    return strings.length === value.length ? strings : undefined;
}

function readNeonFluxClaim(identity: UserIdentity, name: string): unknown {
    const flattenedClaim = identity[`neonflux.${name}`];

    if (flattenedClaim !== undefined) {
        return flattenedClaim;
    }

    const nestedClaim = identity.neonflux;

    if (isRecord(nestedClaim)) {
        return nestedClaim[name];
    }

    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const FLUXER_AUTHORIZE_URL = 'https://web.canary.fluxer.app/oauth2/authorize';

export type FluxerOAuthScope = 'identify' | 'guilds' | 'email' | 'connections' | 'bot';

export type BuildFluxerAuthorizeUrlInput = {
    appId: string;
    redirectUrl: string;
    scopes: readonly FluxerOAuthScope[];
};

export function buildFluxerAuthorizeUrl(input: BuildFluxerAuthorizeUrlInput): string {
    const appId = input.appId.trim();
    const redirectUrl = input.redirectUrl.trim();

    requireValue(appId, 'appId');
    requireValue(redirectUrl, 'redirectUrl');

    if (input.scopes.length === 0) {
        throw new Error('scopes is required');
    }

    const url = new URL(FLUXER_AUTHORIZE_URL);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('scope', input.scopes.join(' '));
    url.searchParams.set('redirect_uri', redirectUrl);
    url.searchParams.set('response_type', 'code');

    return url.toString();
}

function requireValue(value: string, name: string): void {
    if (value.length === 0) {
        throw new Error(`${name} is required`);
    }
}

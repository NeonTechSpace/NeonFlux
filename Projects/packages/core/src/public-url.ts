import { err, ok, type Result } from 'neverthrow';

export type PublicWebUrlBuildError = 'missing-public-web-url' | 'invalid-public-web-url' | 'invalid-path';

export type BuildPublicWebUrlInput = {
    publicWebUrl: string | null | undefined;
    path: string;
    searchParams?: URLSearchParams | Record<string, string | number | boolean | null | undefined>;
};

export function buildPublicWebUrl(input: BuildPublicWebUrlInput): Result<string, PublicWebUrlBuildError> {
    const publicWebUrlResult = normalizePublicWebUrl(input.publicWebUrl);

    if (publicWebUrlResult.isErr()) {
        return err(publicWebUrlResult.error);
    }

    if (!isValidAppPath(input.path)) {
        return err('invalid-path');
    }

    const url = new URL(input.path, publicWebUrlResult.value);

    appendSearchParams(url, input.searchParams);

    return ok(url.toString());
}

function normalizePublicWebUrl(
    publicWebUrl: string | null | undefined
): Result<string, 'missing-public-web-url' | 'invalid-public-web-url'> {
    const normalizedPublicWebUrl = publicWebUrl?.trim();

    if (!normalizedPublicWebUrl) {
        return err('missing-public-web-url');
    }

    let url: URL;

    try {
        url = new URL(normalizedPublicWebUrl);
    } catch {
        return err('invalid-public-web-url');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return err('invalid-public-web-url');
    }

    if (
        url.pathname !== '/' ||
        url.search.length > 0 ||
        url.hash.length > 0 ||
        url.username.length > 0 ||
        url.password.length > 0
    ) {
        return err('invalid-public-web-url');
    }

    return ok(url.origin);
}

function isValidAppPath(path: string): boolean {
    return path.startsWith('/') && !path.startsWith('//');
}

function appendSearchParams(
    url: URL,
    searchParams: URLSearchParams | Record<string, string | number | boolean | null | undefined> | undefined
): void {
    if (!searchParams) {
        return;
    }

    if (searchParams instanceof URLSearchParams) {
        for (const [key, value] of searchParams.entries()) {
            url.searchParams.append(key, value);
        }

        return;
    }

    for (const [key, value] of Object.entries(searchParams)) {
        if (value === null || value === undefined) {
            continue;
        }

        url.searchParams.append(key, String(value));
    }
}

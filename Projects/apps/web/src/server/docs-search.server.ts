import '@tanstack/react-start/server-only';

import { createFromSource } from 'fumadocs-core/search/server';

import { source } from '../lib/source.js';

const search = createFromSource(source);

export function handlePublicDocsSearchRequest(request: Request): Response | Promise<Response> {
    return search.GET(request);
}

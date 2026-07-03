import { anyApi } from 'convex/server';

// Shared API reference boundary for packages that must not import
// projects/convex/_generated directly.
export const api = anyApi;

import { ConvexHttpClient } from 'convex/browser';

export type NeonFluxConvexClientConfig = {
    authToken?: string;
    url: string;
};

export function createNeonFluxConvexHttpClient(config: NeonFluxConvexClientConfig): ConvexHttpClient {
    const client = new ConvexHttpClient(config.url);

    if (config.authToken) {
        client.setAuth(config.authToken);
    }

    return client;
}

const webServerUrl = new URL('../apps/web/.output/server/index.mjs', import.meta.url);

await import(webServerUrl.href);

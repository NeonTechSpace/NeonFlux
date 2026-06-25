import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { toDocsRouteResult } from '../server/docs-route-data.js';
import type { PublicDocsRouteData } from '../server/docs.server.js';

const webRoot = fileURLToPath(new URL('../..', import.meta.url));

describe('/docs routing', () => {
    it('generates public docs and docs search routes', () => {
        const routeTree = readWebFile('src/routeTree.gen.ts');

        expect(routeTree).toContain("fullPath: '/docs'");
        expect(routeTree).toContain("fullPath: '/docs/topic'");
        expect(routeTree).toContain("fullPath: '/docs/topic/'");
        expect(routeTree).toContain("fullPath: '/docs/topic/$'");
        expect(routeTree).toContain("fullPath: '/docs/api/search'");
        expect(routeTree).not.toContain("fullPath: '/api/search'");
    });

    it('keeps docs routes separate from dashboard and auth server boundaries', () => {
        const docsIndexRoute = readWebFile('src/routes/docs.tsx');
        const docsSplatRoute = readWebFile('src/routes/docs/topic/$.tsx');
        const searchRoute = readWebFile('src/routes/docs/api/search.ts');

        expect(`${docsIndexRoute}\n${docsSplatRoute}\n${searchRoute}`).not.toMatch(
            /dashboard\.server|web-session\.server|fluxer-auth-context|auth\/fluxer\/login/
        );
    });

    it('configures docs search under the docs route namespace', () => {
        const docsLayout = readWebFile('src/components/docs-route-layout.tsx');
        const searchRoute = readWebFile('src/routes/docs/api/search.ts');

        expect(docsLayout).toContain("api: '/docs/api/search'");
        expect(searchRoute).toContain("createFileRoute('/docs/api/search')");
        expect(searchRoute).not.toContain('fumadocs-core/search/server');
        expect(searchRoute).not.toContain('../lib/source');
    });

    it('lets docs topic child pages render through the topic layout', () => {
        const docsTopicRoute = readWebFile('src/routes/docs/topic.tsx');
        const docsTopicIndexRoute = readWebFile('src/routes/docs/topic/index.tsx');

        expect(docsTopicRoute).toContain('Outlet');
        expect(docsTopicRoute).not.toContain('PublicDocsPage');
        expect(docsTopicIndexRoute).toContain("createFileRoute('/docs/topic/')");
        expect(docsTopicIndexRoute).toContain('PublicDocsPage');
    });

    it('keeps docs dark-only and points the GitHub link to the NeonFlux repo', () => {
        const docsLayout = readWebFile('src/lib/docs-layout.tsx');

        expect(docsLayout).toContain("url: '/docs/topic'");
        expect(docsLayout).not.toContain('githubUrl');
        expect(docsLayout).toContain("url: 'https://github.com/NeonTechSpace/NeonFlux'");
        expect(docsLayout).toContain('Repository');
        expect(docsLayout).toContain('Github');
        expect(docsLayout).toContain('Back');
        expect(docsLayout).toContain("url: '/'");
        expect(docsLayout).toContain('ArrowLeft');
        expect(docsLayout).toContain('LayoutDashboard');
        expect(docsLayout).not.toContain('ExternalLink');
        expect(docsLayout).not.toContain('DocsSidebarBanner');
        expect(docsLayout).not.toContain('Fluxer bot docs');
        expect(docsLayout).not.toContain('banner:');
        expect(docsLayout).toContain('themeSwitch');
        expect(docsLayout).toContain('enabled: false');
    });

    it('keeps the docs shell persistent and scopes loading to article content', () => {
        const docsPage = readWebFile('src/components/docs-page.tsx');
        const docsRouteLayout = readWebFile('src/components/docs-route-layout.tsx');
        const docsShellRoute = readWebFile('src/routes/docs.tsx');
        const docsIndexRoute = readWebFile('src/routes/docs.index.tsx');
        const docsTopicIndexRoute = readWebFile('src/routes/docs/topic/index.tsx');
        const docsTopicSplatRoute = readWebFile('src/routes/docs/topic/$.tsx');

        expect(docsShellRoute).toContain('loadDocsShellRouteData');
        expect(docsShellRoute).toContain('<DocsRouteLayoutContent data={data} />');
        expect(docsShellRoute).not.toContain('DocsRouteLoading');
        expect(docsIndexRoute).not.toContain('pendingComponent: DocsRouteLoading');
        expect(docsIndexRoute).not.toContain('fallback={<DocsRouteLoading />}');
        expect(docsTopicIndexRoute).not.toContain('pendingComponent: DocsRouteLoading');
        expect(docsTopicIndexRoute).not.toContain('fallback={<DocsRouteLoading />}');
        expect(docsTopicSplatRoute).not.toContain('pendingComponent: DocsRouteLoading');
        expect(docsTopicSplatRoute).not.toContain('fallback={<DocsRouteLoading />}');
        expect(docsPage).toContain('DocsContentSkeleton');
        expect(docsRouteLayout).toContain('RootProvider');
        expect(docsRouteLayout).toContain('DocsLayout');
        expect(docsRouteLayout).toContain('DocsLayoutContainer');
        expect(docsRouteLayout).toContain('slots={{ container: DocsShellContainer }}');
        expect(docsRouteLayout).toContain("backgroundAttachment: 'fixed'");
        expect(docsRouteLayout).toContain(
            'linear-gradient(90deg, var(--color-fd-background) 0 var(--fd-sidebar-col, 0px)'
        );
        expect(docsRouteLayout).toContain('rgba(217, 70, 239');
        expect(docsPage).not.toContain('grid size-');
        expect(docsPage).not.toContain('DocsShellAmbientBackdrop');
        expect(docsPage).not.toContain('DocsPageHeader');
        expect(docsPage).not.toContain('DocsPageAmbientBackdrop');
        expect(docsPage).toContain("role='status'");
        expect(docsPage).toContain("className='sr-only'");
        expect(docsPage).not.toContain('<p>Loading documentation');
        expect(docsPage).not.toContain('DocsRouteLoading');
    });

    it('groups docs sidebar items without changing topic URLs', () => {
        const docsMeta = readWebFile('content/docs/meta.json');
        const botMeta = readWebFile('content/docs/(bot)/meta.json');
        const deploymentMeta = readWebFile('content/docs/(deployment)/meta.json');

        expect(docsMeta).toContain('"(bot)"');
        expect(docsMeta).toContain('"(deployment)"');
        expect(docsMeta).not.toContain('---Bot---');
        expect(docsMeta).not.toContain('---Deployment---');
        expect(botMeta).toContain('"title": "Bot"');
        expect(botMeta).toContain('"defaultOpen": true');
        expect(botMeta).toContain('"collapsible": true');
        expect(deploymentMeta).toContain('"title": "Deployment"');
        expect(deploymentMeta).toContain('"defaultOpen": true');
        expect(deploymentMeta).toContain('"collapsible": true');
        expect(botMeta).toContain('"bot-presence"');
        expect(deploymentMeta).toContain('"instance-modes"');
        expect(deploymentMeta).toContain('"docker"');
    });

    it('exposes the curated MDX components used by the public docs', () => {
        const mdxComponents = readWebFile('src/components/mdx.tsx');

        expect(mdxComponents).toContain("from 'fumadocs-ui/components/files'");
        expect(mdxComponents).toContain("from 'fumadocs-ui/components/steps'");
        expect(mdxComponents).toContain("from 'fumadocs-ui/components/tabs'");
        expect(mdxComponents).toContain("from 'fumadocs-ui/components/accordion'");
        expect(mdxComponents).toContain('Accordion,');
        expect(mdxComponents).toContain('Accordions,');
        expect(mdxComponents).toContain('File,');
        expect(mdxComponents).toContain('Files,');
        expect(mdxComponents).toContain('Folder,');
        expect(mdxComponents).toContain('Step,');
        expect(mdxComponents).toContain('Steps,');
        expect(mdxComponents).toContain('Tab,');
        expect(mdxComponents).toContain('Tabs,');
    });

    it('keeps current docs slugs represented through group folders', () => {
        const docsMeta = readWebFile('content/docs/meta.json');
        const botMeta = readWebFile('content/docs/(bot)/meta.json');
        const deploymentMeta = readWebFile('content/docs/(deployment)/meta.json');

        expect(docsMeta).toContain('"(bot)"');
        expect(docsMeta).toContain('"(deployment)"');
        expect(botMeta).toContain('"bot-presence"');
        expect(deploymentMeta).toContain('"instance-modes"');
        expect(deploymentMeta).toContain('"docker"');
    });

    it('maps docs data into route results', () => {
        const docsData = {
            pageTree: {
                name: 'Docs',
                children: [],
            },
            page: {
                path: 'index',
                title: 'Docs',
                toc: [],
            },
        } as unknown as PublicDocsRouteData;

        expect(toDocsRouteResult(docsData)).toStrictEqual({ type: 'page', data: docsData });
        expect(toDocsRouteResult(undefined)).toStrictEqual({ type: 'not-found' });
    });

    it('forces the docs shell to dark mode', () => {
        const rootRoute = readWebFile('src/routes/__root.tsx');
        const docsLayout = readWebFile('src/components/docs-route-layout.tsx');
        const styles = readWebFile('src/styles.css');

        expect(styles).toContain('fumadocs-ui/css/black.css');
        expect(styles).toContain('--color-fd-background');
        expect(styles).toContain('#nd-sidebar');
        expect(styles).toContain("[data-active='true']");
        expect(styles).not.toContain('fumadocs-ui/css/neutral.css');
        expect(rootRoute).toContain("className='dark'");
        expect(docsLayout).toContain("defaultTheme: 'dark'");
        expect(docsLayout).toContain("forcedTheme: 'dark'");
        expect(docsLayout).toContain('enableSystem: false');
    });

    it('uses Outfit globally and Roboto Mono for code', () => {
        const styles = readWebFile('src/styles.css');
        const webPackage = readWebFile('package.json');

        expect(webPackage).toContain('"@fontsource/outfit"');
        expect(webPackage).toContain('"@fontsource/roboto-mono"');
        expect(styles).toContain("@import '@fontsource/outfit/latin-400.css'");
        expect(styles).toContain("@import '@fontsource/outfit/latin-800.css'");
        expect(styles).toContain("@import '@fontsource/roboto-mono/latin-400.css'");
        expect(styles).toContain("@import '@fontsource/roboto-mono/latin-700.css'");
        expect(styles).toMatch(/--font-sans:\s*'Outfit'/);
        expect(styles).toMatch(/--font-mono:\s*'Roboto Mono'/);
        expect(styles).toContain('--default-font-family: var(--font-sans)');
        expect(styles).toContain('--default-mono-font-family: var(--font-mono)');
        expect(styles).toContain('font-family: var(--font-sans)');
        expect(styles).toContain('font-family: var(--font-mono)');
    });

    it('includes starter docs content for current top-level concepts', () => {
        const docsIndex = readWebFile('content/docs/index.mdx');
        const botPresence = readWebFile('content/docs/(bot)/bot-presence.mdx');
        const instanceModes = readWebFile('content/docs/(deployment)/instance-modes.mdx');
        const docker = readWebFile('content/docs/(deployment)/docker.mdx');

        expect(docsIndex).toContain('title: Overview');
        expect(docsIndex).toContain('NeonFlux is a Fluxer bot with a protected web dashboard.');
        expect(docsIndex).toContain("<Accordions type='single' collapsible>");
        expect(docsIndex).toContain("<Accordion title='Bot' value='bot'>");
        expect(docsIndex).toContain("<Accordion title='Deployment' value='deployment'>");
        expect(docsIndex).not.toContain('<Cards>');
        expect(docsIndex).not.toContain("<Card title='Docker'");
        expect(docsIndex).toContain('Open `/dashboard` to choose a community.');
        expect(docsIndex).toContain('`/dashboard/{guildId}`');
        expect(docsIndex).toContain('## Dashboard routes');
        expect(botPresence).toContain('The default command prefix is `!`.');
        expect(botPresence).toContain(
            'Artron energy is binding to NeonFlux, allowing travel throughout all of existence.'
        );
        expect(botPresence).toContain('`FLUXER_BOT_CUSTOM_STATUS`');
        expect(botPresence).toContain('Leave it blank for no custom status.');
        expect(botPresence).toContain('communities can change it with a guarded');
        expect(botPresence).toContain('selected community dashboard');
        expect(botPresence).toContain('update live without interval polling');
        expect(botPresence).toContain('@NeonFlux prefix ?');
        expect(botPresence).toContain('nothing changed instead of saving it again');
        expect(botPresence).toContain('The first character must be an allowed symbol or punctuation mark.');
        expect(botPresence).toContain('letters and numbers are allowed.');
        expect(botPresence).toContain('Do not use `/`, `@`, `#`, `<`, `>`, or `:`');
        expect(botPresence).toContain('With the default prefix, `!ping` replies');
        expect(botPresence).toContain('<Steps>');
        expect(botPresence).toContain('## DEFCON effect');
        expect(botPresence).toContain('Guarded prefix changes are server-owner only');
        expect(botPresence).not.toContain('Open `/dashboard`');
        expect(botPresence).not.toContain('`/dashboard/{guildId}`');
        expect(botPresence).not.toContain('Prefix controls are not configurable in the dashboard yet');
        expect(botPresence).toContain('Mention-response and DEFCON');
        expect(botPresence).toContain('controls are not configurable in the dashboard yet');
        expect(instanceModes).toContain('Single instance targets one configured community.');
        expect(instanceModes).toContain("<Tabs items={['Single instance', 'Multi instance']}>");
        expect(instanceModes).toContain('## Source of truth');
        expect(docker).toContain('three services');
        expect(docker).toContain('<Files>');
        expect(docker).toContain('<Steps>');
    });
});

function readWebFile(relativePath: string): string {
    return readFileSync(join(webRoot, relativePath), 'utf8');
}

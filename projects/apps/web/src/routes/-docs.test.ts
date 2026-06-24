import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { toDocsRouteResult } from './docs.js';
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
        const rootRoute = readWebFile('src/routes/__root.tsx');
        const searchRoute = readWebFile('src/routes/docs/api/search.ts');

        expect(rootRoute).toContain("api: '/docs/api/search'");
        expect(searchRoute).toContain("createFileRoute('/docs/api/search')");
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

    it('uses a quiet docs skeleton instead of a loading sentence', () => {
        const docsPage = readWebFile('src/components/docs-page.tsx');

        expect(docsPage).toContain('DocsContentSkeleton');
        expect(docsPage).toContain('DocsLayoutContainer');
        expect(docsPage).toContain('slots={{ container: DocsShellContainer }}');
        expect(docsPage).toContain("backgroundAttachment: 'fixed'");
        expect(docsPage).toContain('linear-gradient(90deg, var(--color-fd-background) 0 var(--fd-sidebar-col, 0px)');
        expect(docsPage).toContain('rgba(217, 70, 239');
        expect(docsPage).not.toContain('grid size-');
        expect(docsPage).not.toContain('DocsShellAmbientBackdrop');
        expect(docsPage).not.toContain('DocsPageHeader');
        expect(docsPage).not.toContain('DocsPageAmbientBackdrop');
        expect(docsPage).toContain("role='status'");
        expect(docsPage).toContain("className='sr-only'");
        expect(docsPage).not.toContain('<p>Loading documentation');
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
        const styles = readWebFile('src/styles.css');

        expect(styles).toContain('fumadocs-ui/css/black.css');
        expect(styles).toContain('--color-fd-background');
        expect(styles).toContain('#nd-sidebar');
        expect(styles).toContain("[data-active='true']");
        expect(styles).not.toContain('fumadocs-ui/css/neutral.css');
        expect(rootRoute).toContain("className='dark'");
        expect(rootRoute).toContain("defaultTheme: 'dark'");
        expect(rootRoute).toContain("forcedTheme: 'dark'");
        expect(rootRoute).toContain('enableSystem: false');
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
        expect(botPresence).toContain('communities can change it with a guarded');
        expect(botPresence).toContain('@NeonFlux prefix ?');
        expect(botPresence).toContain('1-3 visible symbol or punctuation characters');
        expect(botPresence).toContain('With the default prefix, `!ping` replies');
        expect(botPresence).toContain('<Steps>');
        expect(botPresence).toContain('## DEFCON effect');
        expect(botPresence).toContain('Guarded prefix changes are server-owner only');
        expect(botPresence).not.toContain('Open `/dashboard`');
        expect(botPresence).not.toContain('`/dashboard/{guildId}`');
        expect(botPresence).toContain('not configurable in the dashboard yet');
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

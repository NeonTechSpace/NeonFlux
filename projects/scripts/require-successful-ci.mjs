#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const workflowFile = 'ci.yml';

/**
 * @typedef {object} ReleaseCiRun
 * @property {number} id
 * @property {string} html_url
 * @property {string} head_sha
 * @property {string} head_branch
 * @property {string} event
 * @property {string} status
 * @property {string | null} conclusion
 */

/**
 * @param {ReleaseCiRun[]} runs
 * @param {string} expectedSha
 * @returns {ReleaseCiRun | undefined}
 */
export function findSuccessfulMainCiRun(runs, expectedSha) {
    return runs.find(
        (run) =>
            run.head_sha === expectedSha &&
            run.head_branch === 'main' &&
            run.event === 'push' &&
            run.status === 'completed' &&
            run.conclusion === 'success'
    );
}

/**
 * @param {string} repository
 * @param {string} expectedSha
 * @returns {string}
 */
export function buildWorkflowRunsUrl(repository, expectedSha) {
    const query = new URLSearchParams({
        branch: 'main',
        event: 'push',
        head_sha: expectedSha,
        per_page: '100',
        status: 'completed',
    });
    return `https://api.github.com/repos/${repository}/actions/workflows/${workflowFile}/runs?${query.toString()}`;
}

async function main() {
    const repository = requireEnvironmentVariable('GITHUB_REPOSITORY');
    const expectedSha = requireEnvironmentVariable('GITHUB_SHA');
    const token = requireEnvironmentVariable('GITHUB_TOKEN');
    const response = await fetch(buildWorkflowRunsUrl(repository, expectedSha), {
        headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${token}`,
            'x-github-api-version': '2022-11-28',
        },
    });

    if (!response.ok) {
        fail(`GitHub returned ${String(response.status)} while checking CI for ${expectedSha}.`);
    }

    const payload = await response.json();
    const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
    const successfulRun = findSuccessfulMainCiRun(runs, expectedSha);

    if (!successfulRun) {
        fail(
            `Release commit ${expectedSha} does not have a completed successful main push run of ${workflowFile}. ` +
                'Wait for CI to pass, then rerun this release workflow without moving the tag.'
        );
    }

    console.info(`Release CI gate passed with run ${String(successfulRun.id)}: ${String(successfulRun.html_url)}.`);
}

/** @param {string} name */
function requireEnvironmentVariable(name) {
    const value = process.env[name];
    if (!value) fail(`Missing required environment variable ${name}.`);
    return value;
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
    if (process.env.GITHUB_ACTIONS === 'true') {
        console.error(`::error title=Release CI gate failed::${escapeGitHubAnnotation(message)}`);
    }
    throw new Error(message);
}

/** @param {string} value */
function escapeGitHubAnnotation(value) {
    return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : 'Release CI gate failed.');
        process.exitCode = 1;
    });
}

#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [tagName, githubOutputPath] = process.argv.slice(2);
const releaseTagPattern = /^(web|bot)-v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))$/;

if (!tagName) {
    fail('Missing release tag name. Pass GITHUB_REF_NAME to this script.');
}

const parsedTag = parseReleaseTag(tagName);

const existingTags = listExistingTags(parsedTag.component);
const latestPreviousTag = findLatestPreviousTag(parsedTag, existingTags);

if (latestPreviousTag && compareReleaseVersions(parsedTag.versionParts, latestPreviousTag.versionParts) <= 0) {
    fail(
        `Release tag "${parsedTag.tagName}" must be newer than latest ${parsedTag.component} tag "${latestPreviousTag.tagName}".`
    );
}

console.info(
    latestPreviousTag
        ? `Release tag accepted: ${parsedTag.tagName}; previous ${parsedTag.component} tag is ${latestPreviousTag.tagName}.`
        : `Release tag accepted: ${parsedTag.tagName}; no previous ${parsedTag.component} tag was found.`
);

if (githubOutputPath) {
    appendFileSync(
        githubOutputPath,
        [`component=${parsedTag.component}`, `version=${parsedTag.version}`, `tag_name=${parsedTag.tagName}`, ''].join(
            '\n'
        )
    );
}

function parseReleaseTag(value) {
    const parsedTag = parseExistingReleaseTag(value);

    if (!parsedTag) {
        fail(`Release tag "${value}" is invalid. Use exactly web-vX.Y.Z or bot-vX.Y.Z.`);
    }

    return parsedTag;
}

function parseExistingReleaseTag(value) {
    const match = releaseTagPattern.exec(value);

    if (!match) {
        return undefined;
    }

    return {
        tagName: value,
        component: match[1],
        version: match[2],
        versionParts: [Number(match[3]), Number(match[4]), Number(match[5])],
    };
}

function listExistingTags(component) {
    return execFileSync('git', ['tag', '--list', `${component}-v*`], {
        encoding: 'utf8',
    })
        .split(/\r?\n/)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
}

function findLatestPreviousTag(parsedTag, existingTags) {
    let latestTag;

    for (const existingTagName of existingTags) {
        const existingTag = parseExistingReleaseTag(existingTagName);

        if (
            !existingTag ||
            existingTag.component !== parsedTag.component ||
            existingTag.tagName === parsedTag.tagName
        ) {
            continue;
        }

        if (!latestTag || compareReleaseVersions(existingTag.versionParts, latestTag.versionParts) > 0) {
            latestTag = existingTag;
        }
    }

    return latestTag;
}

function compareReleaseVersions(left, right) {
    for (let index = 0; index < left.length; index += 1) {
        const difference = left[index] - right[index];

        if (difference !== 0) {
            return difference;
        }
    }

    return 0;
}

function fail(message) {
    if (process.env.GITHUB_ACTIONS) {
        console.error(`::error title=Invalid release tag::${escapeGitHubAnnotation(message)}`);
    }

    console.error(message);
    process.exit(1);
}

function escapeGitHubAnnotation(value) {
    return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

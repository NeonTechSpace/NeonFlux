import { describe, expect, it } from 'vitest';

import {
    evaluateProductionAudit,
    parseDependencyAuditExceptions,
    parseProductionAuditReport,
    type DependencyAuditException,
    type ProductionAuditReport,
} from './check-production-dependency-audit.js';

describe('production dependency audit policy', () => {
    it('requires an exact unexpired exception for every production path', () => {
        const report = createReport();
        const matching = createException();
        const result = evaluateProductionAudit(report, [matching], new Date('2026-07-27T12:00:00Z'));

        expect(result).toEqual({
            activeExceptions: [matching],
            expiredExceptions: [],
            staleExceptions: [],
            unexceptedPaths: [],
        });
    });

    it('does not let one exception suppress another path, version, package, or advisory', () => {
        const report = createReport();

        for (const exception of [
            createException({ advisoryId: 'GHSA-other' }),
            createException({ package: 'another-package' }),
            createException({ vulnerableVersion: '4.2.1' }),
            createException({ dependencyPath: 'web>another-path>js-yaml' }),
        ]) {
            const result = evaluateProductionAudit(report, [exception], new Date('2026-07-27T12:00:00Z'));
            expect(result.unexceptedPaths).toHaveLength(1);
            expect(result.staleExceptions).toEqual([exception]);
        }
    });

    it('fails closed for expired and stale exceptions while ignoring development findings', () => {
        const expired = createException({ expiresOn: '2026-07-26' });
        const report = createReport({
            findings: [{ dev: true, paths: ['workspace>dev-only>js-yaml'], version: '4.2.0' }],
        });
        const result = evaluateProductionAudit(report, [expired], new Date('2026-07-27T12:00:00Z'));

        expect(result.expiredExceptions).toEqual([expired]);
        expect(result.unexceptedPaths).toEqual([]);
    });

    it('validates audit and exception input instead of trusting scanner output', () => {
        expect(() => parseProductionAuditReport('not json')).toThrow('malformed JSON');
        expect(() => parseProductionAuditReport('{"advisories":[]}')).toThrow('advisory map');
        expect(() => parseDependencyAuditExceptions('{"version":1,"exceptions":[{}]}')).toThrow('requires advisoryId');
        expect(parseDependencyAuditExceptions('{"version":1,"exceptions":[]}')).toEqual([]);
    });
});

function createReport(
    findingOverrides: Partial<ProductionAuditReport['advisories'][string]> = {}
): ProductionAuditReport {
    return {
        advisories: {
            '123': {
                findings: [{ dev: false, paths: ['web>fumadocs>js-yaml'], version: '4.2.0' }],
                github_advisory_id: 'GHSA-example',
                module_name: 'js-yaml',
                severity: 'high',
                title: 'Example advisory',
                ...findingOverrides,
            },
        },
    };
}

function createException(overrides: Partial<DependencyAuditException> = {}): DependencyAuditException {
    return {
        advisoryId: 'GHSA-example',
        counterevidence: 'The affected parser is not reachable from untrusted input.',
        dependencyPath: 'web>fumadocs>js-yaml',
        expiresOn: '2026-08-27',
        invalidationCondition: 'Any new untrusted input path invalidates this exception.',
        owner: '@neonflux/security',
        package: 'js-yaml',
        reason: 'Temporary upstream patch wait.',
        runtimeReachability: 'Production package, affected function unreachable.',
        vulnerableVersion: '4.2.0',
        ...overrides,
    };
}

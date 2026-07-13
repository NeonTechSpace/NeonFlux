import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export function observePageDiagnostics(page: Page) {
    const errors: string[] = [];

    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    page.on('requestfailed', (request) => {
        if (isSameOrigin(request.url(), page.url())) {
            errors.push(`request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'failed'}`);
        }
    });
    page.on('response', (response) => {
        const request = response.request();
        if (
            isSameOrigin(response.url(), page.url()) &&
            ['script', 'stylesheet'].includes(request.resourceType()) &&
            response.status() >= 400
        ) {
            errors.push(`asset: ${response.status()} ${response.url()}`);
        }
    });

    return {
        assertClean() {
            expect(errors, errors.join('\n')).toEqual([]);
        },
    };
}

function isSameOrigin(candidate: string, currentPage: string): boolean {
    if (!currentPage.startsWith('http')) return true;
    return new URL(candidate).origin === new URL(currentPage).origin;
}

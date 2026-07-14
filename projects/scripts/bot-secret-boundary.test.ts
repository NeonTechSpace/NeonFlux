import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const composePath = fileURLToPath(new URL('../docker-compose.yml', import.meta.url));

describe('bot credential deployment boundary', () => {
    it('keeps the bot token and read listener private to the bot service', () => {
        const compose = readFileSync(composePath, 'utf8');
        const botService = readService(compose, 'bot');
        const webService = readService(compose, 'web');

        expect(botService).toContain('FLUXER_BOT_TOKEN:');
        expect(botService).toContain("NEONFLUX_BOT_READ_HOST: '0.0.0.0'");
        expect(botService).not.toMatch(/^ {8}ports:/mu);
        expect(webService).not.toContain('FLUXER_BOT_TOKEN');
        expect(webService).toContain('NEONFLUX_BOT_READ_URL:');
    });
});

function readService(compose: string, serviceName: string): string {
    const marker = `    ${serviceName}:`;
    const start = compose.indexOf(marker);
    if (start < 0) throw new Error(`Missing ${serviceName} service.`);

    const remainder = compose.slice(start + marker.length);
    const nextServiceOffset = remainder.search(/\n {4}(?=\S)/u);
    return compose.slice(start, nextServiceOffset < 0 ? undefined : start + marker.length + nextServiceOffset);
}

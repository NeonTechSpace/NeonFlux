import { defineConfig } from 'drizzle-kit';
import { config as loadDotEnv } from 'dotenv';

loadDotEnv();

export default defineConfig({
    dialect: 'postgresql',
    schema: './packages/db/src/schema.ts',
    out: './packages/db/drizzle',
    dbCredentials: {
        url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/neonflux_dev',
    },
});

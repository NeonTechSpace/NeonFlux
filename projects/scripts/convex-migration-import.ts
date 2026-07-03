import { signNeonFluxServiceJwt } from '../packages/convex/src/jwt.js';
import { requireConvexConfig, loadLocalEnv } from '../packages/config/src/env.js';
import { hasFlag, readRequiredArg, readTransformedBundle } from './convex-migration-support.js';

loadLocalEnv();

const inputPath = readRequiredArg('--in');
const targetDeployment = readRequiredArg('--target');
const config = requireConvexConfig();

if (targetDeployment !== config.deployment) {
    throw new Error(`Import target ${targetDeployment} does not match CONVEX_DEPLOYMENT ${config.deployment}`);
}

await readTransformedBundle(inputPath);
await signNeonFluxServiceJwt(
    {
        audience: config.authJwtAudience,
        issuer: config.authJwtIssuer,
        privateKeyPem: config.authJwtPrivateKey,
    },
    {
        serviceName: 'migration',
    }
);

if (hasFlag('--backup-and-replace')) {
    process.stderr.write('backup-and-replace was acknowledged, but no Convex import function exists yet.\n');
}

throw new Error('Refusing to write: Convex migration import function is implemented in phase 6.');

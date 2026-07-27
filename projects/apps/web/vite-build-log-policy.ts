type BuildLog = {
    id?: string;
    message: string;
    plugin?: string;
};

const shikiOnigurumaWasmPath = '/node_modules/.pnpm/shiki@4.2.0/node_modules/shiki/dist/onig.wasm';
const shikiOnigurumaFallbackMessage =
    'Failed to load the WebAssembly module; falling back to module mode: Cannot resolve module "env"';

export function enforceBuildLogPolicy<TLevel extends string, TLog extends BuildLog>(
    level: TLevel,
    log: TLog,
    defaultHandler: (level: TLevel, log: TLog) => void
): void {
    if (shouldSuppressExpectedBuildLog(level, log)) return;
    if (level === 'warn') {
        const source = [log.plugin, log.id].filter(Boolean).join(' · ');
        throw new Error(`Unexpected production build warning${source ? ` (${source})` : ''}: ${log.message}`);
    }

    defaultHandler(level, log);
}

export function shouldSuppressExpectedBuildLog(level: string, log: BuildLog): boolean {
    if (level !== 'warn' || log.plugin !== 'unwasm' || typeof log.id !== 'string') return false;

    // Shiki's pinned Oniguruma module imports an `env` namespace that its runtime supplies.
    // unwasm therefore preserves the module instead of pre-instantiating it; this is the supported runtime path.
    return (
        log.id.replaceAll('\\', '/').endsWith(shikiOnigurumaWasmPath) &&
        log.message.startsWith(shikiOnigurumaFallbackMessage)
    );
}

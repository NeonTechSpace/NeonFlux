export function assertNoArgs(args: readonly string[] = process.argv.slice(2)): void {
    for (const arg of args) {
        if (arg === '--') {
            continue;
        }

        throw new Error(`Unexpected argument: ${arg}`);
    }
}

export function canonicalJsonStringify(value: unknown): string {
    const ancestors = new Set<object>();

    return serializeCanonicalJson(value, '$', ancestors);
}

function serializeCanonicalJson(value: unknown, path: string, ancestors: Set<object>): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw unsupported(path, 'non-finite number');
        return JSON.stringify(value);
    }
    if (typeof value !== 'object') throw unsupported(path, typeof value);
    if (ancestors.has(value)) throw unsupported(path, 'circular reference');

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return `[${Array.from(value, (item, index) =>
                serializeCanonicalJson(item, `${path}[${String(index)}]`, ancestors)
            ).join(',')}]`;
        }

        const prototype = Reflect.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw unsupported(path, 'non-plain object');
        }
        if (Object.getOwnPropertySymbols(value).length > 0) throw unsupported(path, 'symbol property');

        const entries = Object.keys(value)
            .sort(compareJsonKeys)
            .map((key) => {
                const item = (value as Record<string, unknown>)[key];
                return `${JSON.stringify(key)}:${serializeCanonicalJson(item, `${path}.${key}`, ancestors)}`;
            });
        return `{${entries.join(',')}}`;
    } finally {
        ancestors.delete(value);
    }
}

function compareJsonKeys(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function unsupported(path: string, type: string): TypeError {
    return new TypeError(`Canonical JSON does not support ${type} at ${path}.`);
}

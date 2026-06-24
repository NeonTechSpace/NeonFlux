export type PublicDocsTocItem = {
    title: string;
    url: string;
    depth: number;
    _step?: number;
};

export function serializeTableOfContents(toc: unknown): PublicDocsTocItem[] {
    if (!Array.isArray(toc)) {
        return [];
    }

    return toc.flatMap((item): PublicDocsTocItem[] => {
        if (!item || typeof item !== 'object') {
            return [];
        }

        const record = item as Record<string, unknown>;
        const title = serializeTocTitle(record.title);

        if (!title || typeof record.url !== 'string' || typeof record.depth !== 'number') {
            return [];
        }

        return [
            {
                title,
                url: record.url,
                depth: record.depth,
                ...(typeof record._step === 'number' ? { _step: record._step } : {}),
            },
        ];
    });
}

function serializeTocTitle(title: unknown): string | undefined {
    const text = serializeTocTitleText(title)?.trim();

    return text ? text : undefined;
}

function serializeTocTitleText(title: unknown): string | undefined {
    switch (typeof title) {
        case 'string':
            return title;

        case 'number':
        case 'bigint':
            return String(title);

        case 'object':
            if (title === null) {
                return undefined;
            }

            if (Array.isArray(title)) {
                return title
                    .map((part) => serializeTocTitleText(part))
                    .filter((part): part is string => typeof part === 'string')
                    .join('');
            }

            return serializeTocReactElementTitle(title);

        default:
            return undefined;
    }
}

function serializeTocReactElementTitle(title: object): string | undefined {
    if (!('props' in title) || !title.props || typeof title.props !== 'object' || !('children' in title.props)) {
        return undefined;
    }

    return serializeTocTitleText(title.props.children);
}

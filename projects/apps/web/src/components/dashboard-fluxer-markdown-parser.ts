import { SimpleMarkdown, rulesExtended } from 'discord-markdown-parser';

export type DashboardMarkdownContext = 'embed' | 'inline' | 'standard';

export type DashboardMarkdownNode = {
    type: string;
    content?: string | DashboardMarkdownNode[];
    align?: Array<'center' | 'left' | 'right' | null>;
    animated?: boolean;
    cells?: DashboardMarkdownNode[][][];
    format?: string;
    fullName?: string;
    header?: DashboardMarkdownNode[][];
    id?: string;
    items?: DashboardMarkdownNode[][];
    lang?: string;
    level?: number;
    name?: string;
    navigation?: string;
    ordered?: boolean;
    roleId?: string | null;
    start?: number;
    target?: string;
    timestamp?: string;
    title?: string;
};

export type DashboardMarkdownParseResult =
    | { type: 'parsed'; nodes: DashboardMarkdownNode[] }
    | { type: 'plain'; reason: 'failed' | 'too-long' };

export const dashboardMarkdownMaximumLength = 6_000;

const defaultRules = SimpleMarkdown.defaultRules;
type MarkdownParserRule = (typeof rulesExtended)[string];
const inlineRules = Object.fromEntries(
    Object.entries(rulesExtended).filter(([ruleName]) => !['blockQuote', 'heading', 'subtext'].includes(ruleName))
);
const inlineParser = SimpleMarkdown.parserFor(inlineRules);
const blockQuoteRule: MarkdownParserRule = {
    ...rulesExtended.blockQuote,
    parse: (capture, _parse, state) =>
        rulesExtended.blockQuote.parse(capture, (nestedSource) => inlineParser(nestedSource, { inline: true }), state),
};
const codeBlockRule: MarkdownParserRule = {
    ...rulesExtended.codeBlock,
    match: (source, state, previousCapture) =>
        rulesExtended.codeBlock.match(source, { ...state, inline: true }, previousCapture),
};
const headingRule: MarkdownParserRule = {
    ...rulesExtended.heading,
    match: (source, state, previousCapture) =>
        rulesExtended.heading.match(source, { ...state, prevCapture: null }, previousCapture),
};
const subtextRule: MarkdownParserRule = {
    ...rulesExtended.subtext,
    match: (source, state, previousCapture) =>
        rulesExtended.subtext.match(source, { ...state, prevCapture: null }, previousCapture),
};
const sharedBlockRules = {
    ...rulesExtended,
    blockQuote: blockQuoteRule,
    codeBlock: codeBlockRule,
    heading: headingRule,
    paragraph: defaultRules.paragraph,
    list: defaultRules.list,
    subtext: subtextRule,
};
const standardParser = SimpleMarkdown.parserFor({
    ...sharedBlockRules,
    nptable: defaultRules.nptable,
    table: defaultRules.table,
    tableSeparator: defaultRules.tableSeparator,
});
const embedParser = SimpleMarkdown.parserFor(sharedBlockRules);

export function parseDashboardMarkdown(
    source: string,
    context: DashboardMarkdownContext
): DashboardMarkdownParseResult {
    if (source.length > dashboardMarkdownMaximumLength) {
        return { type: 'plain', reason: 'too-long' };
    }

    try {
        const blockSource = context === 'inline' ? source : normalizeBlockBoundaries(source);
        const nodes =
            context === 'inline'
                ? inlineParser(blockSource, { inline: true })
                : context === 'embed'
                  ? embedParser(blockSource, { inline: false })
                  : standardParser(blockSource, { inline: false });

        return { type: 'parsed', nodes };
    } catch {
        return { type: 'plain', reason: 'failed' };
    }
}

type BlockKind = 'blockquote' | 'fence' | 'heading' | 'list' | 'paragraph' | 'subtext' | 'table';

function normalizeBlockBoundaries(source: string): string {
    const lines = source.split('\n');
    const normalized: string[] = [];
    let fenceMarker: '```' | '~~~' | undefined;
    let previousKind: BlockKind | undefined;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';

        if (fenceMarker) {
            normalized.push(line);
            if (line.trimStart().startsWith(fenceMarker)) {
                fenceMarker = undefined;
                previousKind = 'fence';
            }
            continue;
        }

        if (!line.trim()) {
            normalized.push(line);
            previousKind = undefined;
            continue;
        }

        const nextLine = lines[index + 1];
        const kind = classifyBlockLine(line, nextLine, previousKind);
        if (kind !== previousKind && previousKind !== undefined && normalized.at(-1)?.trim()) {
            normalized.push('');
        }
        normalized.push(line);
        previousKind = kind;

        const markerMatch = /^\s{0,3}(```|~~~)/u.exec(line);
        if (markerMatch?.[1]) {
            fenceMarker = markerMatch[1] as '```' | '~~~';
        }

        if (/^\s{0,3}>>>/u.test(line)) {
            normalized.push(...lines.slice(index + 1));
            break;
        }
    }

    return normalized.join('\n');
}

function classifyBlockLine(line: string, nextLine: string | undefined, previousKind: BlockKind | undefined): BlockKind {
    if (/^\s{0,3}(```|~~~)/u.test(line)) return 'fence';
    if (/^\s{0,3}>/u.test(line)) return 'blockquote';
    if (/^\s{0,3}#{1,6}\s/u.test(line)) return 'heading';
    if (/^\s{0,3}-#\s/u.test(line)) return 'subtext';
    if (/^\s{0,3}(?:[-+*]|\d+[.)])\s+/u.test(line)) return 'list';
    if (previousKind === 'list' && /^\s+\S/u.test(line)) return 'list';
    if (isTableSeparator(line) || (line.includes('|') && nextLine !== undefined && isTableSeparator(nextLine))) {
        return 'table';
    }
    if (previousKind === 'table' && line.includes('|')) return 'table';
    return 'paragraph';
}

function isTableSeparator(line: string): boolean {
    return /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/u.test(line);
}

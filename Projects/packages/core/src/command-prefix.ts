import { err, ok, type Result } from 'neverthrow';

export const DEFAULT_COMMAND_PREFIX = '!';

export const COMMAND_PREFIX_INVALID_MESSAGE =
    'Prefix must be 1-3 visible characters, start with an allowed symbol, and avoid spaces or Fluxer-reserved characters like /, @, #, <, >, or :.';

const reservedCommandPrefixCharacters = new Set(['/', '@', '#', '<', '>', ':']);

export type CommandPrefixValidationError = 'invalid-prefix';

export function normalizeCommandPrefix(prefix: string): Result<string, CommandPrefixValidationError> {
    const normalizedPrefix = prefix.trim();
    const prefixCharacters = Array.from(normalizedPrefix);
    const [firstCharacter] = prefixCharacters;

    if (prefixCharacters.length < 1 || prefixCharacters.length > 3 || firstCharacter === undefined) {
        return err('invalid-prefix');
    }

    if (!isAllowedLeadingCommandPrefixCharacter(firstCharacter)) {
        return err('invalid-prefix');
    }

    if (!prefixCharacters.every(isAllowedCommandPrefixCharacter)) {
        return err('invalid-prefix');
    }

    return ok(normalizedPrefix);
}

export function isValidCommandPrefix(prefix: string): boolean {
    return normalizeCommandPrefix(prefix).isOk();
}

function isAllowedLeadingCommandPrefixCharacter(character: string): boolean {
    return isVisibleSymbolOrPunctuation(character) && !reservedCommandPrefixCharacters.has(character);
}

function isAllowedCommandPrefixCharacter(character: string): boolean {
    return (
        !reservedCommandPrefixCharacters.has(character) &&
        !isInvisibleCommandPrefixCharacter(character) &&
        /^[\p{L}\p{N}\p{P}\p{S}]$/u.test(character)
    );
}

function isVisibleSymbolOrPunctuation(character: string): boolean {
    return !isInvisibleCommandPrefixCharacter(character) && /^[\p{P}\p{S}]$/u.test(character);
}

function isInvisibleCommandPrefixCharacter(character: string): boolean {
    return /^[\p{C}\p{Z}]$/u.test(character);
}

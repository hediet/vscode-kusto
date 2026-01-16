/**
 * Parser for enum values from documentation and context detection for enum completions.
 * 
 * Enum values are specified in column documentation using the @enum-variant annotation:
 * ```
 * // status code
 * // @enum-variant "pending" Is still pending
 * // @enum-variant "active" Currently active
 * | extend status = tostring(Properties["status"])
 * ```
 */

/**
 * An enum variant with its value and optional description.
 */
export interface EnumVariant {
    /** The enum value */
    readonly value: string;
    /** Optional description for this variant */
    readonly description?: string;
}

/**
 * Result of parsing a comparison context (e.g., `columnName == "`).
 */
export interface ComparisonContext {
    /** The identifier being compared */
    readonly identifier: string;
    /** Offset where the identifier starts */
    readonly identifierOffset: number;
    /** The prefix already typed inside the quotes (may be empty) */
    readonly typedPrefix: string;
    /** Offset where the string value starts (after the opening quote) */
    readonly valueOffset: number;
}

/**
 * Detect if the cursor is inside a comparison pattern: `identifier == "prefix`
 * 
 * @param text The document text
 * @param offset The cursor offset
 * @returns ComparisonContext if we're in a comparison, null otherwise
 */
export function detectComparisonContext(text: string, offset: number): ComparisonContext | null {
    // We need to find: identifier == "prefix
    // where the cursor (offset) is after the opening quote

    // First, scan backwards from offset to find the opening quote
    let quotePos = -1;
    for (let i = offset - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === '"') {
            quotePos = i;
            break;
        }
        // Stop if we hit a newline or closing quote (we're not in a string)
        if (ch === '\n' || ch === '\r') {
            return null;
        }
    }

    if (quotePos === -1) {
        return null;
    }

    // The typed prefix is what's between the quote and the cursor
    const typedPrefix = text.substring(quotePos + 1, offset);

    // Now scan backwards from the quote to find "=="
    let pos = quotePos - 1;

    // Skip whitespace
    while (pos >= 0 && /\s/.test(text[pos])) {
        pos--;
    }

    // Check for "==" (we check in reverse: '=' then '=')
    if (pos < 1 || text[pos] !== '=' || text[pos - 1] !== '=') {
        return null;
    }
    pos -= 2; // Skip past "=="

    // Skip whitespace
    while (pos >= 0 && /\s/.test(text[pos])) {
        pos--;
    }

    // Now we should be at the end of an identifier
    // Identifier can be: [a-zA-Z_][a-zA-Z0-9_]*
    if (pos < 0 || !/[a-zA-Z0-9_]/.test(text[pos])) {
        return null;
    }

    // Scan backwards to find start of identifier
    let identifierEnd = pos + 1;
    while (pos >= 0 && /[a-zA-Z0-9_]/.test(text[pos])) {
        pos--;
    }
    let identifierStart = pos + 1;

    const identifier = text.substring(identifierStart, identifierEnd);

    // Validate it's a proper identifier (starts with letter or underscore)
    if (!/^[a-zA-Z_]/.test(identifier)) {
        return null;
    }

    return {
        identifier,
        identifierOffset: identifierStart,
        typedPrefix,
        valueOffset: quotePos + 1,
    };
}

/**
 * Extract enum variants from documentation string.
 * 
 * Format: `@enum-variant "value" Optional description`
 * 
 * @param documentation The documentation string (may contain markdown)
 * @returns Array of enum variants, or null if no @enum-variant annotations found
 */
export function extractEnumVariants(documentation: string | null | undefined): EnumVariant[] | null {
    if (!documentation) {
        return null;
    }

    // Match all @enum-variant "value" optional description patterns
    // The value is in double quotes, followed by optional description text (until end of line)
    // [ \t] = horizontal whitespace only (not newlines)
    const pattern = /@enum-variant[ \t]+"([^"]+)"(?:[ \t]+([^\n]+))?/g;
    const variants: EnumVariant[] = [];

    let match;
    while ((match = pattern.exec(documentation)) !== null) {
        const value = match[1];
        const description = match[2]?.trim();

        variants.push({
            value,
            ...(description && { description }),
        });
    }

    return variants.length > 0 ? variants : null;
}

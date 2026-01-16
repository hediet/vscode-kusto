import { OffsetRange } from '../common/offsetRange';
import { extractDocumentation } from './resolvedDocumentAdapter';

/**
 * Comprehensive information about a definition (let $name = ...).
 * Computed once per fragment, used by hover, completions, and go-to-definition.
 */
export interface DefinitionInfo {
    /** The definition name, e.g., "$events.query" */
    readonly name: string;

    /** URI of the document containing this definition */
    readonly uri: string;

    /** Range of the definition name within the document */
    readonly nameRange: OffsetRange;

    /** Range of the entire fragment */
    readonly fullRange: OffsetRange;

    /** Documentation extracted from comments (inline or above) */
    readonly documentation: string | null;

    /** The body expression (after "let $name = ") */
    readonly body: string;
}

/**
 * Extract DefinitionInfo from a fragment's text.
 * 
 * @param text The full document text
 * @param fragmentText The fragment text
 * @param fragmentStart The offset where the fragment starts in the document
 * @param exportedName The exported name (e.g., "$events.query")
 * @param uri The document URI
 */
export function extractDefinitionInfo(
    text: string,
    fragmentText: string,
    fragmentStart: number,
    exportedName: string,
    uri: string
): DefinitionInfo {
    // Find where the name appears in the fragment
    // Pattern: let $name = body
    const escapedName = exportedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const letPattern = new RegExp(`let\\s+(${escapedName})\\s*=\\s*`);
    const match = fragmentText.match(letPattern);

    let nameRange: OffsetRange;
    let body: string;

    if (match && match.index !== undefined) {
        // Found "let $name = "
        const nameStartInFragment = match.index + match[0].indexOf(exportedName);
        const nameStart = fragmentStart + nameStartInFragment;
        nameRange = new OffsetRange(nameStart, nameStart + exportedName.length);

        // Body is everything after "let $name = "
        const bodyStart = match.index + match[0].length;
        body = fragmentText.substring(bodyStart).trim();
    } else {
        // Fallback: assume name is at start of fragment
        const nameStart = fragmentText.indexOf(exportedName);
        if (nameStart !== -1) {
            nameRange = new OffsetRange(
                fragmentStart + nameStart,
                fragmentStart + nameStart + exportedName.length
            );
        } else {
            nameRange = new OffsetRange(fragmentStart, fragmentStart + exportedName.length);
        }
        body = fragmentText;
    }

    // Extract documentation from the fragment
    const documentation = extractDocumentation(text, nameRange.start);

    return {
        name: exportedName,
        uri,
        nameRange,
        fullRange: new OffsetRange(fragmentStart, fragmentStart + fragmentText.length),
        documentation,
        body,
    };
}

/**
 * Parse a definition reference to extract the name being referenced.
 * Handles both simple ($events) and dotted ($events.query.sub) names.
 * 
 * @param text The text to search
 * @param offset The cursor offset
 * @returns The definition name at that position, or null
 */
export function getDefinitionNameAtOffset(text: string, offset: number): string | null {
    // Find the word boundaries around the offset
    // Definition names are: $[a-zA-Z][a-zA-Z0-9_.]*

    // Scan backwards to find start of definition name (find the $)
    let start = offset;
    while (start > 0) {
        const ch = text[start - 1];
        if (ch === '$' || /[a-zA-Z0-9_.]/.test(ch)) {
            start--;
        } else {
            break;
        }
    }

    // Check if start points to $
    if (text[start] !== '$') {
        return null;
    }

    // Scan forwards from start to find end of the definition name
    let end = start + 1; // skip the $
    while (end < text.length) {
        const ch = text[end];
        if (/[a-zA-Z0-9_.]/.test(ch)) {
            end++;
        } else {
            break;
        }
    }

    const name = text.substring(start, end);

    // Validate: must be $[letter][alphanumeric/dot/underscore]*
    if (!/^\$[a-zA-Z][a-zA-Z0-9_.]*$/.test(name)) {
        return null;
    }

    return name;
}

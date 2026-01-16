import { DocumentOffset } from '../common/documentOffset';
import { ResolvedKustoDocument } from './resolvedKustoDocument';
import {
    KustoLanguageService,
    CompletionItem, SemanticToken,
    Hover,
    RelatedElement
} from '../kusto';

/** Diagnostic with document-space range. */
export interface DiagnosticWithDocumentRange {
    readonly message: string;
    readonly severity: 'error' | 'warning' | 'info' | 'suggestion';
    readonly location: DocumentOffset;
    readonly length: number;
}

/** Semantic token with document-space range. */
export interface SemanticTokenWithDocumentRange {
    readonly location: DocumentOffset;
    readonly length: number;
    readonly type: SemanticToken['type'];
}

/** Related element with document-space range. */
export interface RelatedElementWithDocumentRange {
    readonly location: DocumentOffset;
    readonly length: number;
    readonly kind: RelatedElement['kind'];
}

/** Related info with document-space ranges. */
export interface RelatedInfoWithDocumentRange {
    readonly elements: readonly RelatedElementWithDocumentRange[];
    readonly currentIndex: number;
}

/** Provider for source document text. */
export interface SourceTextProvider {
    /** Get the source text for a document URI. */
    getSourceText(uri: string): string | undefined;
}

/**
 * Adapter that bridges ResolvedKustoDocument to KustoLanguageService.
 * Handles coordinate translation between document offsets and resolved text offsets.
 */
export class ResolvedDocumentAdapter {
    constructor(
        private readonly resolved: ResolvedKustoDocument,
        private readonly service: KustoLanguageService,
        private readonly sourceTextProvider?: SourceTextProvider
    ) { }

    /** Get the resolved text (for debugging/display). */
    get text(): string {
        return this.resolved.virtualText;
    }

    /**
     * Get completions at a document offset.
     * Returns completions from the language service.
     */
    getCompletions(docOffset: DocumentOffset): CompletionItem[] {
        const textOffset = this.resolved.sourceMap.fromDocumentOffset(docOffset, true);
        if (textOffset === undefined) {
            return [];
        }
        return this.service.getCompletions(this.resolved.virtualText, textOffset);
    }

    /**
     * Get all diagnostics, mapped back to document coordinates.
     * Only returns diagnostics that map back to the source documents.
     */
    getDiagnostics(): DiagnosticWithDocumentRange[] {
        const diagnostics = this.service.getDiagnostics(this.resolved.virtualText);
        const result: DiagnosticWithDocumentRange[] = [];

        for (const diag of diagnostics) {
            const location = this.resolved.sourceMap.toDocumentOffset(diag.range.start);
            if (location) {
                // Calculate length in document space
                // For simplicity, use same length (works for 1:1 mappings within a segment)
                result.push({
                    message: diag.message,
                    severity: diag.severity,
                    location,
                    length: diag.range.length,
                });
            }
        }

        return result;
    }

    /**
     * Get semantic tokens, mapped back to document coordinates.
     * Only returns tokens that map back to the source documents.
     */
    getSemanticTokens(): SemanticTokenWithDocumentRange[] {
        const tokens = this.service.getSemanticTokens(this.resolved.virtualText);
        const result: SemanticTokenWithDocumentRange[] = [];

        for (const token of tokens) {
            const location = this.resolved.sourceMap.toDocumentOffset(token.range.start);
            if (location) {
                result.push({
                    location,
                    length: token.range.length,
                    type: token.type,
                });
            }
        }

        return result;
    }

    /**
     * Get hover information at a document offset.
     * Enhances Kusto's hover with documentation extracted from comments at the declaration site.
     */
    getHover(docOffset: DocumentOffset): Hover | null {
        const textOffset = this.resolved.sourceMap.fromDocumentOffset(docOffset, true);
        if (textOffset === undefined) {
            return null;
        }

        const hover = this.service.getHover(this.resolved.virtualText, textOffset);
        if (!hover) {
            return null;
        }

        // Try to find documentation from the declaration site
        const documentation = this._getDocumentationForSymbol(textOffset);
        if (documentation) {
            return {
                contents: hover.contents + '\n\n' + documentation,
                range: hover.range,
            };
        }

        return hover;
    }

    /**
     * Extract documentation from comments at the declaration site of a symbol.
     * Uses getRelatedElements to find the declaration, then extracts comments.
     */
    private _getDocumentationForSymbol(textOffset: number): string | null {
        if (!this.sourceTextProvider) {
            return null;
        }

        // Find the declaration
        const relatedInfo = this.service.getRelatedElements(this.resolved.virtualText, textOffset);
        if (!relatedInfo) {
            return null;
        }

        // Find declaration elements
        const declarations = relatedInfo.elements.filter(el => el.kind === 'declaration');
        if (declarations.length === 0) {
            return null;
        }

        // Use the first declaration
        const decl = declarations[0];
        const declLocation = this.resolved.sourceMap.toDocumentOffset(decl.start);
        if (!declLocation) {
            return null;
        }

        // Get the source text
        const sourceText = this.sourceTextProvider.getSourceText(declLocation.uri);
        if (!sourceText) {
            return null;
        }

        return extractDocumentation(sourceText, declLocation.offset);
    }

    /**
     * Get diagnostics filtered to a specific document URI.
     */
    getDiagnosticsForDocument(uri: string): DiagnosticWithDocumentRange[] {
        return this.getDiagnostics().filter(d => d.location.uri === uri);
    }

    /**
     * Get semantic tokens filtered to a specific document URI.
     */
    getSemanticTokensForDocument(uri: string): SemanticTokenWithDocumentRange[] {
        return this.getSemanticTokens().filter(t => t.location.uri === uri);
    }

    /**
     * Get related elements (definitions, references) at a document offset.
     * Returns elements mapped back to document coordinates.
     */
    getRelatedElements(docOffset: DocumentOffset): RelatedInfoWithDocumentRange | null {
        const textOffset = this.resolved.sourceMap.fromDocumentOffset(docOffset, true);
        if (textOffset === undefined) {
            return null;
        }

        const relatedInfo = this.service.getRelatedElements(this.resolved.virtualText, textOffset);
        if (!relatedInfo) {
            return null;
        }

        const elements: RelatedElementWithDocumentRange[] = [];
        for (const el of relatedInfo.elements) {
            const location = this.resolved.sourceMap.toDocumentOffset(el.start);
            if (location) {
                // Calculate length in document space by mapping the end position too
                // The length in virtual space may differ from document space due to source map transformations
                const endLocation = this.resolved.sourceMap.toDocumentOffset(el.start + el.length - 1);
                const length = (endLocation && endLocation.uri === location.uri)
                    ? endLocation.offset - location.offset + 1
                    : el.length;

                elements.push({
                    location,
                    length,
                    kind: el.kind,
                });
            }
        }

        // Recalculate currentIndex based on which elements survived mapping
        // The original currentIndex may not be valid after filtering
        let newCurrentIndex = -1;
        for (let i = 0; i < relatedInfo.elements.length; i++) {
            const el = relatedInfo.elements[i];
            const location = this.resolved.sourceMap.toDocumentOffset(el.start);
            if (location && i === relatedInfo.currentIndex) {
                newCurrentIndex = elements.findIndex(
                    e => e.location.uri === location.uri && e.location.offset === location.offset
                );
                break;
            }
        }

        return {
            elements,
            currentIndex: newCurrentIndex >= 0 ? newCurrentIndex : 0,
        };
    }
}

/**
 * Extract documentation from comments at a declaration site.
 * 
 * Looks for:
 * 1. Inline comment at the end of the line containing the offset: `| extend col = expr // docs`
 * 2. Comment lines directly above the declaration line
 * 
 * @param text The source document text
 * @param offset The offset of the declaration (where the symbol name starts)
 * @returns The extracted documentation string, or null if none found
 */
export function extractDocumentation(text: string, offset: number): string | null {
    // Find the line containing the offset
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1; // after \n, or 0 if not found
    const lineEnd = text.indexOf('\n', offset);
    const line = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd);

    // Check for inline comment on this line
    const inlineCommentMatch = line.match(/\/\/\s*(.+?)\s*$/);
    if (inlineCommentMatch) {
        return inlineCommentMatch[1];
    }

    // Check for comment lines above
    const commentLines: string[] = [];
    let searchPos = lineStart - 1; // position before the \n

    while (searchPos > 0) {
        // Find the start of the previous line
        const prevLineStart = text.lastIndexOf('\n', searchPos - 1) + 1;
        const prevLine = text.substring(prevLineStart, searchPos);

        // Check if this line is a pure comment (only whitespace before //)
        const commentMatch = prevLine.match(/^\s*\/\/\s?(.*)$/);
        if (commentMatch) {
            commentLines.unshift(commentMatch[1]);
            searchPos = prevLineStart - 1;
        } else {
            // Not a comment line, stop searching
            break;
        }
    }

    if (commentLines.length > 0) {
        return commentLines.join('\n');
    }

    return null;
}

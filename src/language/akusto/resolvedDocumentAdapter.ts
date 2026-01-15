import { DocumentOffset } from '../common/documentOffset';
import { ResolvedKustoDocument } from './resolvedKustoDocument';
import {
    KustoLanguageService,
    CompletionItem, SemanticToken,
    Hover
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

/**
 * Adapter that bridges ResolvedKustoDocument to KustoLanguageService.
 * Handles coordinate translation between document offsets and resolved text offsets.
 */
export class ResolvedDocumentAdapter {
    constructor(
        private readonly resolved: ResolvedKustoDocument,
        private readonly service: KustoLanguageService
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
        const textOffset = this.resolved.sourceMap.fromDocumentOffset(docOffset);
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
     */
    getHover(docOffset: DocumentOffset): Hover | null {
        const textOffset = this.resolved.sourceMap.fromDocumentOffset(docOffset);
        if (textOffset === undefined) {
            return null;
        }
        return this.service.getHover(this.resolved.virtualText, textOffset);
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
}

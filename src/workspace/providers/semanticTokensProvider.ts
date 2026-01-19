import * as vscode from 'vscode';
import { Disposable } from '../../utils/disposables';
import { MutableProject } from '../../language/workspace/mutableProject';
import { ResolvedDocumentAdapter } from '../../language/akusto/resolvedDocumentAdapter';
import { getLanguageServiceForInstructions } from '../languageServiceResolver';
import { SemanticTokenType } from '../../language/kusto/kustoLanguageService';

/**
 * Token types for semantic highlighting.
 * These map to VS Code's standard semantic token types where possible.
 */
const TOKEN_TYPES: SemanticTokenType[] = [
    'keyword',
    'function',
    'variable',
    'string',
    'number',
    'comment',
    'operator',
    'type',
    'table',
    'column',
    'parameter',
];

/** No modifiers for now */
const TOKEN_MODIFIERS: string[] = [];

/** The legend shared between provider and VS Code */
export const SEMANTIC_TOKENS_LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);

/**
 * Provides semantic tokens for Kusto documents.
 * Uses the Kusto language service to get classification info.
 */
export class SemanticTokensProvider extends Disposable implements vscode.DocumentSemanticTokensProvider {
    constructor(private readonly model: MutableProject) {
        super();

        // Register semantic tokens provider
        this._register(vscode.languages.registerDocumentSemanticTokensProvider(
            [{ language: 'kusto' }, { pattern: '**/*.kql' }, { pattern: '**/*.csl' }],
            this,
            SEMANTIC_TOKENS_LEGEND
        ));
    }

    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.SemanticTokens | null {
        const startTime = performance.now();
        const uri = document.uri.toString();

        // Get current document from model
        const doc = this.model.documents.get().get(uri);
        const project = this.model.project.get();

        if (!doc) {
            return null;
        }

        try {
            const builder = new vscode.SemanticTokensBuilder(SEMANTIC_TOKENS_LEGEND);

            // Collect tokens from all fragments (including definitions)
            const allTokens: Array<{ offset: number; length: number; type: SemanticTokenType }> = [];

            for (const fragment of doc.fragments) {
                try {
                    const resolved = project.resolve(doc, fragment);
                    const service = getLanguageServiceForInstructions(resolved.instructions);
                    const adapter = new ResolvedDocumentAdapter(resolved, service);

                    // Get tokens for this document only
                    const fragmentTokens = adapter.getSemanticTokensForDocument(uri);

                    for (const token of fragmentTokens) {
                        allTokens.push({
                            offset: token.location.offset,
                            length: token.length,
                            type: token.type,
                        });
                    }
                } catch (e) {
                    // Skip fragments that fail to resolve
                }
            }

            // Sort tokens by offset (required for SemanticTokensBuilder)
            allTokens.sort((a, b) => a.offset - b.offset);

            // Convert offset-based tokens to line/character positions
            for (const token of allTokens) {
                const startPos = document.positionAt(token.offset);
                const endPos = document.positionAt(token.offset + token.length);

                // Semantic tokens must be single-line; split multi-line tokens
                if (startPos.line === endPos.line) {
                    builder.push(
                        new vscode.Range(startPos, endPos),
                        token.type,
                        []
                    );
                } else {
                    // For multi-line tokens (e.g., multi-line strings), just use first line
                    const lineEnd = document.lineAt(startPos.line).range.end;
                    builder.push(
                        new vscode.Range(startPos, lineEnd),
                        token.type,
                        []
                    );
                }
            }

            const totalTime = performance.now() - startTime;
            if (totalTime > 100) {
                console.log(`[SemanticTokens] Slow: ${totalTime.toFixed(0)}ms for ${allTokens.length} tokens`);
            }

            return builder.build();
        } catch (e) {
            console.error('SemanticTokensProvider: Error getting tokens:', e);
            return null;
        }
    }
}

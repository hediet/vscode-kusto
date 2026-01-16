import * as vscode from 'vscode';
import { Disposable } from '../utils/disposables';
import { MutableProject } from '../language/workspace/mutableProject';
import { CompletionKind } from '../language/kusto/kustoLanguageService';
import { ResolvedDocumentAdapter, SourceTextProvider, extractDocumentation } from '../language/akusto/resolvedDocumentAdapter';
import { DocumentOffset } from '../language/common/documentOffset';
import { getLanguageServiceForInstructions } from './languageServiceResolver';
import { ResolvedKustoDocument } from '../language/akusto/resolvedKustoDocument';
import { KustoLanguageService } from '../language/kusto/kustoLanguageService';

/**
 * Source text provider that reads from the MutableProject's documents.
 */
class ProjectSourceTextProvider implements SourceTextProvider {
    constructor(private readonly model: MutableProject) { }

    getSourceText(uri: string): string | undefined {
        const doc = this.model.documents.get().get(uri);
        return doc?.text;
    }
}

/**
 * Provides completions for Kusto documents.
 * Uses schema-aware language service when connection is configured.
 */
export class CompletionProvider extends Disposable implements vscode.CompletionItemProvider {
    private readonly sourceTextProvider: SourceTextProvider;

    // Cache for resolveCompletionItem - stores the most recent completion context
    private _lastCompletionContext: {
        uri: string;
        resolved: ResolvedKustoDocument;
        service: KustoLanguageService;
    } | null = null;

    constructor(private readonly model: MutableProject) {
        super();

        this.sourceTextProvider = new ProjectSourceTextProvider(model);

        // Register completion provider
        this._register(vscode.languages.registerCompletionItemProvider(
            [{ language: 'kusto' }, { pattern: '**/*.kql' }, { pattern: '**/*.csl' }],
            this,
            '.', '|', ' ', '(' // trigger characters
        ));
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.CompletionItem[] {
        const startTime = performance.now();
        const uri = document.uri.toString();
        const offset = document.offsetAt(position);

        // Skip Kusto completions if user is typing a $definition reference
        // (DefinitionCompletionProvider handles those)
        const lineText = document.lineAt(position).text;
        const textBeforeCursor = lineText.substring(0, position.character);
        if (/\$[a-zA-Z0-9_.]*$/.test(textBeforeCursor)) {
            return [];
        }

        // Get current document and project state
        const doc = this.model.documents.get().get(uri);
        const project = this.model.project.get();

        if (!doc) {
            return [];
        }

        // Find the fragment at the cursor position
        const fragment = doc.getFragmentAt(offset);
        if (!fragment) {
            return [];
        }

        try {
            // Resolve the fragment
            const resolveStart = performance.now();
            const resolved = project.resolve(doc, fragment);
            const resolveTime = performance.now() - resolveStart;

            // Get the appropriate language service (with schema if available)
            const serviceStart = performance.now();
            const service = getLanguageServiceForInstructions(resolved.instructions);
            const serviceTime = performance.now() - serviceStart;

            // Cache for resolveCompletionItem
            this._lastCompletionContext = { uri, resolved, service };

            const adapterStart = performance.now();
            const adapter = new ResolvedDocumentAdapter(resolved, service, this.sourceTextProvider);
            const completions = adapter.getCompletions(new DocumentOffset(uri, offset));
            const adapterTime = performance.now() - adapterStart;

            const totalTime = performance.now() - startTime;
            if (totalTime > 100) {
                console.log(`[Completions] Slow: ${totalTime.toFixed(0)}ms (resolve: ${resolveTime.toFixed(0)}ms, service: ${serviceTime.toFixed(0)}ms, completions: ${adapterTime.toFixed(0)}ms) - ${completions.length} items`);
            }

            // Convert to VS Code completion items with smart sorting
            // Columns appear first, then variables, then other items
            return completions.map(item => {
                const vsItem = new vscode.CompletionItem(item.label, this._mapKind(item.kind));
                if (item.detail) {
                    vsItem.detail = item.detail;
                }
                if (item.documentation) {
                    vsItem.documentation = item.documentation;
                }
                if (item.insertText) {
                    vsItem.insertText = item.insertText;
                }
                if (item.filterText) {
                    vsItem.filterText = item.filterText;
                }
                // Sort by kind: columns first, then variables, then everything else
                vsItem.sortText = `${this._getSortPrefix(item.kind)}_${item.label}`;

                // Mark column completions for lazy documentation resolution
                if (item.kind === 'column' && !item.documentation) {
                    // Store metadata for resolveCompletionItem
                    (vsItem as any)._needsDocLookup = true;
                }

                return vsItem;
            });
        } catch (e) {
            console.error('CompletionProvider: Error getting completions:', e);
            return [];
        }
    }

    /**
     * Resolve additional details for a completion item.
     * Used to lazily load documentation for column completions.
     */
    resolveCompletionItem(
        item: vscode.CompletionItem,
        _token: vscode.CancellationToken
    ): vscode.CompletionItem {
        // Only resolve column completions that need doc lookup
        if (!(item as any)._needsDocLookup || !this._lastCompletionContext) {
            return item;
        }

        const { resolved, service } = this._lastCompletionContext;
        const columnName = typeof item.label === 'string' ? item.label : item.label.label;

        try {
            // Find the declaration of this column by searching for it in the resolved text
            // We look for the column name after '| extend ' or similar patterns
            const documentation = this._findColumnDocumentation(
                resolved,
                service,
                columnName
            );

            if (documentation) {
                item.documentation = new vscode.MarkdownString(documentation);
            }
        } catch (e) {
            // Ignore errors - just don't add documentation
        }

        return item;
    }

    /**
     * Find documentation for a column by locating its declaration.
     */
    private _findColumnDocumentation(
        resolved: ResolvedKustoDocument,
        service: KustoLanguageService,
        columnName: string
    ): string | null {
        // Find where this column is declared in the resolved text
        // Look for patterns like "| extend columnName = " or "| project columnName"
        const text = resolved.virtualText;

        // Search for extend declaration pattern: "extend columnName ="
        const extendPattern = new RegExp(`extend\\s+${this._escapeRegex(columnName)}\\s*=`, 'i');
        const extendMatch = text.match(extendPattern);

        if (extendMatch && extendMatch.index !== undefined) {
            // Find the position of the column name in the match
            const matchStart = extendMatch.index;
            const columnOffset = text.indexOf(columnName, matchStart);

            if (columnOffset !== -1) {
                // Use getRelatedElements to find the declaration
                const relatedInfo = service.getRelatedElements(text, columnOffset);
                if (relatedInfo) {
                    const declaration = relatedInfo.elements.find(el => el.kind === 'declaration');
                    if (declaration) {
                        const declLocation = resolved.sourceMap.toDocumentOffset(declaration.start);
                        if (declLocation) {
                            const sourceText = this.sourceTextProvider.getSourceText(declLocation.uri);
                            if (sourceText) {
                                return extractDocumentation(sourceText, declLocation.offset);
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    private _escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private _mapKind(kind: CompletionKind): vscode.CompletionItemKind {
        switch (kind) {
            case 'keyword': return vscode.CompletionItemKind.Keyword;
            case 'function': return vscode.CompletionItemKind.Function;
            case 'table': return vscode.CompletionItemKind.Class;
            case 'column': return vscode.CompletionItemKind.Field;
            case 'variable': return vscode.CompletionItemKind.Variable;
            case 'operator': return vscode.CompletionItemKind.Operator;
            case 'database': return vscode.CompletionItemKind.Module;
            case 'cluster': return vscode.CompletionItemKind.Module;
            case 'type': return vscode.CompletionItemKind.TypeParameter;
            case 'snippet': return vscode.CompletionItemKind.Snippet;
            default: return vscode.CompletionItemKind.Text;
        }
    }

    /**
     * Get sort prefix to group completions by relevance.
     * Lower numbers appear first in the completion list.
     */
    private _getSortPrefix(kind: CompletionKind): string {
        switch (kind) {
            case 'column': return '0'; // Columns first - most commonly needed
            case 'variable': return '1'; // Then variables (let bindings)
            case 'table': return '2'; // Then tables
            case 'function': return '3'; // Functions after columns
            case 'operator': return '4'; // Operators
            case 'keyword': return '5'; // Keywords
            case 'database': return '6';
            case 'cluster': return '7';
            case 'type': return '8';
            case 'snippet': return '9';
            default: return '9';
        }
    }
}

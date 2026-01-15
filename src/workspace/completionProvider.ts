import * as vscode from 'vscode';
import { Disposable } from '../utils/disposables';
import { MutableProject } from '../language/workspace/mutableProject';
import { CompletionKind } from '../language/kusto/kustoLanguageService';
import { ResolvedDocumentAdapter } from '../language/akusto/resolvedDocumentAdapter';
import { DocumentOffset } from '../language/common/documentOffset';
import { getLanguageServiceForInstructions } from './languageServiceResolver';

/**
 * Provides completions for Kusto documents.
 * Uses schema-aware language service when connection is configured.
 */
export class CompletionProvider extends Disposable implements vscode.CompletionItemProvider {
    constructor(private readonly model: MutableProject) {
        super();

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
        const uri = document.uri.toString();
        const offset = document.offsetAt(position);

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
            const resolved = project.resolve(doc, fragment);

            // Get the appropriate language service (with schema if available)
            const service = getLanguageServiceForInstructions(resolved.instructions);

            const adapter = new ResolvedDocumentAdapter(resolved, service);
            const completions = adapter.getCompletions(new DocumentOffset(uri, offset));

            // Convert to VS Code completion items
            return completions.map(item => {
                const vsItem = new vscode.CompletionItem(item.label, this._mapKind(item.kind));
                if (item.detail) {
                    vsItem.detail = item.detail;
                }
                if (item.insertText) {
                    vsItem.insertText = item.insertText;
                }
                if (item.filterText) {
                    vsItem.filterText = item.filterText;
                }
                return vsItem;
            });
        } catch (e) {
            console.error('CompletionProvider: Error getting completions:', e);
            return [];
        }
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
}

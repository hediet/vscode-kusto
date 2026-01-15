import * as vscode from 'vscode';
import { MutableProject } from '../language/workspace/mutableProject';
import { autorun } from '@vscode/observables';
import { Disposable } from '../utils/disposables';

/**
 * Provides CodeLens for running Kusto queries.
 * Shows "Run Query" on each code fragment.
 */
export class CodeLensProvider extends Disposable implements vscode.CodeLensProvider {
    private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    constructor(private readonly model: MutableProject) {
        super();

        // Register provider
        this._register(
            vscode.languages.registerCodeLensProvider(
                { language: 'kusto', scheme: 'file' },
                this
            )
        );

        // Refresh code lenses when documents change
        this._register(
            autorun(reader => {
                this.model.documents.read(reader);
                this._onDidChangeCodeLenses.fire();
            })
        );
    }

    provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        const uri = document.uri.toString();
        const akustoDoc = this.model.documents.get().get(uri);

        if (!akustoDoc) {
            return [];
        }

        const lenses: vscode.CodeLens[] = [];

        for (const fragment of akustoDoc.fragments) {
            const startPos = document.positionAt(fragment.range.start);
            const range = new vscode.Range(startPos, startPos);

            // Show "Run Query" for any fragment
            lenses.push(new vscode.CodeLens(range, {
                title: fragment.isDefinition ? '▶ Run Definition' : '▶ Run Query',
                command: 'kusto.runQuery',
                arguments: [uri, fragment.range.start, fragment.range.endExclusive],
                tooltip: 'Execute this query (Ctrl+Enter)',
            }));
        }

        return lenses;
    }
}

import * as vscode from 'vscode';
import { MutableProject } from '../language/workspace/mutableProject';
import { Disposable } from '../utils/disposables';
import { AkustoDocument } from '../language/akusto/akustoDocument';
import { KustoFragment } from '../language/akusto/kustoFragment';
import { AuthType } from '../connection';
import { ResolvedKustoDocument } from '../language/akusto/resolvedKustoDocument';
import { extractConnection } from './languageServiceResolver';
import { ResultsViewProvider } from './resultsViewProvider';
import { QueryHistoryModel, getQueryService } from './queryHistoryModel';

/**
 * Handles running Kusto queries and displaying results.
 * 
 * Uses QueryService to execute queries and QueryHistoryModel to track them.
 */
export class QueryRunner extends Disposable {
    private _resultsProvider: ResultsViewProvider | undefined;
    private _historyModel: QueryHistoryModel | undefined;

    constructor(private readonly model: MutableProject) {
        super();

        // Register run query command
        this._register(
            vscode.commands.registerCommand('kusto.runQuery', this._runQuery.bind(this))
        );

        // Register run at cursor command (for keybinding)
        this._register(
            vscode.commands.registerCommand('kusto.runQueryAtCursor', this._runQueryAtCursor.bind(this))
        );
    }

    /**
     * Set the results view provider for displaying results in webview
     */
    public setResultsProvider(provider: ResultsViewProvider) {
        this._resultsProvider = provider;
    }

    /**
     * Set the history model for tracking query executions
     */
    public setHistoryModel(model: QueryHistoryModel) {
        this._historyModel = model;
    }

    private async _runQueryAtCursor(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'kusto') {
            vscode.window.showWarningMessage('No Kusto document active');
            return;
        }

        const uri = editor.document.uri.toString();
        const offset = editor.document.offsetAt(editor.selection.active);

        const akustoDoc = this.model.documents.get().get(uri);
        if (!akustoDoc) {
            vscode.window.showWarningMessage('Document not loaded');
            return;
        }

        // Find the fragment at cursor
        const fragment = akustoDoc.getFragmentAt(offset);
        if (!fragment) {
            vscode.window.showWarningMessage('No query at cursor position');
            return;
        }

        await this._executeFragment(akustoDoc, fragment);
    }

    private async _runQuery(uri: string, start: number, _end: number): Promise<void> {
        const akustoDoc = this.model.documents.get().get(uri);
        if (!akustoDoc) {
            vscode.window.showWarningMessage('Document not found');
            return;
        }

        const fragment = akustoDoc.getFragmentAt(start);
        if (!fragment) {
            vscode.window.showWarningMessage('No query found at position');
            return;
        }

        await this._executeFragment(akustoDoc, fragment);
    }

    private async _executeFragment(akustoDoc: AkustoDocument, fragment: KustoFragment): Promise<void> {
        const project = this.model.project.get();

        try {
            const resolved = project.resolve(akustoDoc, fragment);

            // Extract connection info
            const { cluster, database, authType } = extractConnection(resolved.instructions);

            if (cluster && database) {
                // Execute the query
                this._executeQuery(fragment.text, resolved.virtualText, cluster, database, authType);
            } else {
                // Show resolved query without execution
                await this._showResolvedOnly(fragment.text, resolved);
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to resolve query: ${e}`);
        }
    }

    private _executeQuery(
        originalQuery: string,
        resolvedQuery: string,
        cluster: string,
        database: string,
        authType: AuthType
    ): void {
        // Reveal the results panel
        vscode.commands.executeCommand('kusto.resultsView.focus');
        this._resultsProvider?.reveal();

        // Execute via QueryService
        const queryService = getQueryService();
        const execution = queryService.execute(cluster, database, originalQuery, resolvedQuery, authType);

        // Add to history
        this._historyModel?.addExecution(execution);
    }

    private async _showResolvedOnly(originalQuery: string, resolved: ResolvedKustoDocument): Promise<void> {
        // Show a message that no connection is configured
        vscode.window.showWarningMessage(
            'No connection configured. Add :setConnection and :setDefaultDb to execute queries.',
            'Show Resolved Query'
        ).then(selection => {
            if (selection === 'Show Resolved Query') {
                this._showResolvedQueryDocument(originalQuery, resolved);
            }
        });
    }

    private async _showResolvedQueryDocument(originalQuery: string, resolved: ResolvedKustoDocument): Promise<void> {
        const content = [
            '// Original Query',
            originalQuery,
            '',
            '// Resolved Query (with definitions)',
            resolved.virtualText,
        ].join('\n');

        const doc = await vscode.workspace.openTextDocument({
            language: 'kusto',
            content
        });
        await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: true,
        });
    }
}

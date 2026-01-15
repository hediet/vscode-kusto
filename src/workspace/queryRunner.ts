import * as vscode from 'vscode';
import { MutableProject } from '../language/workspace/mutableProject';
import { Disposable } from '../utils/disposables';
import { AkustoDocument } from '../language/akusto/akustoDocument';
import { KustoFragment } from '../language/akusto/kustoFragment';
import { getKustoClient, QueryResult, AuthType } from '../connection';
import { ResolvedKustoDocument } from '../language/akusto/resolvedKustoDocument';
import { extractConnection } from './languageServiceResolver';

/**
 * Handles running Kusto queries and displaying results.
 */
export class QueryRunner extends Disposable {
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

        // Register virtual document provider for results
        this._register(
            vscode.workspace.registerTextDocumentContentProvider('kusto-result', {
                provideTextDocumentContent: (uri) => {
                    return uri.query || '# No results yet';
                }
            })
        );
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
                await this._executeAndShowResult(fragment.text, resolved.virtualText, cluster, database, authType);
            } else {
                // Show resolved query without execution
                await this._showResolvedOnly(fragment.text, resolved);
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to resolve query: ${e}`);
        }
    }

    private async _executeAndShowResult(
        originalQuery: string,
        resolvedQuery: string,
        cluster: string,
        database: string,
        authType: AuthType
    ): Promise<void> {
        const client = getKustoClient();
        const timestamp = new Date().toLocaleTimeString();

        let resultContent: string;
        try {
            // Show progress
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Executing Kusto query...',
                cancellable: false,
            }, async () => {
                const result = await client.executeQuery(cluster, database, resolvedQuery, authType);
                resultContent = this._formatResult(originalQuery, resolvedQuery, result, timestamp, cluster, database);
            });
        } catch (e) {
            resultContent = this._formatError(originalQuery, resolvedQuery, e, timestamp, cluster, database);
        }

        await this._showResultDocument(resultContent!);
    }

    private async _showResolvedOnly(originalQuery: string, resolved: ResolvedKustoDocument): Promise<void> {
        const timestamp = new Date().toLocaleTimeString();

        const content = [
            '# Kusto Query',
            '',
            `*Generated at ${timestamp}*`,
            '',
            '## Original Query',
            '```kusto',
            originalQuery,
            '```',
            '',
            '## Resolved Query (with definitions)',
            '```kusto',
            resolved.virtualText,
            '```',
            '',
            '---',
            '',
            '> **No connection configured.** Add a connection to execute queries:',
            '> ```',
            '> :setConnection({ type: "azureCli", cluster: "help.kusto.windows.net" })',
            '> :setDefaultDb("Samples")',
            '> ```',
        ].join('\n');

        await this._showResultDocument(content);
    }

    private _formatResult(
        originalQuery: string,
        resolvedQuery: string,
        result: QueryResult,
        timestamp: string,
        cluster: string,
        database: string
    ): string {
        const lines = [
            '# Kusto Query Result',
            '',
            `*Executed at ${timestamp}*`,
            '',
            `**Cluster:** \`${cluster}\`  `,
            `**Database:** \`${database}\``,
            '',
            '## Original Query',
            '```kusto',
            originalQuery,
            '```',
            '',
        ];

        // Add result table
        lines.push('## Result', '');

        if (result.rows.length === 0) {
            lines.push('*No results returned.*', '');
        } else {
            // Build markdown table
            lines.push('| ' + result.columns.join(' | ') + ' |');
            lines.push('| ' + result.columns.map(() => '---').join(' | ') + ' |');

            for (const row of result.rows.slice(0, 100)) { // Limit to 100 rows
                const cells = row.map(cell => this._formatCell(cell));
                lines.push('| ' + cells.join(' | ') + ' |');
            }

            if (result.rows.length > 100) {
                lines.push('', `*Showing first 100 of ${result.totalRows} rows.*`);
            } else {
                lines.push('', `*${result.totalRows} row(s) returned.*`);
            }
        }

        // Add resolved query at end (collapsed by default conceptually)
        lines.push(
            '',
            '<details>',
            '<summary>Resolved Query (click to expand)</summary>',
            '',
            '```kusto',
            resolvedQuery,
            '```',
            '</details>',
        );

        return lines.join('\n');
    }

    private _formatError(
        originalQuery: string,
        resolvedQuery: string,
        error: unknown,
        timestamp: string,
        cluster: string,
        database: string
    ): string {
        const errorMessage = error instanceof Error ? error.message : String(error);

        return [
            '# Kusto Query Error',
            '',
            `*Attempted at ${timestamp}*`,
            '',
            `**Cluster:** \`${cluster}\`  `,
            `**Database:** \`${database}\``,
            '',
            '## Error',
            '```',
            errorMessage,
            '```',
            '',
            '## Original Query',
            '```kusto',
            originalQuery,
            '```',
            '',
            '## Resolved Query',
            '```kusto',
            resolvedQuery,
            '```',
        ].join('\n');
    }

    private _formatCell(value: unknown): string {
        if (value === null || value === undefined) {
            return '*null*';
        }
        if (typeof value === 'object') {
            return '`' + JSON.stringify(value) + '`';
        }
        return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    }

    private async _showResultDocument(content: string): Promise<void> {
        const resultUri = vscode.Uri.parse(`kusto-result:Query Result.md`).with({
            query: content
        });

        const doc = await vscode.workspace.openTextDocument(resultUri);
        await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: true,
            preserveFocus: false,
        });

        await vscode.languages.setTextDocumentLanguage(doc, 'markdown');
    }
}

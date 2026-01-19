import * as vscode from 'vscode';
import { Disposable } from '../utils/disposables';
import { MutableProject } from '../language/workspace/mutableProject';
import { AkustoDocument } from '../language/akusto/akustoDocument';
import { extractConnection } from './languageServiceResolver';
import { ResultsViewProvider } from './resultsViewProvider';
import { QueryHistoryModel, getQueryService } from './queryHistoryModel';

const MAX_JSON_LENGTH = 8000;
const DEFAULT_TIMEOUT_SECONDS = 10;

interface RunQueryInput {
    queryTitle: string;
    query: string;
    timeoutSeconds?: number;
}

/**
 * Chat tool for running Kusto queries from AI assistants.
 * 
 * Uses QueryService to execute queries and QueryHistoryModel to track them.
 */
export class RunQueryTool extends Disposable {
    private _resultsProvider: ResultsViewProvider | undefined;
    private _historyModel: QueryHistoryModel | undefined;

    constructor(private readonly model: MutableProject) {
        super();

        // Register the language model tool
        this._register(
            vscode.lm.registerTool('kusto_runQuery', this)
        );
    }

    /**
     * Set the results view provider for displaying results in webview history
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

    /**
     * Called when preparing to invoke the tool - can show confirmation UI
     */
    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<RunQueryInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { queryTitle, query } = options.input;
        return {
            invocationMessage: `Running query: ${queryTitle}`,
            confirmationMessages: {
                title: `Run Kusto Query: ${queryTitle}`,
                message: new vscode.MarkdownString(`Execute the following query?\n\n\`\`\`kusto\n${query}\n\`\`\``)
            }
        };
    }

    /**
     * Execute the tool
     */
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<RunQueryInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { queryTitle, query, timeoutSeconds } = options.input;

        try {
            // Create a temporary in-memory document to parse the query
            const result = await this._executeQuery(query, queryTitle, timeoutSeconds, token);
            return result;
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Error executing query: ${errorMessage}`)
            ]);
        }
    }

    private async _executeQuery(
        query: string,
        queryTitle: string,
        timeoutSeconds: number | undefined,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        // Parse the query using akusto infrastructure
        const tempUri = `akusto://chat-query/${Date.now()}.kql`;

        // Create a temporary document
        const akustoDoc = AkustoDocument.parse(tempUri, query);

        // Get the last fragment (the actual query to run)
        const fragments = akustoDoc.fragments;
        if (fragments.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No query fragments found in the provided query.')
            ]);
        }

        const lastFragment = fragments[fragments.length - 1];

        // Resolve the query using the project
        const project = this.model.project.get();
        const resolved = project.resolve(akustoDoc, lastFragment);

        // Extract connection info from instructions
        const { cluster, database, authType } = extractConnection(resolved.instructions);

        if (!cluster || !database) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    'No connection configured. The query must include :setConnection and :setDefaultDb instructions.\n\n' +
                    'Example:\n```kusto\n' +
                    ':setConnection({ type: "azureCli", cluster: "https://your-cluster.kusto.windows.net/" })\n' +
                    ':setDefaultDb("YourDatabase")\n' +
                    '```'
                )
            ]);
        }

        // Execute the query via QueryService
        const queryService = getQueryService();
        const execution = queryService.execute(
            cluster,
            database,
            `[AI] ${queryTitle}`,
            resolved.virtualText,
            authType
        );

        // Add to history
        this._historyModel?.addExecution(execution);

        // Reveal results panel
        this._resultsProvider?.reveal();

        // Handle VS Code cancellation token
        token.onCancellationRequested(() => {
            execution.cancel();
        });

        // Set up timeout (default 10 seconds)
        const effectiveTimeout = (timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
        const timeoutState = { timedOut: false };
        const timeoutId = setTimeout(() => {
            timeoutState.timedOut = true;
            execution.cancel();
        }, effectiveTimeout);

        try {
            // Wait for execution to complete by polling outcome
            const result = await this._waitForExecution(execution);

            if (execution.signal.aborted) {
                const message = timeoutState.timedOut
                    ? `Query timed out after ${effectiveTimeout / 1000} seconds.`
                    : 'Query was cancelled.';
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(message)
                ]);
            }

            if (result.kind === 'error') {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        `Query failed.\n\n**Error:** ${result.error.message}\n\n` +
                        `**Cluster:** ${cluster}\n**Database:** ${database}`
                    )
                ]);
            }

            if (result.kind === 'cancelled') {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Query was cancelled.')
                ]);
            }

            // Convert result to JSON
            const rows = result.result.rows.map(row => {
                const obj: Record<string, unknown> = {};
                result.result.columns.forEach((col, i) => {
                    obj[col] = row[i];
                });
                return obj;
            });

            let jsonResult = JSON.stringify(rows, null, 2);
            let truncated = false;
            let displayedRowCount = rows.length;

            if (jsonResult.length > MAX_JSON_LENGTH) {
                // Truncate and indicate
                const truncatedRows: Record<string, unknown>[] = [];
                let currentLength = 2; // for "[]"

                for (const row of rows) {
                    const rowJson = JSON.stringify(row, null, 2);
                    if (currentLength + rowJson.length + 3 > MAX_JSON_LENGTH - 100) {
                        break;
                    }
                    truncatedRows.push(row);
                    currentLength += rowJson.length + 3; // comma and newlines
                }

                jsonResult = JSON.stringify(truncatedRows, null, 2);
                truncated = true;
                displayedRowCount = truncatedRows.length;
            }

            // Build response
            let response = `Query executed successfully.\n\n`;
            response += `**Cluster:** ${cluster}\n`;
            response += `**Database:** ${database}\n`;
            response += `**Rows returned:** ${result.result.totalRows}\n\n`;

            if (truncated) {
                response += `⚠️ **Result truncated** (showing ${displayedRowCount} of ${result.result.totalRows} rows)\n\n`;
            }

            response += `\`\`\`json\n${jsonResult}\n\`\`\``;

            if (truncated) {
                response += `\n\n*Full results available in the Kusto Results panel.*`;
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(response)
            ]);

        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Wait for an execution to complete by polling its outcome observable
     */
    private _waitForExecution(execution: import('./queryExecution').QueryExecution): Promise<import('./queryExecution').QueryOutcome> {
        return new Promise((resolve) => {
            const checkOutcome = () => {
                const outcome = execution.outcome.get();
                if (outcome) {
                    resolve(outcome);
                } else {
                    setTimeout(checkOutcome, 50);
                }
            };
            checkOutcome();
        });
    }
}

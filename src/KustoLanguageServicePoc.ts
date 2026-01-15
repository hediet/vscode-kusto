import * as vscode from 'vscode';
import { Disposable } from './utils/disposables';
import '@kusto/language-service-next/bridge.js';
import '@kusto/language-service-next';

/**
 * Proof of concept for Kusto Language Service integration with VS Code.
 * Uses @kusto/language-service-next with KustoCodeService for completions.
 * Provides completions for .kql files using a dummy schema.
 */
export class KustoLanguageServicePoc extends Disposable {
    private globalState: Kusto.Language.GlobalState | null = null;

    constructor() {
        super();

        try {
            // Create a dummy schema for testing
            this.globalState = this.createDummySchema();
            console.log('KustoLanguageServicePoc: GlobalState created successfully');
        } catch (e) {
            console.error('KustoLanguageServicePoc: Failed to create GlobalState:', e);
        }

        // Register completion provider for kusto files
        this._register(
            vscode.languages.registerCompletionItemProvider(
                [{ language: 'kusto' }, { pattern: '**/*.kql' }, { pattern: '**/*.csl' }],
                {
                    provideCompletionItems: (document, position, token) => {
                        return this.provideCompletionItems(document, position);
                    }
                },
                '.', '|', ' ' // trigger characters
            )
        );

        console.log('KustoLanguageServicePoc initialized');
    }

    /**
     * Creates a dummy schema with sample tables and columns for testing.
     * Uses the new @kusto/language-service-next API with Symbols.
     */
    private createDummySchema(): Kusto.Language.GlobalState {
        const ScalarSymbol = Kusto.Language.Symbols.ScalarSymbol;
        const ColumnSymbol = Kusto.Language.Symbols.ColumnSymbol;
        const TableSymbol = Kusto.Language.Symbols.TableSymbol;
        const DatabaseSymbol = Kusto.Language.Symbols.DatabaseSymbol;
        const ClusterSymbol = Kusto.Language.Symbols.ClusterSymbol;

        // Get scalar types
        const stringType = ScalarSymbol.From('string');
        const longType = ScalarSymbol.From('long');
        const datetimeType = ScalarSymbol.From('datetime');
        const timespanType = ScalarSymbol.From('timespan');
        const guidType = ScalarSymbol.From('guid');

        // Create columns for Logs table
        const logsColumns: Kusto.Language.Symbols.ColumnSymbol[] = [
            new ColumnSymbol('Timestamp', datetimeType, 'The time the log entry was created', null, null, null),
            new ColumnSymbol('Message', stringType, 'The log message', null, null, null),
            new ColumnSymbol('Level', stringType, 'Log level (Info, Warning, Error)', null, null, null),
            new ColumnSymbol('Count', longType, 'Count of occurrences', null, null, null),
            new ColumnSymbol('Duration', timespanType, 'Duration of the operation', null, null, null),
        ];

        // Create columns for Events table
        const eventsColumns: Kusto.Language.Symbols.ColumnSymbol[] = [
            new ColumnSymbol('EventId', guidType, 'Unique event identifier', null, null, null),
            new ColumnSymbol('Timestamp', datetimeType, 'Event timestamp', null, null, null),
            new ColumnSymbol('EventName', stringType, 'Name of the event', null, null, null),
            new ColumnSymbol('UserId', stringType, 'User who triggered the event', null, null, null),
        ];

        // Create tables using $ctor4 constructor: (name, columns[])
        const logsTable = new TableSymbol.$ctor4('Logs', logsColumns);
        const eventsTable = new TableSymbol.$ctor4('Events', eventsColumns);

        // Create database with tables using ctor constructor: (name, members[])
        const database = new DatabaseSymbol.ctor('SampleDB', [logsTable, eventsTable]);

        // Create cluster with database using ctor constructor: (name, databases[])
        const cluster = new ClusterSymbol.ctor('https://sample.kusto.windows.net', [database]);

        // Create GlobalState with the cluster and database
        // Start with default GlobalState and add our schema
        let globals = Kusto.Language.GlobalState.Default!;
        globals = globals.WithCluster(cluster)!;
        globals = globals.WithDatabase(database)!;

        return globals;
    }

    /**
     * Provides completion items for the given document and position.
     */
    private provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        const completionItems: vscode.CompletionItem[] = [];

        try {
            // Get the full document text
            const text = document.getText();

            // Calculate the cursor position as character offset
            const cursorOffset = document.offsetAt(position);

            if (this.globalState) {
                // Create a KustoCodeService for this text with our schema
                const codeService = new Kusto.Language.Editor.KustoCodeService.$ctor1(text, this.globalState);
                // Get completion items at the cursor position
                const completionInfo = codeService.GetCompletionItems(cursorOffset);

                if (completionInfo && completionInfo.Items) {
                    // Iterate over the completion items
                    const items = completionInfo.Items;
                    const count = items.Count;

                    for (let i = 0; i < count; i++) {
                        const item = items.getItem(i);
                        if (item && item.DisplayText) {
                            const vsItem = new vscode.CompletionItem(
                                item.DisplayText,
                                this.mapCompletionKind(item.Kind)
                            );

                            // Set detail based on kind
                            vsItem.detail = this.getKindDisplayName(item.Kind);

                            // Set insert text if different from display text
                            if (item.AfterText) {
                                vsItem.insertText = item.DisplayText + item.AfterText;
                            }

                            // Set sort text using MatchText for better sorting
                            if (item.MatchText) {
                                vsItem.filterText = item.MatchText;
                            }

                            completionItems.push(vsItem);
                        }
                    }
                }
            }

            // Get the current line's text up to cursor for logging
            const lineText = document.lineAt(position.line).text.substring(0, position.character);
            console.log(`Kusto completions: ${completionItems.length} items for "${lineText}"`);
        } catch (error) {
            console.error('Error providing Kusto completions:', error);

            // Provide basic fallback completions on error
            const fallbackOperators = ['where', 'project', 'summarize', 'extend', 'take'];
            for (const op of fallbackOperators) {
                completionItems.push(new vscode.CompletionItem(op, vscode.CompletionItemKind.Keyword));
            }
        }

        return completionItems;
    }

    /**
     * Gets a display name for the CompletionKind.
     */
    private getKindDisplayName(kind: Kusto.Language.Editor.CompletionKind): string {
        const CompletionKind = Kusto.Language.Editor.CompletionKind;
        switch (kind) {
            case CompletionKind.Syntax: return 'Syntax';
            case CompletionKind.Keyword: return 'Keyword';
            case CompletionKind.Punctuation: return 'Punctuation';
            case CompletionKind.QueryPrefix: return 'Query Prefix';
            case CompletionKind.Table: return 'Table';
            case CompletionKind.Column: return 'Column';
            case CompletionKind.Variable: return 'Variable';
            case CompletionKind.AggregateFunction: return 'Aggregate Function';
            case CompletionKind.Parameter: return 'Parameter';
            case CompletionKind.Identifier: return 'Identifier';
            case CompletionKind.Cluster: return 'Cluster';
            case CompletionKind.Database: return 'Database';
            case CompletionKind.MaterialiedView: return 'Materialized View';
            case CompletionKind.Graph: return 'Graph';
            case CompletionKind.BuiltInFunction: return 'Built-in Function';
            case CompletionKind.LocalFunction: return 'Local Function';
            case CompletionKind.DatabaseFunction: return 'Database Function';
            case CompletionKind.Example: return 'Example';
            case CompletionKind.Option: return 'Option';
            case CompletionKind.RenderChart: return 'Render Chart';
            case CompletionKind.TabularPrefix: return 'Tabular Prefix';
            case CompletionKind.TabularSuffix: return 'Tabular Suffix';
            case CompletionKind.ScalarPrefix: return 'Scalar Prefix';
            case CompletionKind.ScalarInfix: return 'Scalar Infix';
            case CompletionKind.CommandPrefix: return 'Command Prefix';
            case CompletionKind.EntityGroup: return 'Entity Group';
            case CompletionKind.ScalarType: return 'Scalar Type';
            case CompletionKind.StoredQueryResult: return 'Stored Query Result';
            case CompletionKind.Unknown:
            default: return 'Kusto';
        }
    }

    /**
     * Maps Kusto CompletionKind to VS Code CompletionItemKind.
     */
    private mapCompletionKind(kind: Kusto.Language.Editor.CompletionKind): vscode.CompletionItemKind {
        const CompletionKind = Kusto.Language.Editor.CompletionKind;

        switch (kind) {
            case CompletionKind.Keyword:
            case CompletionKind.Syntax:
            case CompletionKind.QueryPrefix:
            case CompletionKind.TabularPrefix:
            case CompletionKind.TabularSuffix:
            case CompletionKind.ScalarPrefix:
            case CompletionKind.ScalarInfix:
            case CompletionKind.CommandPrefix:
                return vscode.CompletionItemKind.Keyword;

            case CompletionKind.Punctuation:
                return vscode.CompletionItemKind.Operator;

            case CompletionKind.Table:
            case CompletionKind.MaterialiedView:
            case CompletionKind.StoredQueryResult:
                return vscode.CompletionItemKind.Class;

            case CompletionKind.Column:
                return vscode.CompletionItemKind.Field;

            case CompletionKind.Variable:
                return vscode.CompletionItemKind.Variable;

            case CompletionKind.AggregateFunction:
            case CompletionKind.BuiltInFunction:
            case CompletionKind.LocalFunction:
            case CompletionKind.DatabaseFunction:
                return vscode.CompletionItemKind.Function;

            case CompletionKind.Parameter:
                return vscode.CompletionItemKind.Variable;

            case CompletionKind.Cluster:
            case CompletionKind.Database:
                return vscode.CompletionItemKind.Module;

            case CompletionKind.Graph:
            case CompletionKind.EntityGroup:
                return vscode.CompletionItemKind.Struct;

            case CompletionKind.Identifier:
                return vscode.CompletionItemKind.Reference;

            case CompletionKind.Example:
                return vscode.CompletionItemKind.Snippet;

            case CompletionKind.Option:
            case CompletionKind.RenderChart:
                return vscode.CompletionItemKind.EnumMember;

            case CompletionKind.ScalarType:
                return vscode.CompletionItemKind.TypeParameter;

            case CompletionKind.Unknown:
            default:
                return vscode.CompletionItemKind.Text;
        }
    }
}

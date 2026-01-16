import '@kusto/language-service-next/bridge.js';
import '@kusto/language-service-next';
import { OffsetRange } from '../common/offsetRange';

/** Completion item from the Kusto language service. */
export interface CompletionItem {
    readonly label: string;
    readonly kind: CompletionKind;
    readonly detail?: string;
    readonly documentation?: string;
    readonly insertText?: string;
    readonly filterText?: string;
}

/** Completion item kinds. */
export type CompletionKind =
    | 'keyword'
    | 'function'
    | 'table'
    | 'column'
    | 'variable'
    | 'operator'
    | 'database'
    | 'cluster'
    | 'type'
    | 'snippet'
    | 'unknown';

/** Diagnostic from the Kusto language service. */
export interface Diagnostic {
    readonly message: string;
    readonly severity: 'error' | 'warning' | 'info' | 'suggestion';
    readonly range: OffsetRange;
}

/** Semantic token for syntax highlighting. */
export interface SemanticToken {
    readonly range: OffsetRange;
    readonly type: SemanticTokenType;
}

/** Semantic token types. */
export type SemanticTokenType =
    | 'keyword'
    | 'function'
    | 'variable'
    | 'string'
    | 'number'
    | 'comment'
    | 'operator'
    | 'type'
    | 'table'
    | 'column'
    | 'parameter';

/** Hover information. */
export interface Hover {
    readonly contents: string;
    readonly range?: OffsetRange;
}

/** Kind of related element. */
export type RelatedElementKind = 'syntax' | 'reference' | 'declaration' | 'other';

/** A related element (e.g., declaration or reference of a symbol). */
export interface RelatedElement {
    readonly start: number;
    readonly length: number;
    readonly kind: RelatedElementKind;
}

/** Information about related elements at a position. */
export interface RelatedInfo {
    readonly elements: readonly RelatedElement[];
    readonly currentIndex: number;
}

/** Kusto schema for a database. */
export interface KustoSchema {
    readonly cluster: string;
    readonly database: string;
    readonly tables: readonly TableSchema[];
}

/** Table schema. */
export interface TableSchema {
    readonly name: string;
    readonly columns: readonly ColumnSchema[];
}

/** Column schema. */
export interface ColumnSchema {
    readonly name: string;
    readonly type: string;
    readonly docstring?: string;
}

/** Kusto language service - provides completions, diagnostics, etc. */
export interface KustoLanguageService {
    /** Get completion items at the given offset. */
    getCompletions(text: string, offset: number): CompletionItem[];

    /** Get all diagnostics for the text. */
    getDiagnostics(text: string): Diagnostic[];

    /** Get semantic tokens for syntax highlighting. */
    getSemanticTokens(text: string): SemanticToken[];

    /** Get hover information at the given offset. */
    getHover(text: string, offset: number): Hover | null;

    /** Get related elements (declarations, references) at the given offset. */
    getRelatedElements(text: string, offset: number): RelatedInfo | null;
}

/** Create a Kusto language service, optionally with schema. */
export function createKustoLanguageService(schema?: KustoSchema): KustoLanguageService {
    const globalState = schema ? createGlobalState(schema) : Kusto.Language.GlobalState.Default!;

    // Build column docstring lookup map from schema
    const columnDocstrings = new Map<string, string>();
    if (schema) {
        for (const table of schema.tables) {
            for (const col of table.columns) {
                if (col.docstring) {
                    // Store with just column name (columns are unique within context)
                    columnDocstrings.set(col.name, col.docstring);
                }
            }
        }
    }

    return new KustoLanguageServiceImpl(globalState, columnDocstrings);
}

/** Create GlobalState from our schema definition. */
function createGlobalState(schema: KustoSchema): Kusto.Language.GlobalState {
    const ScalarSymbol = Kusto.Language.Symbols.ScalarSymbol;
    const ColumnSymbol = Kusto.Language.Symbols.ColumnSymbol;
    const TableSymbol = Kusto.Language.Symbols.TableSymbol;
    const DatabaseSymbol = Kusto.Language.Symbols.DatabaseSymbol;
    const ClusterSymbol = Kusto.Language.Symbols.ClusterSymbol;

    const tables: Kusto.Language.Symbols.TableSymbol[] = [];

    for (const tableSchema of schema.tables) {
        const columns: Kusto.Language.Symbols.ColumnSymbol[] = [];

        for (const col of tableSchema.columns) {
            const scalarType = ScalarSymbol.From(col.type);
            columns.push(new ColumnSymbol(col.name, scalarType, col.docstring ?? null, null, null, null));
        }

        tables.push(new TableSymbol.$ctor4(tableSchema.name, columns));
    }

    const database = new DatabaseSymbol.ctor(schema.database, tables);
    const cluster = new ClusterSymbol.ctor(schema.cluster, [database]);

    let globals = Kusto.Language.GlobalState.Default!;
    globals = globals.WithCluster(cluster)!;
    globals = globals.WithDatabase(database)!;

    return globals;
}

/** Implementation of KustoLanguageService. */
class KustoLanguageServiceImpl implements KustoLanguageService {
    constructor(
        private readonly globalState: Kusto.Language.GlobalState,
        private readonly columnDocstrings: Map<string, string> = new Map()
    ) { }

    getCompletions(text: string, offset: number): CompletionItem[] {
        const codeService = new Kusto.Language.Editor.KustoCodeService.$ctor1(text, this.globalState);
        const completionInfo = codeService.GetCompletionItems(offset);

        if (!completionInfo?.Items) {
            return [];
        }

        const result: CompletionItem[] = [];
        const items = completionInfo.Items;
        const count = items.Count;

        for (let i = 0; i < count; i++) {
            const item = items.getItem(i);
            if (item?.DisplayText) {
                const kind = mapCompletionKind(item.Kind);

                // Look up documentation for columns
                let documentation: string | undefined;
                if (kind === 'column') {
                    documentation = this.columnDocstrings.get(item.DisplayText);
                }

                result.push({
                    label: item.DisplayText,
                    kind,
                    detail: getKindDisplayName(item.Kind),
                    documentation,
                    insertText: item.AfterText ? item.DisplayText + item.AfterText : undefined,
                    filterText: item.MatchText ?? undefined,
                });
            }
        }

        return result;
    }

    getDiagnostics(text: string): Diagnostic[] {
        const codeService = new Kusto.Language.Editor.KustoCodeService.$ctor1(text, this.globalState);
        const diagnostics = codeService.GetDiagnostics();

        if (!diagnostics) {
            return [];
        }

        const result: Diagnostic[] = [];
        const count = diagnostics.Count;

        for (let i = 0; i < count; i++) {
            const diag = diagnostics.getItem(i);
            result.push({
                message: diag.Message ?? 'Unknown error',
                severity: mapDiagnosticSeverity(diag.Severity ?? 'error'),
                range: new OffsetRange(diag.Start, diag.Start + diag.Length),
            });
        }

        return result;
    }

    getSemanticTokens(text: string): SemanticToken[] {
        const codeService = new Kusto.Language.Editor.KustoCodeService.$ctor1(text, this.globalState);
        const classificationInfo = codeService.GetClassifications(0, text.length);

        if (!classificationInfo?.Classifications) {
            return [];
        }

        const result: SemanticToken[] = [];
        const classifications = classificationInfo.Classifications;
        const count = classifications.Count;

        for (let i = 0; i < count; i++) {
            const cls = classifications.getItem(i);
            const tokenType = mapClassificationKind(cls.Kind);
            if (tokenType) {
                result.push({
                    range: new OffsetRange(cls.Start, cls.Start + cls.Length),
                    type: tokenType,
                });
            }
        }

        return result;
    }

    getHover(text: string, offset: number): Hover | null {
        const codeService = new Kusto.Language.Editor.KustoCodeService.$ctor1(text, this.globalState);
        const quickInfo = codeService.GetQuickInfo(offset);

        if (!quickInfo?.Text) {
            return null;
        }

        return {
            contents: quickInfo.Text,
        };
    }

    getRelatedElements(text: string, offset: number): RelatedInfo | null {
        const codeService = new Kusto.Language.Editor.KustoCodeService.$ctor1(text, this.globalState);
        const relatedInfo = codeService.GetRelatedElements(offset);

        if (!relatedInfo) {
            return null;
        }

        const elements: RelatedElement[] = [];
        for (let i = 0; i < relatedInfo.Elements.Count; i++) {
            const el = relatedInfo.Elements.getItem(i);
            elements.push({
                start: el.Start,
                length: el.Length,
                kind: mapRelatedElementKind(el.Kind),
            });
        }

        return {
            elements,
            currentIndex: relatedInfo.CurrentIndex,
        };
    }
}

/** Map Kusto CompletionKind to our kind. */
function mapCompletionKind(kind: Kusto.Language.Editor.CompletionKind): CompletionKind {
    const K = Kusto.Language.Editor.CompletionKind;
    switch (kind) {
        case K.Keyword:
        case K.Syntax:
        case K.QueryPrefix:
        case K.TabularPrefix:
        case K.TabularSuffix:
        case K.ScalarPrefix:
        case K.ScalarInfix:
        case K.CommandPrefix:
            return 'keyword';
        case K.Punctuation:
            return 'operator';
        case K.Table:
        case K.MaterialiedView:
        case K.StoredQueryResult:
            return 'table';
        case K.Column:
            return 'column';
        case K.Variable:
        case K.Parameter:
            return 'variable';
        case K.AggregateFunction:
        case K.BuiltInFunction:
        case K.LocalFunction:
        case K.DatabaseFunction:
            return 'function';
        case K.Cluster:
            return 'cluster';
        case K.Database:
            return 'database';
        case K.ScalarType:
            return 'type';
        case K.Example:
            return 'snippet';
        default:
            return 'unknown';
    }
}

/** Get display name for CompletionKind. */
function getKindDisplayName(kind: Kusto.Language.Editor.CompletionKind): string {
    const K = Kusto.Language.Editor.CompletionKind;
    switch (kind) {
        case K.Syntax: return 'Syntax';
        case K.Keyword: return 'Keyword';
        case K.Punctuation: return 'Punctuation';
        case K.QueryPrefix: return 'Query Prefix';
        case K.Table: return 'Table';
        case K.Column: return 'Column';
        case K.Variable: return 'Variable';
        case K.AggregateFunction: return 'Aggregate Function';
        case K.Parameter: return 'Parameter';
        case K.Identifier: return 'Identifier';
        case K.Cluster: return 'Cluster';
        case K.Database: return 'Database';
        case K.MaterialiedView: return 'Materialized View';
        case K.Graph: return 'Graph';
        case K.BuiltInFunction: return 'Built-in Function';
        case K.LocalFunction: return 'Local Function';
        case K.DatabaseFunction: return 'Database Function';
        case K.Example: return 'Example';
        case K.Option: return 'Option';
        case K.RenderChart: return 'Render Chart';
        case K.TabularPrefix: return 'Tabular Prefix';
        case K.TabularSuffix: return 'Tabular Suffix';
        case K.ScalarPrefix: return 'Scalar Prefix';
        case K.ScalarInfix: return 'Scalar Infix';
        case K.CommandPrefix: return 'Command Prefix';
        case K.EntityGroup: return 'Entity Group';
        case K.ScalarType: return 'Scalar Type';
        case K.StoredQueryResult: return 'Stored Query Result';
        default: return 'Kusto';
    }
}

/** Map Kusto diagnostic severity to our severity. */
function mapDiagnosticSeverity(severity: string): Diagnostic['severity'] {
    switch (severity?.toLowerCase()) {
        case 'error': return 'error';
        case 'warning': return 'warning';
        case 'suggestion': return 'suggestion';
        default: return 'info';
    }
}

/** Map Kusto ClassificationKind to semantic token type. */
function mapClassificationKind(kind: Kusto.Language.Editor.ClassificationKind): SemanticTokenType | null {
    const K = Kusto.Language.Editor.ClassificationKind;
    switch (kind) {
        case K.Keyword: return 'keyword';
        case K.Function: return 'function';
        case K.Variable: return 'variable';
        case K.StringLiteral: return 'string';
        case K.Literal: return 'number';
        case K.Comment: return 'comment';
        case K.Punctuation: return 'operator';
        case K.Type: return 'type';
        case K.Table: return 'table';
        case K.Column: return 'column';
        case K.Parameter: return 'parameter';
        default: return null;
    }
}

/** Map Kusto RelatedElementKind to our kind. */
function mapRelatedElementKind(kind: number): RelatedElementKind {
    // Kusto.Language.Editor.RelatedElementKind: Syntax=0, Reference=1, Declaration=2, Other=3
    switch (kind) {
        case 0: return 'syntax';
        case 1: return 'reference';
        case 2: return 'declaration';
        case 3: return 'other';
        default: return 'other';
    }
}

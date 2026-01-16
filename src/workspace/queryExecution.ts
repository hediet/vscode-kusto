import {
    ISettableObservable,
    observableValue,
    IObservable,
    derived,
} from '@vscode/observables';

/**
 * Visualization properties from Kusto render operator
 */
export interface KustoVisualization {
    type: string;
    xColumn?: string;
    yColumns?: string[];
    series?: string;
    title?: string;
    xTitle?: string;
    yTitle?: string;
    legend?: string;
    yScale?: string;
    [key: string]: unknown;
}

/**
 * Successful query result
 */
export interface QueryResult {
    readonly columns: string[];
    readonly rows: unknown[][];
    readonly totalRows: number;
    readonly resolvedQuery: string;
    readonly visualization?: KustoVisualization;
}

/**
 * Query error
 */
export interface QueryError {
    readonly message: string;
    readonly resolvedQuery: string;
}

/**
 * Query execution outcome - either success or error
 */
export type QueryOutcome =
    | { readonly kind: 'success'; readonly result: QueryResult }
    | { readonly kind: 'error'; readonly error: QueryError }
    | { readonly kind: 'cancelled' };

/**
 * Immutable query information (known at start time)
 */
export interface QueryInfo {
    readonly cluster: string;
    readonly database: string;
    readonly originalQuery: string;
}

/**
 * Represents a single query execution with observable state.
 * 
 * Immutable properties:
 * - id: unique identifier
 * - query: query information (cluster, database, queries)
 * - startTime: when execution began
 * - abortController: for cancelling the query
 * 
 * Observable properties:
 * - endTime: when execution completed (undefined while running)
 * - outcome: the result (undefined while running, then success/error/cancelled)
 */
export class QueryExecution {
    /** Unique identifier for this execution */
    public readonly id: string;

    /** Query information (immutable) */
    public readonly query: QueryInfo;

    /** Start time (immutable) */
    public readonly startTime: Date;

    /** Abort controller for cancellation */
    private readonly _abortController: AbortController;

    /** End time - undefined while running */
    private readonly _endTime: ISettableObservable<Date | undefined>;

    /** Outcome - undefined while running */
    private readonly _outcome: ISettableObservable<QueryOutcome | undefined>;

    constructor(query: QueryInfo) {
        this.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.query = query;
        this.startTime = new Date();
        this._abortController = new AbortController();
        this._endTime = observableValue(`QueryExecution(${this.id}).endTime`, undefined);
        this._outcome = observableValue(`QueryExecution(${this.id}).outcome`, undefined);
    }

    /** Abort signal for passing to fetch/network calls */
    get signal(): AbortSignal {
        return this._abortController.signal;
    }

    /** Observable end time */
    get endTime(): IObservable<Date | undefined> {
        return this._endTime;
    }

    /** Observable outcome */
    get outcome(): IObservable<QueryOutcome | undefined> {
        return this._outcome;
    }

    /** Derived: is the query still running? */
    get isRunning(): IObservable<boolean> {
        return derived(this, reader => this._outcome.read(reader) === undefined);
    }

    /**
     * Complete the execution with a successful result
     */
    complete(result: QueryResult): void {
        if (this._outcome.get() !== undefined) {
            console.warn(`QueryExecution ${this.id}: already completed`);
            return;
        }
        this._endTime.set(new Date(), undefined, undefined);
        this._outcome.set({ kind: 'success', result }, undefined, undefined);
    }

    /**
     * Fail the execution with an error
     */
    fail(error: QueryError): void {
        if (this._outcome.get() !== undefined) {
            console.warn(`QueryExecution ${this.id}: already completed`);
            return;
        }
        this._endTime.set(new Date(), undefined, undefined);
        this._outcome.set({ kind: 'error', error }, undefined, undefined);
    }

    /**
     * Cancel the execution - this will abort any in-flight network request
     */
    cancel(): void {
        if (this._outcome.get() !== undefined) {
            console.warn(`QueryExecution ${this.id}: already completed`);
            return;
        }
        // Abort the network request
        this._abortController.abort();
        this._endTime.set(new Date(), undefined, undefined);
        this._outcome.set({ kind: 'cancelled' }, undefined, undefined);
    }
}

/**
 * Serialized format for sending to webview (lightweight, no result data)
 */
export interface SerializedQueryExecution {
    id: string;
    cluster: string;
    database: string;
    originalQuery: string;
    startTime: number;
    endTime: number | undefined;
    status: 'running' | 'success' | 'error' | 'cancelled';
    /** Only included for completed queries */
    totalRows?: number;
    /** Only included for errors */
    errorMessage?: string;
}

/**
 * Full data for a selected query (includes result rows)
 */
export interface QueryExecutionFullData {
    id: string;
    cluster: string;
    database: string;
    originalQuery: string;
    resolvedQuery: string;
    startTime: number;
    endTime: number | undefined;
    status: 'running' | 'success' | 'error' | 'cancelled';
    result?: QueryResult;
    errorMessage?: string;
}

/**
 * Serialize a QueryExecution to lightweight format (no result data)
 */
export function serializeExecution(exec: QueryExecution): SerializedQueryExecution {
    const outcome = exec.outcome.get();
    const endTime = exec.endTime.get();

    let status: SerializedQueryExecution['status'] = 'running';
    let totalRows: number | undefined;
    let errorMessage: string | undefined;

    if (outcome) {
        if (outcome.kind === 'success') {
            status = 'success';
            totalRows = outcome.result.totalRows;
        } else if (outcome.kind === 'error') {
            status = 'error';
            errorMessage = outcome.error.message;
        } else {
            status = 'cancelled';
        }
    }

    return {
        id: exec.id,
        cluster: exec.query.cluster,
        database: exec.query.database,
        originalQuery: exec.query.originalQuery,
        startTime: exec.startTime.getTime(),
        endTime: endTime?.getTime(),
        status,
        totalRows,
        errorMessage,
    };
}

/**
 * Get full data for a query execution (includes result rows)
 */
export function getExecutionFullData(exec: QueryExecution): QueryExecutionFullData {
    const outcome = exec.outcome.get();
    const endTime = exec.endTime.get();

    let status: QueryExecutionFullData['status'] = 'running';
    let result: QueryResult | undefined;
    let errorMessage: string | undefined;
    let resolvedQuery = '';

    if (outcome) {
        if (outcome.kind === 'success') {
            status = 'success';
            result = outcome.result;
            resolvedQuery = outcome.result.resolvedQuery;
        } else if (outcome.kind === 'error') {
            status = 'error';
            errorMessage = outcome.error.message;
            resolvedQuery = outcome.error.resolvedQuery;
        } else {
            status = 'cancelled';
        }
    }

    return {
        id: exec.id,
        cluster: exec.query.cluster,
        database: exec.query.database,
        originalQuery: exec.query.originalQuery,
        resolvedQuery,
        startTime: exec.startTime.getTime(),
        endTime: endTime?.getTime(),
        status,
        result,
        errorMessage,
    };
}

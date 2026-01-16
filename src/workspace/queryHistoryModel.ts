import {
    ISettableObservable,
    observableValue,
    IObservable,
    transaction,
    autorun,
    IDisposable,
} from '@vscode/observables';
import {
    QueryExecution,
    SerializedQueryExecution,
    serializeExecution,
} from './queryExecution';

const MAX_HISTORY_ITEMS = 50;

/**
 * Observable model for query execution history.
 * 
 * Maintains a list of QueryExecution objects with observable state.
 * The history itself is observable, as is each execution's state.
 * 
 * Usage:
 *   const execution = queryService.execute(...);
 *   historyModel.addExecution(execution);
 */
export class QueryHistoryModel {
    /** Observable list of executions (most recent first) */
    private readonly _executions: ISettableObservable<readonly QueryExecution[]>;

    /** Observable selected execution ID */
    private readonly _selectedId: ISettableObservable<string | null>;

    /** Disposables for execution state watchers */
    private readonly _executionWatchers = new Map<string, IDisposable>();

    /** Callback for when any execution's state changes */
    private _onExecutionChanged?: () => void;

    constructor() {
        this._executions = observableValue('QueryHistoryModel.executions', []);
        this._selectedId = observableValue('QueryHistoryModel.selectedId', null);
    }

    /** Get observable list of all executions */
    get executions(): IObservable<readonly QueryExecution[]> {
        return this._executions;
    }

    /** Get observable selected ID */
    get selectedId(): IObservable<string | null> {
        return this._selectedId;
    }

    /** Get an execution by ID */
    getExecution(id: string): QueryExecution | undefined {
        return this._executions.get().find(e => e.id === id);
    }

    /** Set the selected execution */
    setSelectedId(id: string | null): void {
        this._selectedId.set(id, undefined, undefined);
    }

    /**
     * Set callback for when any execution's state changes.
     * Used by the view provider to know when to re-sync.
     */
    setOnExecutionChanged(callback: () => void): void {
        this._onExecutionChanged = callback;
    }

    /**
     * Add an execution to history and start watching its state.
     * The execution is selected automatically.
     */
    addExecution(execution: QueryExecution): void {
        // Watch for outcome changes on this execution
        const watcher = autorun(_reader => {
            // Read the outcome to subscribe to changes
            execution.outcome.get();
            // Notify that something changed
            this._onExecutionChanged?.();
        });
        this._executionWatchers.set(execution.id, watcher);

        transaction(tx => {
            const current = this._executions.get();
            this._executions.set([execution, ...current].slice(0, MAX_HISTORY_ITEMS), tx, undefined);
            this._selectedId.set(execution.id, tx, undefined);
        });
    }

    /**
     * Delete an execution from history
     */
    deleteExecution(id: string): void {
        // Clean up watcher
        const watcher = this._executionWatchers.get(id);
        if (watcher) {
            watcher.dispose();
            this._executionWatchers.delete(id);
        }

        transaction(tx => {
            const current = this._executions.get();
            this._executions.set(current.filter(e => e.id !== id), tx, undefined);
            if (this._selectedId.get() === id) {
                this._selectedId.set(null, tx, undefined);
            }
        });
    }

    /**
     * Clear all history
     */
    clearAll(): void {
        // Clean up all watchers
        for (const watcher of this._executionWatchers.values()) {
            watcher.dispose();
        }
        this._executionWatchers.clear();

        transaction(tx => {
            this._executions.set([], tx, undefined);
            this._selectedId.set(null, tx, undefined);
        });
    }

    /**
     * Get serialized state for sending to webview (lightweight, no result data)
     */
    getSerializedState(): { executions: SerializedQueryExecution[]; selectedId: string | null } {
        const executions = this._executions.get();
        return {
            executions: executions.map(serializeExecution),
            selectedId: this._selectedId.get(),
        };
    }

    /**
     * Dispose of all resources
     */
    dispose(): void {
        for (const watcher of this._executionWatchers.values()) {
            watcher.dispose();
        }
        this._executionWatchers.clear();
    }
}

// Re-export types that consumers need
export type { QueryExecution, QueryInfo, QueryResult, QueryError } from './queryExecution';
export { getExecutionFullData } from './queryExecution';
export { getQueryService, QueryService } from './queryService';

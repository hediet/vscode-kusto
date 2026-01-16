import { getKustoClient, AuthType } from '../connection';
import { QueryExecution, QueryInfo } from './queryExecution';

/**
 * Service for executing Kusto queries.
 * 
 * Creates QueryExecution objects and manages their lifecycle.
 * The execution is started immediately and runs asynchronously.
 * 
 * Usage:
 *   const execution = queryService.execute(cluster, database, query, authType);
 *   historyModel.addExecution(execution);
 *   // execution.signal is used internally for cancellation
 *   // execution.cancel() to cancel, execution.outcome to observe result
 */
export class QueryService {
    /**
     * Execute a query and return a QueryExecution that tracks its state.
     * The query starts executing immediately in the background.
     * 
     * @param cluster - Kusto cluster URL
     * @param database - Database name
     * @param originalQuery - The original query text (for display)
     * @param resolvedQuery - The resolved query text (with definitions expanded)
     * @param authType - Authentication type
     * @returns QueryExecution that can be used to track/cancel the query
     */
    execute(
        cluster: string,
        database: string,
        originalQuery: string,
        resolvedQuery: string,
        authType: AuthType
    ): QueryExecution {
        const query: QueryInfo = { cluster, database, originalQuery };
        const execution = new QueryExecution(query);

        // Start the query execution in background
        this._runQuery(execution, resolvedQuery, authType);

        return execution;
    }

    private async _runQuery(
        execution: QueryExecution,
        resolvedQuery: string,
        authType: AuthType
    ): Promise<void> {
        const client = getKustoClient();

        try {
            const result = await client.executeQuery(
                execution.query.cluster,
                execution.query.database,
                resolvedQuery,
                authType,
                execution.signal
            );

            // Check if cancelled during execution
            if (execution.signal.aborted) {
                return;
            }

            execution.complete({
                columns: result.columns,
                rows: result.rows,
                totalRows: result.totalRows,
                resolvedQuery,
                visualization: result.visualization,
            });
        } catch (e) {
            // Check if cancelled during execution
            if (execution.signal.aborted) {
                return;
            }

            const errorMessage = e instanceof Error ? e.message : String(e);
            execution.fail({
                message: errorMessage,
                resolvedQuery,
            });
        }
    }
}

// Singleton instance
let _queryService: QueryService | undefined;

export function getQueryService(): QueryService {
    if (!_queryService) {
        _queryService = new QueryService();
    }
    return _queryService;
}

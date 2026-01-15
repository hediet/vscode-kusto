import { KustoLanguageService } from '../language/kusto/kustoLanguageService';
import { getLanguageServiceCache, getKustoClient, AuthType } from '../connection';
import { ConnectionConfig, ResolvedInstruction } from '../language/akusto/instructionTypes';

/**
 * Get the appropriate language service for a set of resolved instructions.
 * Returns a schema-aware service if connection is configured and cached,
 * otherwise returns the default (schema-less) service.
 * 
 * Schema fetching happens in the background - the first request will use
 * the default service, subsequent requests will use the cached schema.
 */
export function getLanguageServiceForInstructions(
    instructions: readonly ResolvedInstruction[]
): KustoLanguageService {
    const cache = getLanguageServiceCache();

    // Extract connection info from instructions
    const { cluster, database, authType } = extractConnection(instructions);

    // No connection configured
    if (!cluster || !database) {
        return cache.getDefault();
    }

    // Return cached service if available
    if (cache.has(cluster, database)) {
        return cache.get(cluster, database);
    }

    // Trigger background fetch, return default for now
    fetchSchemaInBackground(cluster, database, authType);
    return cache.getDefault();
}

/**
 * Fetch schema in background and cache the resulting language service.
 * Safe to call multiple times - will be deduplicated by the cache.
 */
export function fetchSchemaInBackground(cluster: string, database: string, authType: AuthType = 'azureCli'): void {
    const cache = getLanguageServiceCache();
    const client = getKustoClient();

    cache.getOrCreate(cluster, database, async () => {
        return client.getSchema(cluster, database, authType);
    }).catch(err => {
        console.error(`Failed to fetch schema for ${cluster}/${database}:`, err);
    });
}

/**
 * Extract connection info from resolved instructions.
 */
export function extractConnection(
    instructions: readonly ResolvedInstruction[]
): { cluster?: string; database?: string; authType: AuthType } {
    let connection: ConnectionConfig | undefined;
    let database: string | undefined;

    for (const instr of instructions) {
        if (instr.type === 'setConnection') {
            connection = instr.value;
        } else if (instr.type === 'setDefaultDb') {
            database = instr.value;
        }
    }

    // Extract cluster and auth type from connection config
    let cluster: string | undefined;
    let authType: AuthType = 'azureCli'; // default

    if (connection) {
        if (connection.type === 'connectionString') {
            // TODO: Parse cluster from connection string
            cluster = undefined;
        } else {
            cluster = connection.cluster;
            authType = connection.type;
        }
    }

    return { cluster, database, authType };
}

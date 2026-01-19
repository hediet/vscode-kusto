import { Client, KustoConnectionStringBuilder, ClientRequestProperties } from 'azure-kusto-data';
import * as vscode from 'vscode';
import { KustoSchema, TableSchema, ColumnSchema } from '../language/kusto/kustoLanguageService';
import { AccessToken, TokenCredential, AzureCliCredential, DefaultAzureCredential } from '@azure/identity';
import { ConnectionConfig } from '../language/akusto/instructionTypes';
import { randomUUID } from 'crypto';

/** Auth type for creating clients */
export type AuthType = ConnectionConfig['type'];

/**
 * Token credential that uses VS Code's built-in authentication.
 */
class VsCodeTokenCredential implements TokenCredential {
    async getToken(scopes: string | string[]): Promise<AccessToken | null> {
        const scopeArray = Array.isArray(scopes) ? scopes : [scopes];

        const session = await vscode.authentication.getSession('microsoft', scopeArray, {
            createIfNone: true,
        });

        if (!session) {
            return null;
        }

        return {
            token: session.accessToken,
            expiresOnTimestamp: 0, // VS Code handles token refresh
        };
    }
}

/**
 * Create a token credential based on auth type.
 */
function createCredential(authType: AuthType): TokenCredential {
    switch (authType) {
        case 'azureCli':
            return new AzureCliCredential();
        case 'vscode':
            return new VsCodeTokenCredential();
        case 'defaultAzure':
        default:
            return new DefaultAzureCredential();
    }
}

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

export interface QueryResult {
    columns: string[];
    rows: unknown[][];
    totalRows: number;
    visualization?: KustoVisualization;
}

/**
 * Kusto client that supports multiple authentication methods.
 * - azureCli: Uses 'az login' credentials (recommended)
 * - vscode: Uses VS Code's built-in authentication
 * - defaultAzure: Tries multiple methods automatically
 */
export class KustoClient {
    private readonly clients = new Map<string, Client>();

    /**
     * Execute a query against a Kusto cluster.
     * @param signal - Optional AbortSignal to cancel the query. When aborted, a cancel command is sent to the server.
     */
    async executeQuery(cluster: string, database: string, query: string, authType: AuthType = 'azureCli', signal?: AbortSignal): Promise<QueryResult> {
        const client = await this._getClient(cluster, authType);

        // Create request properties with a custom clientRequestId for cancellation support
        const properties = new ClientRequestProperties();
        const clientRequestId = `vscode-kusto;${randomUUID()}`;
        properties.clientRequestId = clientRequestId;

        // Set up cancellation handler
        let abortHandler: (() => void) | undefined;
        if (signal) {
            abortHandler = () => {
                // Send cancel command to server asynchronously
                this._cancelQuery(cluster, database, clientRequestId, authType).catch(err => {
                    console.warn('Failed to cancel query:', err);
                });
            };
            signal.addEventListener('abort', abortHandler, { once: true });
        }

        try {
            const response = await client.execute(database, query, properties);

            const primaryResults = response.primaryResults[0];
            if (!primaryResults || primaryResults._rows.length === 0) {
                return { columns: [], rows: [], totalRows: 0 };
            }

            const columns = primaryResults.columns.map(c => c.name ?? '');
            const rows = primaryResults._rows.map(row =>
                columns.map((_, i) => row[i])
            );

            // Extract visualization properties from @ExtendedProperties table
            const visualization = this._extractVisualization(response);

            return {
                columns,
                rows,
                totalRows: rows.length,
                visualization,
            };
        } finally {
            // Clean up abort handler
            if (signal && abortHandler) {
                signal.removeEventListener('abort', abortHandler);
            }
        }
    }

    /**
     * Cancel a running query on the server.
     */
    private async _cancelQuery(cluster: string, database: string, clientRequestId: string, authType: AuthType): Promise<void> {
        try {
            const client = await this._getClient(cluster, authType);
            // Use the management command to cancel the query
            await client.execute(database, `.cancel query '${clientRequestId}'`);
        } catch (err) {
            // Log but don't throw - cancellation is best-effort
            console.warn(`Failed to cancel query ${clientRequestId}:`, err);
        }
    }

    /**
     * Extract visualization properties from Kusto response.
     * Kusto stores render hints in the @ExtendedProperties secondary result.
     */
    private _extractVisualization(response: { primaryResults: unknown[]; tables?: unknown[] }): KustoVisualization | undefined {
        // Look for visualization info in tables (secondary results)
        const tables = (response as { tables?: Array<{ name?: string; _rows?: unknown[][] }> }).tables;
        if (!tables) return undefined;

        for (const table of tables) {
            // Find the @ExtendedProperties table which contains visualization info
            const tableName = (table as { name?: string }).name;
            if (tableName === '@ExtendedProperties') {
                const rows = (table as { _rows?: unknown[][] })._rows;
                if (rows) {
                    for (const row of rows) {
                        // Row structure: [propertyId, key, value]
                        const key = row[1] as string;
                        if (key === 'Visualization') {
                            const value = row[2] as string;
                            try {
                                const vizProps = JSON.parse(value);
                                return {
                                    type: vizProps.Visualization ?? 'table',
                                    xColumn: vizProps.XColumn,
                                    yColumns: vizProps.YColumns?.split(',').map((s: string) => s.trim()),
                                    series: vizProps.Series,
                                    title: vizProps.Title,
                                    xTitle: vizProps.XTitle,
                                    yTitle: vizProps.YTitle,
                                    legend: vizProps.Legend,
                                    yScale: vizProps.YScale,
                                };
                            } catch {
                                // If parsing fails, try to use value as visualization type
                                return { type: value || 'table' };
                            }
                        }
                    }
                }
            }
        }

        return undefined;
    }

    /**
     * Get the schema for a database.
     * Returns tables and their columns.
     */
    async getSchema(cluster: string, database: string, authType: AuthType = 'azureCli'): Promise<KustoSchema> {
        const client = await this._getClient(cluster, authType);

        // Use .show database schema to get all tables and columns
        const query = `.show database ['${database}'] schema as json`;
        const response = await client.execute(database, query);

        const primaryResults = response.primaryResults[0];
        if (!primaryResults || primaryResults._rows.length === 0) {
            return { cluster, database, tables: [] };
        }

        // The result is a JSON string in the first column
        const schemaJson = primaryResults._rows[0][0] as string;
        const schema = JSON.parse(schemaJson);

        const tables: TableSchema[] = [];

        // Parse the schema JSON structure
        const dbSchema = schema.Databases?.[database];
        if (dbSchema?.Tables) {
            for (const [tableName, tableInfo] of Object.entries(dbSchema.Tables)) {
                const tableData = tableInfo as { OrderedColumns?: Array<{ Name: string; Type: string; DocString?: string }> };
                const columns: ColumnSchema[] = (tableData.OrderedColumns ?? []).map(col => ({
                    name: col.Name,
                    type: this._mapKustoType(col.Type),
                    docstring: col.DocString,
                }));

                tables.push({ name: tableName, columns });
            }
        }

        return { cluster, database, tables };
    }

    /**
     * Test connection to a cluster.
     */
    async testConnection(cluster: string, authType: AuthType = 'azureCli'): Promise<boolean> {
        try {
            const client = await this._getClient(cluster, authType);
            await client.execute('', 'print "test"');
            return true;
        } catch {
            return false;
        }
    }

    private async _getClient(cluster: string, authType: AuthType = 'azureCli'): Promise<Client> {
        // Normalize cluster URL
        const clusterUrl = cluster.startsWith('https://')
            ? cluster
            : `https://${cluster}`;

        // Cache key includes auth type
        const cacheKey = `${clusterUrl}:${authType}`;

        let client = this.clients.get(cacheKey);
        if (!client) {
            const credential = createCredential(authType);
            const connectionString = KustoConnectionStringBuilder.withTokenCredential(
                clusterUrl,
                credential
            );
            client = new Client(connectionString);
            this.clients.set(cacheKey, client);
        }
        return client;
    }

    private _mapKustoType(kustoType: string): string {
        // Map Kusto types to simpler names if needed
        const typeMap: Record<string, string> = {
            'System.String': 'string',
            'System.Int32': 'int',
            'System.Int64': 'long',
            'System.Double': 'real',
            'System.DateTime': 'datetime',
            'System.Boolean': 'bool',
            'System.TimeSpan': 'timespan',
            'System.Guid': 'guid',
            'System.Object': 'dynamic',
        };
        return typeMap[kustoType] ?? kustoType;
    }
}

/**
 * Singleton client instance.
 */
let _kustoClient: KustoClient | undefined;

export function getKustoClient(): KustoClient {
    if (!_kustoClient) {
        _kustoClient = new KustoClient();
    }
    return _kustoClient;
}

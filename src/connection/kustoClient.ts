import { Client, KustoConnectionStringBuilder } from 'azure-kusto-data';
import * as vscode from 'vscode';
import { KustoSchema, TableSchema, ColumnSchema } from '../language/kusto/kustoLanguageService';
import { AccessToken, TokenCredential, AzureCliCredential, DefaultAzureCredential } from '@azure/identity';
import { ConnectionConfig } from '../language/akusto/instructionTypes';

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

/**
 * Query result from Kusto.
 */
export interface QueryResult {
    /** Column names */
    columns: string[];
    /** Row data (array of arrays) */
    rows: unknown[][];
    /** Total row count (may be more than returned rows if truncated) */
    totalRows: number;
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
     */
    async executeQuery(cluster: string, database: string, query: string, authType: AuthType = 'azureCli'): Promise<QueryResult> {
        const client = await this._getClient(cluster, authType);
        const response = await client.execute(database, query);

        const primaryResults = response.primaryResults[0];
        if (!primaryResults || primaryResults._rows.length === 0) {
            return { columns: [], rows: [], totalRows: 0 };
        }

        const columns = primaryResults.columns.map(c => c.name ?? '');
        const rows = primaryResults._rows.map(row =>
            columns.map((_, i) => row[i])
        );

        return {
            columns,
            rows,
            totalRows: rows.length,
        };
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

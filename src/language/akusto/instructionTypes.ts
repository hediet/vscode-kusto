// Type definitions for instructions.
// Used as virtual content for the TypeScript language service.

export const instructionTypeDefinitions = `
/** Include another .kql file's definitions. */
declare function include(path: string): void;

/** Set the Kusto connection for queries. */
declare function setConnection(config: ConnectionConfig): void;

/** Set the default database for queries. */
declare function setDefaultDb(database: string): void;

/** Configure output settings. */
declare function setOutput(config: OutputConfig): void;

/**
 * Connection configuration.
 * - azureCli: Uses 'az login' credentials (recommended for local dev)
 * - vscode: Uses VS Code's built-in authentication
 * - defaultAzure: Tries multiple methods (env, managed identity, CLI, etc.)
 * - connectionString: Raw connection string
 */
type ConnectionConfig = 
	| { type: "azureCli"; cluster: string }
	| { type: "vscode"; cluster: string }
	| { type: "defaultAzure"; cluster: string }
	| { type: "connectionString"; connectionString: string };

interface OutputConfig {
	/** URL to open results in a web editor. */
	webEditorUrl?: string;
	/** File extension for output files. */
	fileExt?: string;
}
`;

/**
 * Connection configuration types.
 * - azureCli: Uses 'az login' credentials (recommended for local dev)
 * - vscode: Uses VS Code's built-in authentication
 * - defaultAzure: Tries multiple methods (env, managed identity, CLI, etc.)
 * - connectionString: Raw connection string
 */
export type ConnectionConfig =
    | { type: 'azureCli'; cluster: string }
    | { type: 'vscode'; cluster: string }
    | { type: 'defaultAzure'; cluster: string }
    | { type: 'connectionString'; connectionString: string };

/** Output configuration. */
export interface OutputConfig {
    webEditorUrl?: string;
    fileExt?: string;
}

/** All resolved instruction types (excluding include which is handled specially). */
export type ResolvedInstruction =
    | { type: 'setConnection'; value: ConnectionConfig }
    | { type: 'setDefaultDb'; value: string }
    | { type: 'setOutput'; value: OutputConfig };

/** Include instruction (handled separately during resolution). */
export interface IncludeInstruction {
    type: 'include';
    path: string;
}

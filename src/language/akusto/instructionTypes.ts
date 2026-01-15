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

type ConnectionConfig = 
	| { type: "azureIdentity"; cluster: string }
	| { type: "connectionString"; connectionString: string };

interface OutputConfig {
	/** URL to open results in a web editor. */
	webEditorUrl?: string;
	/** File extension for output files. */
	fileExt?: string;
}
`;

/** Connection configuration types. */
export type ConnectionConfig =
    | { type: 'azureIdentity'; cluster: string }
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

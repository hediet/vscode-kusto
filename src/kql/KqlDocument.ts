import * as vscode from 'vscode';

/**
 * Represents a range in the source document with line/column positions.
 */
export interface SourceRange {
    readonly startLine: number;
    readonly startColumn: number;
    readonly endLine: number;
    readonly endColumn: number;
}

/**
 * A variable definition like `let $events = ...`
 * The variable body extends until the next empty line (document boundary).
 */
export interface VariableDefinition {
    /** The name including the $ prefix, e.g., "$events" */
    readonly name: string;

    /** The full text of the definition including `let $name = ` and the body */
    readonly fullText: string;

    /** Range in the source document */
    readonly range: SourceRange;

    /** The document that defined this variable */
    readonly sourceDocumentIndex: number;
}

/**
 * A logical document is a section of KQL code separated by empty lines.
 * It may define variables (exports) or reference variables from other documents (imports).
 */
export interface LogicalDocument {
    /** Index of this document within the KqlDocument */
    readonly index: number;

    /** The raw text of this logical document */
    readonly text: string;

    /** Start offset in the parent KqlDocument */
    readonly startOffset: number;

    /** End offset in the parent KqlDocument */
    readonly endOffset: number;

    /** Range in terms of lines/columns */
    readonly range: SourceRange;

    /** Variables defined in this document (e.g., `let $events = ...`) */
    readonly exports: ReadonlyArray<VariableDefinition>;

    /** Variable names referenced but not defined in this document */
    readonly imports: ReadonlySet<string>;
}

/**
 * Represents a mapping between positions in different documents.
 */
export interface PositionMapping {
    /** Offset in the source (physical) document */
    readonly sourceOffset: number;

    /** Offset in the virtual (stitched) document */
    readonly virtualOffset: number;

    /** Length of the mapped region */
    readonly length: number;
}

/**
 * A virtual document is what the Kusto language service actually sees.
 * It's a stitched-together document with all dependencies resolved.
 */
export interface VirtualDocument {
    /** The stitched text */
    readonly text: string;

    /** The logical document this virtual document was created for */
    readonly sourceDocument: LogicalDocument;

    /** Mappings from source positions to virtual positions */
    readonly mappings: ReadonlyArray<PositionMapping>;

    /** 
     * Convert a position in the source document to the virtual document.
     * Returns undefined if the position is not within the source document's range.
     */
    sourceToVirtual(sourceOffset: number): number | undefined;

    /**
     * Convert a position in the virtual document to the source document.
     * Returns undefined if the position is in an injected dependency section.
     */
    virtualToSource(virtualOffset: number): number | undefined;
}

/**
 * A meta directive parsed from a comment like `// :meta.include("./defs.kql")`
 */
export interface MetaDirective {
    readonly type: 'include';
    readonly path: string;
    readonly range: SourceRange;
}

/**
 * The result of parsing a KQL file with embedded multi-document support.
 */
export interface KqlDocument {
    /** The URI of the source file */
    readonly uri: vscode.Uri;

    /** The full text of the document */
    readonly text: string;

    /** All logical documents parsed from this file */
    readonly documents: ReadonlyArray<LogicalDocument>;

    /** All meta directives (includes, etc.) */
    readonly directives: ReadonlyArray<MetaDirective>;

    /** All variable definitions across all documents */
    readonly allVariables: ReadonlyMap<string, VariableDefinition>;

    /**
     * Find the logical document at a given offset.
     */
    getDocumentAtOffset(offset: number): LogicalDocument | undefined;

    /**
     * Build a virtual document for a logical document, resolving all dependencies.
     */
    buildVirtualDocument(document: LogicalDocument): VirtualDocument;
}

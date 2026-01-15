import * as vscode from 'vscode';
import {
    KqlDocument,
    LogicalDocument,
    MetaDirective,
    PositionMapping,
    SourceRange,
    VariableDefinition,
    VirtualDocument,
} from './KqlDocument';

/**
 * Parses a KQL file into a KqlDocument with multi-document support.
 */
export class KqlDocumentParser {
    /**
     * Parse a VS Code TextDocument into a KqlDocument.
     */
    parse(document: vscode.TextDocument): KqlDocument {
        const text = document.getText();
        const uri = document.uri;

        // Parse meta directives first
        const directives = this.parseDirectives(text);

        // Split into logical documents by empty lines
        const logicalDocs = this.parseLogicalDocuments(text);

        // Collect all variable definitions
        const allVariables = new Map<string, VariableDefinition>();
        for (const doc of logicalDocs) {
            for (const varDef of doc.exports) {
                allVariables.set(varDef.name, varDef);
            }
        }

        return new KqlDocumentImpl(uri, text, logicalDocs, directives, allVariables);
    }

    /**
     * Parse meta directives from comments.
     */
    private parseDirectives(text: string): MetaDirective[] {
        const directives: MetaDirective[] = [];
        const regex = /\/\/\s*:meta\.include\("([^"]+)"\)/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
            const startOffset = match.index;
            const endOffset = startOffset + match[0].length;

            directives.push({
                type: 'include',
                path: match[1],
                range: this.offsetToRange(text, startOffset, endOffset),
            });
        }

        return directives;
    }

    /**
     * Split text into logical documents separated by empty lines.
     * An empty line is a line that contains only whitespace.
     */
    private parseLogicalDocuments(text: string): LogicalDocument[] {
        const documents: LogicalDocument[] = [];
        const lines = text.split('\n');

        let currentStart = 0;
        let currentLines: string[] = [];
        let documentIndex = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const isEmptyLine = line.trim() === '';

            if (isEmptyLine && currentLines.length > 0) {
                // End of a logical document
                const docText = currentLines.join('\n');
                const startOffset = this.getLineOffset(lines, currentStart);
                const endOffset = startOffset + docText.length;

                documents.push(this.createLogicalDocument(
                    documentIndex++,
                    docText,
                    startOffset,
                    endOffset,
                    text
                ));

                currentLines = [];
                currentStart = i + 1;
            } else if (!isEmptyLine) {
                if (currentLines.length === 0) {
                    currentStart = i;
                }
                currentLines.push(line);
            }
        }

        // Don't forget the last document if file doesn't end with empty line
        if (currentLines.length > 0) {
            const docText = currentLines.join('\n');
            const startOffset = this.getLineOffset(lines, currentStart);
            const endOffset = startOffset + docText.length;

            documents.push(this.createLogicalDocument(
                documentIndex,
                docText,
                startOffset,
                endOffset,
                text
            ));
        }

        return documents;
    }

    /**
     * Create a LogicalDocument, parsing exports and imports.
     */
    private createLogicalDocument(
        index: number,
        text: string,
        startOffset: number,
        endOffset: number,
        fullText: string
    ): LogicalDocument {
        const exports = this.parseExports(text, startOffset, index);
        const imports = this.parseImports(text, exports);

        return {
            index,
            text,
            startOffset,
            endOffset,
            range: this.offsetToRange(fullText, startOffset, endOffset),
            exports,
            imports,
        };
    }

    /**
     * Parse variable definitions (exports) from a logical document.
     * Matches patterns like `let $varName = ...`
     */
    private parseExports(
        text: string,
        baseOffset: number,
        documentIndex: number
    ): VariableDefinition[] {
        const exports: VariableDefinition[] = [];

        // Match: let $varName = (captures the rest of the document as the body)
        const regex = /let\s+(\$\w+)\s*=/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
            const name = match[1];
            const startInDoc = match.index;

            // The full text includes everything from `let $var = ` to end of document
            // (since a document is separated by empty lines)
            const fullText = text.substring(startInDoc);

            exports.push({
                name,
                fullText,
                range: this.offsetToRange(text, startInDoc, startInDoc + fullText.length),
                sourceDocumentIndex: documentIndex,
            });
        }

        return exports;
    }

    /**
     * Parse variable references (imports) from a logical document.
     * Finds all $varName that are not in the exports.
     */
    private parseImports(
        text: string,
        exports: VariableDefinition[]
    ): Set<string> {
        const imports = new Set<string>();
        const exportedNames = new Set(exports.map(e => e.name));

        // Match all $varName patterns
        const regex = /\$\w+/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
            const name = match[0];

            // Only count as import if not defined in this document
            if (!exportedNames.has(name)) {
                imports.add(name);
            }
        }

        return imports;
    }

    /**
     * Convert byte offset to line/column range.
     */
    private offsetToRange(text: string, startOffset: number, endOffset: number): SourceRange {
        let line = 0;
        let column = 0;
        let startLine = 0, startColumn = 0;
        let endLine = 0, endColumn = 0;

        for (let i = 0; i < text.length && i <= endOffset; i++) {
            if (i === startOffset) {
                startLine = line;
                startColumn = column;
            }
            if (i === endOffset) {
                endLine = line;
                endColumn = column;
                break;
            }

            if (text[i] === '\n') {
                line++;
                column = 0;
            } else {
                column++;
            }
        }

        if (endOffset >= text.length) {
            endLine = line;
            endColumn = column;
        }

        return { startLine, startColumn, endLine, endColumn };
    }

    /**
     * Get the character offset of a line number.
     */
    private getLineOffset(lines: string[], lineNumber: number): number {
        let offset = 0;
        for (let i = 0; i < lineNumber && i < lines.length; i++) {
            offset += lines[i].length + 1; // +1 for newline
        }
        return offset;
    }
}

/**
 * Implementation of KqlDocument.
 */
class KqlDocumentImpl implements KqlDocument {
    constructor(
        readonly uri: vscode.Uri,
        readonly text: string,
        readonly documents: ReadonlyArray<LogicalDocument>,
        readonly directives: ReadonlyArray<MetaDirective>,
        readonly allVariables: ReadonlyMap<string, VariableDefinition>
    ) { }

    getDocumentAtOffset(offset: number): LogicalDocument | undefined {
        return this.documents.find(
            doc => offset >= doc.startOffset && offset <= doc.endOffset
        );
    }

    buildVirtualDocument(document: LogicalDocument): VirtualDocument {
        return new VirtualDocumentBuilder(this).build(document);
    }
}

/**
 * Builds a virtual document by stitching together dependencies.
 */
class VirtualDocumentBuilder {
    constructor(private readonly kqlDoc: KqlDocument) { }

    build(sourceDocument: LogicalDocument): VirtualDocument {
        const parts: string[] = [];
        const mappings: PositionMapping[] = [];
        let virtualOffset = 0;

        // First, add all imported variable definitions
        const processedVars = new Set<string>();

        for (const importName of sourceDocument.imports) {
            if (processedVars.has(importName)) continue;
            processedVars.add(importName);

            const varDef = this.kqlDoc.allVariables.get(importName);
            if (varDef) {
                // Add the variable definition
                const defText = varDef.fullText;
                parts.push(defText);
                parts.push(';\n'); // Separate with semicolon and newline

                // No mapping for injected code (it's not in the source document)
                virtualOffset += defText.length + 2;
            }
        }

        // Then add the source document itself
        const sourceStartInVirtual = virtualOffset;
        parts.push(sourceDocument.text);

        // Add mapping for the source document
        mappings.push({
            sourceOffset: sourceDocument.startOffset,
            virtualOffset: sourceStartInVirtual,
            length: sourceDocument.text.length,
        });

        return new VirtualDocumentImpl(
            parts.join(''),
            sourceDocument,
            mappings
        );
    }
}

/**
 * Implementation of VirtualDocument.
 */
class VirtualDocumentImpl implements VirtualDocument {
    constructor(
        readonly text: string,
        readonly sourceDocument: LogicalDocument,
        readonly mappings: ReadonlyArray<PositionMapping>
    ) { }

    sourceToVirtual(sourceOffset: number): number | undefined {
        for (const mapping of this.mappings) {
            if (sourceOffset >= mapping.sourceOffset &&
                sourceOffset < mapping.sourceOffset + mapping.length) {
                const relativeOffset = sourceOffset - mapping.sourceOffset;
                return mapping.virtualOffset + relativeOffset;
            }
        }
        return undefined;
    }

    virtualToSource(virtualOffset: number): number | undefined {
        for (const mapping of this.mappings) {
            if (virtualOffset >= mapping.virtualOffset &&
                virtualOffset < mapping.virtualOffset + mapping.length) {
                const relativeOffset = virtualOffset - mapping.virtualOffset;
                return mapping.sourceOffset + relativeOffset;
            }
        }
        return undefined;
    }
}

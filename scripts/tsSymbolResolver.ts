/**
 * TypeScript Symbol Resolver
 *
 * This module provides functionality to look up TypeScript symbols in a project.
 * It supports:
 * - Finding symbol definitions by name
 * - Resolving nested symbols using "#Container.member" syntax
 * - Getting source file locations (path, line, column)
 *
 * @example
 * ```ts
 * const resolver = new TsSymbolResolver('/path/to/project');
 * const result = resolver.findSymbol('#MyClass.myMethod');
 * // result = { filePath: 'src/foo.ts', line: 42, column: 5 }
 * ```
 */

import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Represents a resolved symbol location in the source code.
 */
export interface SymbolLocation {
    /** Absolute path to the file containing the symbol */
    filePath: string;
    /** 1-based line number */
    line: number;
    /** 1-based column number */
    column: number;
    /** The symbol's name */
    name: string;
    /** The kind of symbol (class, method, property, etc.) */
    kind: ts.SyntaxKind;
    /** Human-readable kind name */
    kindName: string;
    /** JSDoc comment if available */
    documentation?: string;
}

/**
 * Represents an enum value extracted from TypeScript types.
 */
export interface EnumValue {
    /** The literal value (string or number) */
    value: string | number;
    /** Is this a string or number literal */
    type: 'string' | 'number';
    /** Optional description from JSDoc or enum member name */
    description?: string;
}

/**
 * Options for creating a TsSymbolResolver
 */
export interface TsSymbolResolverOptions {
    /** Root directory of the TypeScript project */
    projectRoot: string;
    /** Path to tsconfig.json (optional, defaults to projectRoot/tsconfig.json) */
    tsconfigPath?: string;
    /** Additional source files to include (for testing) */
    additionalFiles?: Map<string, string>;
}

/**
 * Parses a symbol reference string.
 * Supported formats:
 * - "symbolName" - finds a top-level symbol
 * - "#Container.member" - finds a member inside a container
 * - "#Container.nested.member" - finds nested members
 *
 * @param ref The symbol reference string
 * @returns Parsed parts of the reference
 */
export function parseSymbolRef(ref: string): { parts: string[]; isQualified: boolean } {
    // Remove leading # if present
    const normalized = ref.startsWith('#') ? ref.slice(1) : ref;
    const parts = normalized.split('.');
    return {
        parts,
        isQualified: ref.startsWith('#') || parts.length > 1
    };
}

/**
 * TypeScript Symbol Resolver
 *
 * Uses the TypeScript compiler API to find symbol definitions in a project.
 */
export class TsSymbolResolver {
    private program: ts.Program;
    private typeChecker: ts.TypeChecker;
    private sourceFiles: ts.SourceFile[];
    private projectRoot: string;
    
    /** Lazily-built index of string literals for fast lookup */
    private stringLiteralIndex: Map<string, SymbolLocation> | null = null;

    /**
     * Creates a new TsSymbolResolver.
     *
     * @param options Configuration options
     */
    constructor(options: TsSymbolResolverOptions | string) {
        const opts: TsSymbolResolverOptions = typeof options === 'string'
            ? { projectRoot: options }
            : options;

        this.projectRoot = opts.projectRoot;

        const tsconfigPath = opts.tsconfigPath || path.join(this.projectRoot, 'tsconfig.json');

        if (opts.additionalFiles) {
            // Create an in-memory program for testing
            const compilerOptions: ts.CompilerOptions = {
                target: ts.ScriptTarget.ESNext,
                module: ts.ModuleKind.CommonJS,
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
                forceConsistentCasingInFileNames: true,
            };

            const fileNames = Array.from(opts.additionalFiles.keys());

            // Create a custom compiler host that reads from the additionalFiles map
            const defaultHost = ts.createCompilerHost(compilerOptions);
            const customHost: ts.CompilerHost = {
                ...defaultHost,
                getSourceFile: (fileName, languageVersion, onError) => {
                    const content = opts.additionalFiles!.get(fileName);
                    if (content !== undefined) {
                        return ts.createSourceFile(fileName, content, languageVersion, true);
                    }
                    return defaultHost.getSourceFile(fileName, languageVersion, onError);
                },
                fileExists: (fileName) => {
                    return opts.additionalFiles!.has(fileName) || defaultHost.fileExists(fileName);
                },
                readFile: (fileName) => {
                    const content = opts.additionalFiles!.get(fileName);
                    if (content !== undefined) {
                        return content;
                    }
                    return defaultHost.readFile(fileName);
                },
            };

            this.program = ts.createProgram(fileNames, compilerOptions, customHost);
            this.typeChecker = this.program.getTypeChecker();
            this.sourceFiles = this.program.getSourceFiles().filter(sf =>
                !sf.isDeclarationFile && opts.additionalFiles!.has(sf.fileName)
            );
        } else if (fs.existsSync(tsconfigPath)) {
            // Load from tsconfig.json
            const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
            if (configFile.error) {
                throw new Error(`Error reading tsconfig.json: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`);
            }

            // Use the directory containing tsconfig.json as the base path for resolving patterns
            const tsconfigDir = path.dirname(tsconfigPath);
            const parsedConfig = ts.parseJsonConfigFileContent(
                configFile.config,
                ts.sys,
                tsconfigDir
            );

            if (parsedConfig.errors.length > 0) {
                console.error('TypeScript config errors:', parsedConfig.errors.map(e => 
                    ts.flattenDiagnosticMessageText(e.messageText, '\n')
                ).join('\n'));
            }

            this.program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
            this.typeChecker = this.program.getTypeChecker();
            this.sourceFiles = this.program.getSourceFiles().filter(sf => !sf.isDeclarationFile);
        } else {
            throw new Error(`No tsconfig.json found at ${tsconfigPath}`);
        }
    }

    /**
     * Gets statistics about the loaded project.
     */
    getStats(): { sourceFileCount: number; topLevelSymbolCount: number } {
        let topLevelCount = 0;
        for (const sf of this.sourceFiles) {
            topLevelCount += sf.statements.length;
        }
        return {
            sourceFileCount: this.sourceFiles.length,
            topLevelSymbolCount: topLevelCount,
        };
    }

    /**
     * Checks if a file is loaded in this project.
     */
    hasFile(filePath: string): boolean {
        const normalized = filePath.replace(/\\/g, '/');
        return this.sourceFiles.some(sf => sf.fileName.replace(/\\/g, '/').includes(normalized));
    }

    /**
     * Finds a symbol by its reference string.
     *
     * @param symbolRef Symbol reference (e.g., "MyClass" or "#MyClass.myMethod")
     * @returns The symbol location if found, null otherwise
     */
    findSymbol(symbolRef: string): SymbolLocation | null {
        const { parts } = parseSymbolRef(symbolRef);

        if (parts.length === 0) {
            return null;
        }

        // Find the root symbol first
        const rootName = parts[0];
        const rootNode = this.findTopLevelSymbol(rootName);

        if (!rootNode) {
            return null;
        }

        // If only looking for top-level symbol, return it
        if (parts.length === 1) {
            return this.nodeToLocation(rootNode);
        }

        // Navigate through nested members
        let currentNode: ts.Node = rootNode;
        for (let i = 1; i < parts.length; i++) {
            const memberName = parts[i];
            const memberNode = this.findMember(currentNode, memberName);
            if (!memberNode) {
                return null;
            }
            currentNode = memberNode;
        }

        return this.nodeToLocation(currentNode);
    }

    /**
     * Gets enum values for a symbol by analyzing its TypeScript type.
     * 
     * Supports:
     * - String literal union types: `type Status = 'pending' | 'active' | 'completed'`
     * - Numeric literal union types: `type Code = 1 | 2 | 3`
     * - TypeScript enums: `enum Status { Pending, Active, Completed }`
     * - String enums: `enum Status { Pending = 'pending', Active = 'active' }`
     *
     * @param symbolRef Symbol reference (e.g., "#IEditTelemetryBaseData.feature")
     * @returns Array of enum values, or empty array if not an enum type
     */
    getEnumValues(symbolRef: string): EnumValue[] {
        const { parts } = parseSymbolRef(symbolRef);
        if (parts.length === 0) {
            return [];
        }

        // Find the symbol node
        const rootName = parts[0];
        const rootNode = this.findTopLevelSymbol(rootName);
        if (!rootNode) {
            return [];
        }

        let targetNode: ts.Node = rootNode;
        for (let i = 1; i < parts.length; i++) {
            const memberNode = this.findMember(targetNode, parts[i]);
            if (!memberNode) {
                return [];
            }
            targetNode = memberNode;
        }

        return this.extractEnumValuesFromNode(targetNode);
    }

    /**
     * Extracts enum values from a node's type.
     */
    private extractEnumValuesFromNode(node: ts.Node): EnumValue[] {
        const results: EnumValue[] = [];

        // Check if node is a TypeScript enum declaration
        if (ts.isEnumDeclaration(node)) {
            for (const member of node.members) {
                const name = member.name.getText();
                let value: string | number = name;
                let type: 'string' | 'number' = 'number';

                if (member.initializer) {
                    if (ts.isStringLiteral(member.initializer)) {
                        value = member.initializer.text;
                        type = 'string';
                    } else if (ts.isNumericLiteral(member.initializer)) {
                        value = parseFloat(member.initializer.text);
                        type = 'number';
                    }
                }

                results.push({ value, type, description: name });
            }
            return results;
        }

        // Get the type of the node using the type checker
        const type = this.typeChecker.getTypeAtLocation(node);
        return this.extractEnumValuesFromType(type);
    }

    /**
     * Extracts enum values from a TypeScript type.
     */
    private extractEnumValuesFromType(type: ts.Type): EnumValue[] {
        const results: EnumValue[] = [];

        // Handle union types (e.g., 'a' | 'b' | 'c' or 1 | 2 | 3)
        if (type.isUnion()) {
            for (const unionType of type.types) {
                if (unionType.isStringLiteral()) {
                    results.push({
                        value: unionType.value,
                        type: 'string',
                        description: this.getTypeDescription(unionType),
                    });
                } else if (unionType.isNumberLiteral()) {
                    results.push({
                        value: unionType.value,
                        type: 'number',
                        description: this.getTypeDescription(unionType),
                    });
                }
            }
        }

        // Handle direct string/number literal types
        if (type.isStringLiteral()) {
            results.push({
                value: (type as ts.StringLiteralType).value,
                type: 'string',
            });
        } else if (type.isNumberLiteral()) {
            results.push({
                value: (type as ts.NumberLiteralType).value,
                type: 'number',
            });
        }

        return results;
    }

    /**
     * Gets the JSDoc description for a type if available.
     */
    private getTypeDescription(type: ts.Type): string | undefined {
        const symbol = type.getSymbol();
        if (symbol) {
            const docs = symbol.getDocumentationComment(this.typeChecker);
            if (docs.length > 0) {
                return docs.map(d => d.text).join('');
            }
        }
        return undefined;
    }

    /**
     * Gets all property names from an interface or type alias.
     * Returns property names with their original casing.
     *
     * @param symbolRef Symbol reference (e.g., "IMyInterface" or "#IEditTelemetryBaseData")
     * @returns Array of property names, or empty array if not found or not an object type
     */
    getTypeProperties(symbolRef: string): string[] {
        const { parts } = parseSymbolRef(symbolRef);
        if (parts.length === 0) {
            return [];
        }

        // Find the type/interface declaration
        const rootName = parts[0];
        const rootNode = this.findTopLevelSymbol(rootName);
        if (!rootNode) {
            return [];
        }

        // If there are more parts, navigate to nested member
        let targetNode: ts.Node = rootNode;
        for (let i = 1; i < parts.length; i++) {
            const memberNode = this.findMember(targetNode, parts[i]);
            if (!memberNode) {
                return [];
            }
            targetNode = memberNode;
        }

        return this.extractPropertiesFromNode(targetNode);
    }

    /**
     * Extracts property names from a node's type.
     */
    private extractPropertiesFromNode(node: ts.Node): string[] {
        const results: string[] = [];

        // Handle interface declarations directly
        if (ts.isInterfaceDeclaration(node)) {
            for (const member of node.members) {
                if (ts.isPropertySignature(member) && member.name) {
                    results.push(member.name.getText());
                }
            }
            // Also check heritage clauses (extends)
            if (node.heritageClauses) {
                for (const clause of node.heritageClauses) {
                    for (const typeExpr of clause.types) {
                        const baseType = this.typeChecker.getTypeAtLocation(typeExpr);
                        results.push(...this.extractPropertiesFromType(baseType));
                    }
                }
            }
            return results;
        }

        // Handle type aliases
        if (ts.isTypeAliasDeclaration(node)) {
            const type = this.typeChecker.getTypeAtLocation(node);
            return this.extractPropertiesFromType(type);
        }

        // Get the type and extract properties
        const type = this.typeChecker.getTypeAtLocation(node);
        return this.extractPropertiesFromType(type);
    }

    /**
     * Extracts property names from a TypeScript type.
     */
    private extractPropertiesFromType(type: ts.Type): string[] {
        const results: string[] = [];
        const properties = type.getProperties();
        
        for (const prop of properties) {
            results.push(prop.getName());
        }

        return results;
    }

    /**
     * Finds original-cased property names from a source file.
     * Given a set of lowercase property keys, searches the file for identifiers
     * that match case-insensitively and returns their original casing.
     *
     * @param filePath Path to the source file
     * @param lowercaseKeys Set of lowercase property keys to find
     * @returns Map from lowercase key to original-cased identifier
     */
    findPropertyCasing(filePath: string, lowercaseKeys: Set<string>): Map<string, string> {
        const result = new Map<string, string>();
        
        // Find the source file
        const sourceFile = this.sourceFiles.find(sf => sf.fileName === filePath);
        if (!sourceFile) {
            return result;
        }

        const visitor = (node: ts.Node): void => {
            // Look for property assignments, property signatures, and identifiers
            if (ts.isPropertyAssignment(node) || ts.isPropertySignature(node) || ts.isShorthandPropertyAssignment(node)) {
                const name = node.name;
                if (name && ts.isIdentifier(name)) {
                    const text = name.text;
                    const lower = text.toLowerCase();
                    if (lowercaseKeys.has(lower) && !result.has(lower)) {
                        result.set(lower, text);
                    }
                }
            }
            ts.forEachChild(node, visitor);
        };

        ts.forEachChild(sourceFile, visitor);
        return result;
    }

    /**
     * Finds all symbols matching a pattern.
     *
     * @param pattern A glob-like pattern or partial name
     * @returns Array of matching symbol locations
     */
    findSymbols(pattern: string): SymbolLocation[] {
        const results: SymbolLocation[] = [];
        const regex = this.patternToRegex(pattern);

        for (const sourceFile of this.sourceFiles) {
            this.visitNode(sourceFile, (node) => {
                const name = this.getNodeName(node);
                if (name && regex.test(name)) {
                    const location = this.nodeToLocation(node);
                    if (location) {
                        results.push(location);
                    }
                }
            });
        }

        return results;
    }

    /**
     * Gets all top-level symbols in the project.
     */
    getAllTopLevelSymbols(): SymbolLocation[] {
        const results: SymbolLocation[] = [];

        for (const sourceFile of this.sourceFiles) {
            for (const statement of sourceFile.statements) {
                const location = this.nodeToLocation(statement);
                if (location) {
                    results.push(location);
                }
            }
        }

        return results;
    }

    /**
     * Builds an index of all string literals in the source files.
     * This is done lazily on first use, then cached for subsequent lookups.
     */
    private buildStringLiteralIndex(): Map<string, SymbolLocation> {
        if (this.stringLiteralIndex) {
            return this.stringLiteralIndex;
        }

        console.error('Building string literal index...');
        const startTime = performance.now();
        const index = new Map<string, SymbolLocation>();

        for (const sourceFile of this.sourceFiles) {
            const visitor = (node: ts.Node): void => {
                if (ts.isStringLiteral(node)) {
                    const text = node.text;
                    // Only index strings that look like telemetry event names
                    // (contain a dot, which is typical for event names like "editTelemetry.codeSuggested")
                    if (text.includes('.') && !index.has(text)) {
                        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
                        index.set(text, {
                            filePath: sourceFile.fileName,
                            line: line + 1,
                            column: character + 1,
                            name: text,
                            kind: node.kind,
                            kindName: 'StringLiteral',
                        });
                    }
                }
                ts.forEachChild(node, visitor);
            };
            
            ts.forEachChild(sourceFile, visitor);
        }

        const elapsed = performance.now() - startTime;
        console.error(`String index built: ${index.size} literals in ${elapsed.toFixed(0)}ms`);
        
        this.stringLiteralIndex = index;
        return index;
    }

    /**
     * Finds a string literal in the source code using the pre-built index.
     * Useful for finding telemetry event name definitions.
     *
     * @param searchText The exact text to search for (without quotes)
     * @returns The location of the first match, or null if not found
     */
    findStringLiteral(searchText: string): SymbolLocation | null {
        const index = this.buildStringLiteralIndex();
        return index.get(searchText) ?? null;
    }

    /**
     * Finds a top-level symbol by name across all source files.
     */
    private findTopLevelSymbol(name: string): ts.Node | null {
        for (const sourceFile of this.sourceFiles) {
            for (const statement of sourceFile.statements) {
                const nodeName = this.getNodeName(statement);
                if (nodeName === name) {
                    return statement;
                }
            }
        }
        return null;
    }

    /**
     * Finds a member within a container node (class, interface, object, etc.)
     */
    private findMember(container: ts.Node, memberName: string): ts.Node | null {
        // Handle different container types
        if (ts.isClassDeclaration(container) || ts.isInterfaceDeclaration(container)) {
            for (const member of container.members) {
                const name = this.getNodeName(member);
                if (name === memberName) {
                    return member;
                }
            }
        }

        if (ts.isModuleDeclaration(container) && container.body) {
            if (ts.isModuleBlock(container.body)) {
                for (const statement of container.body.statements) {
                    const name = this.getNodeName(statement);
                    if (name === memberName) {
                        return statement;
                    }
                }
            }
        }

        if (ts.isObjectLiteralExpression(container)) {
            for (const prop of container.properties) {
                const name = this.getNodeName(prop);
                if (name === memberName) {
                    return prop;
                }
            }
        }

        // Variable declaration - look at initializer
        if (ts.isVariableDeclaration(container) && container.initializer) {
            if (ts.isObjectLiteralExpression(container.initializer)) {
                return this.findMember(container.initializer, memberName);
            }
        }

        // Variable statement - look at declarations
        if (ts.isVariableStatement(container)) {
            for (const decl of container.declarationList.declarations) {
                if (decl.initializer) {
                    const found = this.findMember(decl.initializer, memberName);
                    if (found) return found;
                }
            }
        }

        // For function-like declarations, search in the body
        if (ts.isFunctionDeclaration(container) || ts.isFunctionExpression(container) || ts.isArrowFunction(container)) {
            if (container.body && ts.isBlock(container.body)) {
                for (const statement of container.body.statements) {
                    const name = this.getNodeName(statement);
                    if (name === memberName) {
                        return statement;
                    }
                }
            }
        }

        // Generic child search for other node types
        let found: ts.Node | null = null;
        ts.forEachChild(container, (child) => {
            if (found) return;
            const name = this.getNodeName(child);
            if (name === memberName) {
                found = child;
            }
        });

        return found;
    }

    /**
     * Gets the name of a node if it has one.
     */
    private getNodeName(node: ts.Node): string | null {
        // Named declarations
        if (ts.isClassDeclaration(node) ||
            ts.isFunctionDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) ||
            ts.isEnumDeclaration(node) ||
            ts.isModuleDeclaration(node)) {
            return node.name?.getText() ?? null;
        }

        // Variable declarations
        if (ts.isVariableStatement(node)) {
            const decl = node.declarationList.declarations[0];
            if (decl && ts.isIdentifier(decl.name)) {
                return decl.name.text;
            }
        }

        if (ts.isVariableDeclaration(node)) {
            if (ts.isIdentifier(node.name)) {
                return node.name.text;
            }
        }

        // Property-like members
        if (ts.isMethodDeclaration(node) ||
            ts.isPropertyDeclaration(node) ||
            ts.isPropertySignature(node) ||
            ts.isMethodSignature(node) ||
            ts.isGetAccessorDeclaration(node) ||
            ts.isSetAccessorDeclaration(node)) {
            if (node.name) {
                if (ts.isIdentifier(node.name)) {
                    return node.name.text;
                }
                if (ts.isStringLiteral(node.name)) {
                    return node.name.text;
                }
            }
        }

        // Object literal properties
        if (ts.isPropertyAssignment(node) ||
            ts.isShorthandPropertyAssignment(node)) {
            if (ts.isIdentifier(node.name)) {
                return node.name.text;
            }
            if (ts.isStringLiteral(node.name)) {
                return node.name.text;
            }
        }

        // Constructor
        if (ts.isConstructorDeclaration(node)) {
            return 'constructor';
        }

        return null;
    }

    /**
     * Converts a node to a SymbolLocation.
     */
    private nodeToLocation(node: ts.Node): SymbolLocation | null {
        const sourceFile = node.getSourceFile();
        const name = this.getNodeName(node);

        if (!name) {
            return null;
        }

        // Get the position of the name identifier, not the whole node
        let targetNode: ts.Node = node;
        if ('name' in node && (node as any).name) {
            targetNode = (node as any).name;
        }

        const { line, character } = sourceFile.getLineAndCharacterOfPosition(targetNode.getStart());

        // Get JSDoc if available
        let documentation: string | undefined;
        const jsDocs = ts.getJSDocCommentsAndTags(node);
        if (jsDocs.length > 0) {
            const comments = jsDocs
                .filter(ts.isJSDoc)
                .map(doc => doc.comment)
                .filter((c): c is string => typeof c === 'string');
            if (comments.length > 0) {
                documentation = comments.join('\n');
            }
        }

        return {
            filePath: sourceFile.fileName,
            line: line + 1, // Convert to 1-based
            column: character + 1, // Convert to 1-based
            name,
            kind: node.kind,
            kindName: ts.SyntaxKind[node.kind],
            documentation,
        };
    }

    /**
     * Visits all nodes in a tree.
     */
    private visitNode(node: ts.Node, callback: (node: ts.Node) => void): void {
        callback(node);
        ts.forEachChild(node, (child) => this.visitNode(child, callback));
    }

    /**
     * Converts a simple pattern to a regex.
     * Supports * as wildcard.
     */
    private patternToRegex(pattern: string): RegExp {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexPattern = escaped.replace(/\\\*/g, '.*');
        return new RegExp(`^${regexPattern}$`, 'i');
    }

    /**
     * Gets a relative path from the project root.
     */
    getRelativePath(absolutePath: string): string {
        return path.relative(this.projectRoot, absolutePath).replace(/\\/g, '/');
    }
}

/**
 * Options for creating source links.
 */
export interface SourceLinkOptions {
    /** Path to the output file (for relative file:// links) */
    outputPath?: string;
    /** Git commit hash for GitHub permalinks */
    commitHash?: string;
    /** GitHub repository URL (e.g., "https://github.com/microsoft/vscode") */
    repoUrl?: string;
}

/**
 * Creates markdown links to a source file location.
 * Returns both a file:// link (for local navigation) and a GitHub permalink.
 *
 * @param location The symbol location
 * @param projectRoot The project root for relative path calculation
 * @param options Additional options for link generation
 * @returns Markdown link(s) string
 */
export function createSourceLink(
    location: SymbolLocation,
    projectRoot: string,
    options?: SourceLinkOptions
): string {
    const relativePath = path.relative(projectRoot, location.filePath).replace(/\\/g, '/');
    const fileName = path.basename(relativePath);
    const links: string[] = [];

    // File link - relative to output file or project root
    if (options?.outputPath) {
        const outputDir = path.dirname(path.resolve(options.outputPath));
        const absoluteSourcePath = path.resolve(location.filePath);
        let relativeToOutput = path.relative(outputDir, absoluteSourcePath).replace(/\\/g, '/');
        // Ensure relative paths start with ./ or ../ for proper file:// URL handling
        if (!relativeToOutput.startsWith('.') && !relativeToOutput.startsWith('/')) {
            relativeToOutput = './' + relativeToOutput;
        } else if (relativeToOutput.startsWith('..')) {
            relativeToOutput = './' + relativeToOutput;
        }
        links.push(`[Source: ${fileName}](file://${relativeToOutput}#L${location.line})`);
    } else {
        links.push(`[Source: ${fileName}](file://./${relativePath}#L${location.line})`);
    }

    // GitHub permalink
    if (options?.commitHash && options?.repoUrl) {
        const githubUrl = `${options.repoUrl}/blob/${options.commitHash}/${relativePath}#L${location.line}`;
        links.push(`[Permalink](${githubUrl})`);
    }

    return links.join(' | ');
}

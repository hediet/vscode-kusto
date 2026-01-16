

# Feature Ideas

This document contains brainstorming notes for potential features.

## Column Descriptions in Autocomplete

- [x] Columns should support descriptions
- [x] Autocomplete should display these descriptions alongside column names
- [ ] Helps users understand what data each column contains without leaving the editor

### Implementation Notes

**Done:**
- `ColumnSchema` has a `docstring` field
- `createKustoLanguageService` builds a lookup map of column docstrings
- `getCompletions` adds `documentation` property to column completion items
- `CompletionProvider` passes `documentation` to VS Code's `CompletionItem`

**Still needed:**
- Update `generate-telemetry-kql.ts` to extract property `comment` fields and store them with column definitions

## Source Links in Generated KQL Files

- [x] The `generate-telemetry-kql.ts` script can look at a VS Code repository
- [x] Uses TypeScript compiler API to find symbol definitions
- [x] Add links to source files for:
  - [x] Event definitions (via symbol lookup)
  - [ ] Column definitions
  - [x] Other relevant source locations
- [x] Links use relative paths with line numbers (e.g., `src/file.ts#L42`)
- [x] Makes it easy to trace telemetry back to its origin in the codebase

### Implementation Details

The script now includes a **TypeScript Symbol Resolver** (`tsSymbolResolver.ts`) that:

1. **Parses TypeScript projects** using the TypeScript Compiler API
2. **Supports qualified symbol references** like `#MyClass.myMethod`
3. **Finds symbol definitions** including classes, interfaces, methods, properties
4. **Extracts source locations** with line and column numbers
5. **Generates markdown links** to source files

### CLI Usage

```bash
# Generate KQL with source code links
npx tsx scripts/generate-telemetry-kql.ts \
  --vscode-path D:/dev/microsoft/vscode \
  -o demo/vscode-events.kql

# Look up a specific symbol
npx tsx scripts/generate-telemetry-kql.ts \
  --lookup "#TelemetryService.publicLog" \
  --vscode-path D:/dev/microsoft/vscode
```

### Symbol Reference Format

The `--lookup` option and internal lookups support these formats:
- `SymbolName` - finds a top-level symbol (class, function, variable, etc.)
- `#Container.member` - finds a member inside a container (class method, interface property)
- `#Container.nested.member` - finds deeply nested members

### Source Files

- [scripts/generate-telemetry-kql.ts](../scripts/generate-telemetry-kql.ts) - Main CLI tool
- [scripts/tsSymbolResolver.ts](../scripts/tsSymbolResolver.ts) - TypeScript symbol resolver module
- [scripts/tsSymbolResolver.test.ts](../scripts/tsSymbolResolver.test.ts) - Tests for symbol resolver (28 tests)

## Semantic Highlighting

- [x] Semantic highlighting is not working yet
- [x] Should provide better syntax highlighting based on semantic analysis
- [x] Different highlighting for:
  - [x] Table names
  - [x] Column names
  - [x] Functions
  - [x] Variables
  - [x] Keywords

### Implementation Notes

**Done:**
- Created `SemanticTokensProvider` class in [semanticTokensProvider.ts](../src/workspace/semanticTokensProvider.ts)
- Defined `SemanticTokensLegend` with token types: keyword, function, variable, string, number, comment, operator, type, table, column, parameter
- Registered provider with `vscode.languages.registerDocumentSemanticTokensProvider`
- Processes all fragments in a document and maps tokens back using source maps
- Handles offset-to-position conversion for VS Code's line/character format

## Go to Definition

- [x] Navigate from a Kusto query to the definition being used
- [x] Support for:
  - [x] User-defined functions
  - [x] Let statements
  - [ ] Table definitions
  - [ ] Column definitions (from `.kql` definition files)
- [x] Standard VS Code "Go to Definition" (F12 / Ctrl+Click) experience

### Implementation Notes

**Done:**
- Added `getRelatedElements` method to `KustoLanguageService` wrapping Kusto's `GetRelatedElements` API
- Added `RelatedInfo`, `RelatedElement`, `RelatedElementKind` types
- Added `getRelatedElements` to `ResolvedDocumentAdapter` with source map translation
- Created `DefinitionProvider` in [definitionProvider.ts](../src/workspace/definitionProvider.ts)
- Registered with `vscode.languages.registerDefinitionProvider`
- Kusto returns elements with `kind: 'declaration' | 'reference' | 'syntax' | 'other'`

**Still needed:**
- Cross-file definition support (currently works best for same-file definitions)
- Table/column definitions from schema files would need location tracking in `TableSchema`/`ColumnSchema`

## Enum Completion

- [x] Support autocomplete for columns that have a fixed set of possible values
- [x] Often a string column can only be one of a known set of values (e.g., status codes, event types)
- [x] Autocomplete suggests these enum values when comparing against such columns
- [x] Reduces typos and helps discover valid values

### Implementation

Enum values are specified in column documentation using the `@enum-variant` annotation:

```kql
// status code
// @enum-variant "pending" Is still pending
// @enum-variant "active" Currently active
// @enum-variant "completed"
| extend status = tostring(Properties["status"])
| where status == "  // <-- triggers completion for "pending", "active", "completed"
```

When typing `columnName == "`, the extension:
1. Detects the comparison context
2. Looks up the column's definition using Kusto's `GetRelatedElements` API
3. Extracts the `@enum-variant` annotations from the column's documentation
4. Provides completions for the enum values with their descriptions

### Source Files

- [src/language/akusto/enumParser.ts](../src/language/akusto/enumParser.ts) - Parser for `@enum-variant` annotations and comparison context detection
- [src/language/akusto/enumParser.test.ts](../src/language/akusto/enumParser.test.ts) - Tests for enum parsing (18 tests)
- [src/workspace/enumCompletionProvider.ts](../src/workspace/enumCompletionProvider.ts) - VS Code completion provider

### Supported Syntax

Each variant is specified on its own line with an optional description:
```
@enum-variant "value" Optional description
```

The completion triggers on `== "` patterns:
```kql
| where status == "  // Triggers enum completion if status has @enum-variant annotations
```

# Akusto - Extended Kusto Language for VS Code

## Vision
A VS Code extension that enhances Kusto development with:
- Multi-document support (split queries by empty lines)
- Global variables (`$foo`) shared across files via `:include("./defs.kql")`
- Chapter-based organization (`# Title`) with scoped definitions
- Connection management and query execution

---

## Current Progress (Completed)

### 1. Core Data Model (`src/language/common/`)
| File | Purpose | Tests |
|------|---------|-------|
| `offsetRange.ts` | Immutable `[start, end)` range with `contains()`, `intersects()` | 26 |
| `documentOffset.ts` | `{ uri, offset }` for multi-document position tracking | - |
| `sourceMap.ts` | Maps virtual → physical offsets across files (sorted segments) | 19 |
| `sourceMapBuilder.ts` | Fluent builder for `SourceMap` with `DocumentRange` tracking | 9 |
| `sourceMap1To1.ts` | Simple 1:1 mapping for single-range transformations | 6 |
| `fileSystem.ts` | `FileSystem` abstraction + `InMemoryFileSystem` for tests | 12 |

### 2. Akusto Document Layer (`src/language/akusto/`)
| File | Purpose | Tests |
|------|---------|-------|
| `ast.ts` | AST nodes: `Instruction`, `Chapter`, `CodeBlock`, `DocumentAst` | - |
| `documentParser.ts` | Parses `.kql` text into `DocumentAst` | 13 |
| `kustoFragment.ts` | Single Kusto code fragment with `exportedName`, `referencedNames` | - |
| `akustoDocument.ts` | Parses file → fragments, tracks chapters/definitions | 22 |
| `akustoProject.ts` | Multi-document project, resolves cross-file dependencies | 24 |
| `akustoProjectLoader.ts` | Async loader with `FileSystem`, resolves `:include()` | 11 |
| `resolvedKustoDocument.ts` | Final resolved text + sourceMap + instructions | - |

### 3. Instruction System
| File | Purpose | Tests |
|------|---------|-------|
| `instructionTypes.ts` | Type definitions: `setConnection`, `setDefaultDb`, `setOutput` | - |
| `instructionResolver.ts` | TypeScript AST → typed JSON values for instruction args | 15 |
| `instructionVirtualDocument.ts` | Virtual TS doc for instruction completions | - |

### 4. Kusto Language Service (`src/language/kusto/`)
| File | Purpose | Tests |
|------|---------|-------|
| `kustoLanguageService.ts` | Wraps `@kusto/language-service-next`, schema factory | 14 |

### 5. Integration Layer (`src/language/akusto/`)
| File | Purpose | Tests |
|------|---------|-------|
| `resolvedDocumentAdapter.ts` | Bridges resolved docs to language service with source map translation | 12 |

**Total: 183 tests passing**

### Key Features Implemented
- ✅ `let $name = ...` syntax for exportable definitions
- ✅ `$name` references resolved across files
- ✅ `:include("./path.kql")` instruction parsing and resolution
- ✅ `:setConnection({ type: "azureIdentity", cluster: "..." })` with typed values
- ✅ `# Chapter Title` with private scoped definitions
- ✅ Topological dependency resolution (throws on cycles)
- ✅ Source maps for multi-file position translation
- ✅ Transitive dependency resolution across files
- ✅ `KustoLanguageService` wrapper (completions, diagnostics, semantic tokens, hover)
- ✅ `ResolvedDocumentAdapter` for source map coordinate translation
- ✅ `FileSystem` abstraction (LSP-ready, in-memory for tests)

---

## Architecture Principles

### Layered Design (Bottom → Top)
```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension                         │
│  (commands, UI, diagnostics, completion providers)          │
├─────────────────────────────────────────────────────────────┤
│                    Connection Layer                          │
│  (KustoConnectionManager, schema cache, query execution)    │
├─────────────────────────────────────────────────────────────┤
│                    Language Service Layer                    │
│  (KustoService - wraps @kusto/language-service-next)        │
├─────────────────────────────────────────────────────────────┤
│                    Akusto Layer (src/language/akusto/)      │
│  (AkustoProject, AkustoDocument, ResolvedKustoDocument)     │
├─────────────────────────────────────────────────────────────┤
│                    Common Layer (src/language/common/)      │
│  (OffsetRange, SourceMap, DocumentOffset)                   │
└─────────────────────────────────────────────────────────────┘
```


### Complexity Control Rules
1. **Each layer only depends on layers below it**
2. **Immutable data structures** - no hidden state mutations
3. **Pure functions** - given same input, same output
4. **Test-driven** - every module has co-located `.test.ts`. Prefer inline snapshot tests over multi-statement-asserts.
5. **Small files** - each file ≤ 600 lines, single aspect responsibility. Move business-logic independent code to a "common" folder, e.g. SourceMap or OffsetRange, but nothing Kusto-related

---

## Roadmap: Language Features

### Phase 1: Kusto Language Service Integration ✅ (COMPLETE)
**Goal:** Completions, diagnostics, semantic tokens on Kusto code

#### Implemented Files
```
src/language/kusto/
├── kustoLanguageService.ts       # Wraps @kusto/language-service-next ✅
├── kustoLanguageService.test.ts  # 14 tests ✅
└── index.ts                      # Exports ✅

src/language/akusto/
├── resolvedDocumentAdapter.ts       # Source map coordinate translation ✅
└── resolvedDocumentAdapter.test.ts  # 12 tests ✅
```

#### `KustoLanguageService` API ✅
```typescript
// Factory - creates service with schema baked in
function createKustoLanguageService(schema?: KustoSchema): KustoLanguageService

interface KustoLanguageService {
    // Pure functions - text in, results out
    // Positions are simply offsets in the text parameter
    getCompletions(text: string, offset: number): CompletionItem[]
    getDiagnostics(text: string): Diagnostic[]
    getSemanticTokens(text: string): SemanticToken[]
    getHover(text: string, offset: number): Hover | null
}

interface Diagnostic {
    message: string
    severity: 'error' | 'warning' | 'info'
    range: OffsetRange  // position in the text
}
```

#### ResolvedDocumentAdapter ✅
```typescript
// In src/language/akusto/ - bridges resolved docs to language service
class ResolvedDocumentAdapter {
    constructor(
        private readonly resolved: ResolvedKustoDocument,
        private readonly service: KustoLanguageService
    ) {}
    
    // Translates document offset → service offset → result → document offset
    getCompletions(docOffset: DocumentOffset): CompletionItem[]
    getDiagnostics(): DiagnosticWithDocumentRange[]
    getDiagnosticsForDocument(uri: string): DiagnosticWithDocumentRange[]  // Filter by source
    getSemanticTokens(): SemanticTokenWithDocumentRange[]
    getHover(docOffset: DocumentOffset): Hover | null
}
```

#### VS Code Provider Layer (Phase 1b - TODO)
```
src/providers/
├── completionProvider.ts     # Uses ResolvedDocumentAdapter
├── diagnosticsProvider.ts
├── semanticTokensProvider.ts
├── hoverProvider.ts
└── index.ts
```

**Key insight:** `KustoLanguageService` knows nothing about multi-file resolution or source maps. The adapter handles all coordinate translation.

---

### Phase 2: Connection Management
**Goal:** Connect to Kusto clusters, execute queries, fetch schema

#### Simplest Approach: Azure CLI
```typescript
// src/connection/kustoClient.ts
// Uses @azure/identity DefaultAzureCredential which picks up az login automatically

interface KustoClient {
    executeQuery(cluster: string, database: string, query: string): Promise<QueryResult>
    getSchema(cluster: string, database: string): Promise<KustoSchema>
}

// Simple factory - uses DefaultAzureCredential internally
function createKustoClient(): KustoClient
```

No connection manager needed initially - just create client and use it. The `:setConnection` instruction tells us which cluster/database to target.

#### Connection Flow
```
1. User has `az login` done (prerequisite)
2. Resolve document → get instructions → find setConnection + setDefaultDb
3. Call kustoClient.getSchema(cluster, database) → pass to createKustoLanguageService
4. Call kustoClient.executeQuery(cluster, database, query) → show result
```

**Why this is simplest:**
- `@azure/identity` DefaultAzureCredential handles token acquisition
- No token management, no connection caching initially
- Can add connection pooling/caching later if needed

---

### Phase 3: Schema Management
**Goal:** Fetch and cache database schemas for completions

#### Schema Flow
```
1. On document open/edit → check if we need schema for this cluster/db
2. If not cached → fetch via kustoClient.getSchema()
3. Create new KustoLanguageService with schema
4. Cache service instance per (cluster, database) pair
```

#### Cache Strategy
```typescript
class LanguageServiceCache {
    // Cache language service instances (already has schema baked in)
    get(cluster: string, database: string): KustoLanguageService | undefined
    getOrCreate(cluster: string, database: string, fetchSchema: () => Promise<KustoSchema>): Promise<KustoLanguageService>
    invalidate(cluster: string, database?: string): void
}
```

---

### Phase 4: Query Execution
**Goal:** Run queries, show results in preview

#### Execution Flow
```
1. User triggers "Run Query" on a fragment
2. Get ResolvedKustoDocument with instructions
3. Extract cluster/database from instructions
4. Execute resolved text via kustoClient
5. Show result in preview editor
```

#### Result Display
```typescript
// Virtual document scheme: kusto-result://query-{id}
class QueryResultProvider implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: Uri): string {
        const result = this.results.get(uri.path);
        return formatAsTable(result);  // or JSON, CSV
    }
}
```

---

## File Organization (Target State)
```
src/
├── language/
│   ├── common/           # ✅ Done - OffsetRange, SourceMap, etc.
│   ├── akusto/           # ✅ Done - AkustoDocument, AkustoProject, ResolvedDocumentAdapter
│   └── kusto/            # 🔜 Phase 1 - KustoLanguageService wrapper
├── connection/           # 🔜 Phase 2 - KustoClient
├── providers/            # 🔜 Phase 1 - VS Code providers
├── execution/            # 🔜 Phase 4 - Query execution + result display
└── extension.ts          # Entry point, registers everything
```

---

## Implementation Order

### Immediate (Phase 1a)
1. [ ] Create `KustoLanguageService` wrapper for `@kusto/language-service-next`
2. [ ] Test with no schema first (built-in functions only)
3. [ ] Create `ResolvedDocumentAdapter` for source map translation
4. [ ] Build `CompletionProvider` using adapter
5. [ ] Verify completions work for resolved multi-file queries

### Short-term (Phase 1b + 2)
6. [ ] Add `DiagnosticsProvider` with squiggles
7. [ ] Add `SemanticTokensProvider` for syntax highlighting  
8. [ ] Create `KustoClient` using `@azure/identity` DefaultAzureCredential
9. [ ] Wire up schema fetching → language service creation

### Medium-term (Phase 3 + 4)
10. [ ] Implement `LanguageServiceCache` for schema caching
11. [ ] Add "Run Query" command
12. [ ] Create `QueryResultProvider` for preview

### Later
13. [ ] TypeScript language service for instruction completions

---

## Risk Mitigation

### Complexity Risks
| Risk | Mitigation |
|------|------------|
| State management explosion | Immutable data, explicit state flow |
| Position mapping bugs | Extensive SourceMap tests, property-based testing |
| Auth complexity | Use `@azure/identity` DefaultAzureCredential - handles az login, managed identity, etc. |
| Schema staleness | Manual refresh command, TTL cache |

### Testing Strategy
- **Unit tests**: Every module has `.test.ts` with vitest
- **Integration tests**: End-to-end scenarios with mock language service
- **Snapshot tests**: Document resolution, source maps, diagnostics

---

## Open Questions
- [ ] Should we support `.akql` extension for enhanced files?
- [ ] Multi-cluster queries (JOIN across clusters)?
- [ ] Result visualization (charts, grids) vs plain text?


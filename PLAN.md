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

### 2. Akusto Document Layer (`src/language/akusto/`)
| File | Purpose | Tests |
|------|---------|-------|
| `ast.ts` | AST nodes: `Instruction`, `Chapter`, `CodeBlock`, `DocumentAst` | - |
| `documentParser.ts` | Parses `.kql` text into `DocumentAst` | 13 |
| `kustoFragment.ts` | Single Kusto code fragment with `exportedName`, `referencedNames` | - |
| `akustoDocument.ts` | Parses file → fragments, tracks chapters/definitions | 22 |
| `akustoProject.ts` | Multi-document project, resolves cross-file dependencies | 24 |
| `resolvedKustoDocument.ts` | Final resolved text + sourceMap + instructions | - |

### 3. Instruction System
| File | Purpose | Tests |
|------|---------|-------|
| `instructionTypes.ts` | Type definitions: `setConnection`, `setDefaultDb`, `setOutput` | - |
| `instructionResolver.ts` | TypeScript AST → typed JSON values for instruction args | 15 |
| `instructionVirtualDocument.ts` | Virtual TS doc for instruction completions | - |

**Total: 134 tests passing**

### Key Features Implemented
- ✅ `let $name = ...` syntax for exportable definitions
- ✅ `$name` references resolved across files
- ✅ `:include("./path.kql")` instruction parsing
- ✅ `:setConnection({ type: "azureIdentity", cluster: "..." })` with typed values
- ✅ `# Chapter Title` with private scoped definitions
- ✅ Topological dependency resolution (throws on cycles)
- ✅ Source maps for multi-file position translation
- ✅ Transitive dependency resolution across files

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

## Next Phase: Language Features

### Phase 1: Kusto Language Service Integration
**Goal:** Completions, diagnostics, semantic tokens on resolved code

#### New Files
```
src/language/kusto/
├── kustoService.ts          # Wraps @kusto/language-service-next
├── kustoService.test.ts
└── index.ts
```

#### `KustoService` API
```typescript
class KustoService {
    // Stateless - takes resolved doc, returns results
    getCompletions(resolved: ResolvedKustoDocument, virtualOffset: number): CompletionItem[]
    getDiagnostics(resolved: ResolvedKustoDocument): DiagnosticWithLocation[]
    getSemanticTokens(resolved: ResolvedKustoDocument): SemanticToken[]
    getHover(resolved: ResolvedKustoDocument, virtualOffset: number): Hover | null
    
    // Schema updates
    setSchema(schema: KustoSchema): void
}

interface DiagnosticWithLocation {
    diagnostic: { message: string; severity: 'error' | 'warning' | 'info' }
    virtualRange: OffsetRange
}
```

#### VS Code Provider Layer
```
src/providers/
├── completionProvider.ts     # Translates KustoService → VS Code
├── diagnosticsProvider.ts
├── semanticTokensProvider.ts
├── hoverProvider.ts
└── index.ts
```

**Key insight:** Providers do source map translation: `docOffset → virtualOffset → kustoService → virtualResult → docOffset`

---

### Phase 2: Connection Management
**Goal:** Connect to Kusto clusters via Azure CLI identity

#### New Files
```
src/connection/
├── connectionManager.ts      # Manages active connections
├── azCliAuth.ts              # `az account get-access-token`
├── kustoClient.ts            # Execute queries, get schema
└── index.ts
```

#### Connection Flow (Simple Start)
```
1. User has `az login` done
2. Extension reads :setConnection({ type: "azureIdentity", cluster: "..." })
3. Get token: `az account get-access-token --resource https://{cluster}`
4. Store in ConnectionManager (per-workspace state)
```

#### `ConnectionManager` API
```typescript
class ConnectionManager {
    // Get connection for a resolved document
    getConnection(instructions: ResolvedInstruction[]): KustoConnection | undefined
    
    // Active connections (cluster → connection)
    readonly connections: ReadonlyMap<string, KustoConnection>
}

interface KustoConnection {
    readonly cluster: string
    readonly database: string | undefined
    getAccessToken(): Promise<string>
    executeQuery(query: string, database: string): Promise<QueryResult>
    getSchema(database: string): Promise<KustoSchema>
}
```

---

### Phase 3: Schema Management
**Goal:** Fetch and cache database schemas for completions

#### Schema Flow
```
1. Connection established → fetch schema for default database
2. Cache schema per (cluster, database) pair
3. Schema changes → invalidate cache → refetch
4. Feed schema to KustoService
```

#### Cache Strategy
```typescript
class SchemaCache {
    // In-memory LRU cache
    get(cluster: string, database: string): KustoSchema | undefined
    set(cluster: string, database: string, schema: KustoSchema): void
    invalidate(cluster: string, database?: string): void
    
    // Persistence (workspace state)
    saveToStorage(): void
    loadFromStorage(): void
}
```

---

### Phase 4: Query Execution
**Goal:** Run queries, show results in preview

#### Execution Flow
```
1. User triggers "Run Query" on a fragment
2. Get ResolvedKustoDocument with instructions
3. Extract connection from instructions
4. Execute virtualText against cluster/database
5. Show result in virtual preview editor
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
│   ├── akusto/           # ✅ Done - AkustoDocument, AkustoProject
│   └── kusto/            # 🔜 Phase 1 - KustoService wrapper
├── connection/           # 🔜 Phase 2 - ConnectionManager, auth
├── schema/               # 🔜 Phase 3 - SchemaCache
├── providers/            # 🔜 Phase 1 - VS Code providers
├── execution/            # 🔜 Phase 4 - Query execution
└── extension.ts          # Entry point, registers everything
```

---

## Implementation Order

### Immediate (Phase 1a)
1. [ ] Create `KustoService` wrapper for `@kusto/language-service-next`
2. [ ] Test with hardcoded schema first (no connection)
3. [ ] Build `CompletionProvider` with source map translation
4. [ ] Verify completions work for resolved multi-file queries

### Short-term (Phase 1b + 2)
5. [ ] Add `DiagnosticsProvider` with squiggles
6. [ ] Add `SemanticTokensProvider` for syntax highlighting
7. [ ] Create `azCliAuth.ts` - simple token fetcher
8. [ ] Build `ConnectionManager` using `:setConnection` instructions

### Medium-term (Phase 3 + 4)
9. [ ] Implement `SchemaCache` with workspace persistence
10. [ ] Connect schema to `KustoService`
11. [ ] Add "Run Query" command
12. [ ] Create `QueryResultProvider` for preview

---

## Risk Mitigation

### Complexity Risks
| Risk | Mitigation |
|------|------------|
| State management explosion | Immutable data, explicit state flow |
| Position mapping bugs | Extensive SourceMap tests, property-based testing |
| Auth complexity | Start with az CLI only, add others later |
| Schema staleness | Manual refresh command, TTL cache |

### Testing Strategy
- **Unit tests**: Every module has `.test.ts` with vitest
- **Integration tests**: End-to-end scenarios with mock Kusto service
- **Snapshot tests**: Virtual document resolution, source maps

---

## Open Questions
- [ ] How to handle instruction completions (TypeScript service integration)?
- [ ] Should we support `.akql` extension for enhanced files?
- [ ] Multi-cluster queries (JOIN across clusters)?
- [ ] Result visualization (charts, grids) vs plain text?


# Akusto - Extended Kusto Language

## Problem
- Kusto doesn't support multiple queries in one file
- No global/cross-file variables
- We want: `let $foo = ...` to declare exportable variables, `$foo` to reference them

## Core Idea
File → parse → `AkustoDocument` (immutable AST)
Multiple documents → `AkustoProject` (immutable, tracks definitions)
On cursor position → `project.resolve(fragment)` → `ResolvedKustoDocument` (wraps Kusto API)

## Utilities (from vscode codebase)
- `OffsetRange` - immutable [start, endExclusive) range
- `StringEdit` - immutable set of replacements, composable, has `applyToOffset()` for position mapping

## Data Model

### KustoFragment (immutable)
```ts
class KustoFragment {
    readonly text: string
    readonly range: OffsetRange      // position in source document
    readonly exportedName: string | null  // "$events" if `let $events = ...`
    readonly referencedNames: string[]    // ["$foo", "$bar"]
}
```

### AkustoDocument (immutable)
```ts
class AkustoDocument {
    readonly uri: string
    readonly text: string
    readonly fragments: readonly KustoFragment[]
    readonly meta: AkustoMeta  // includes, etc.
    
    static parse(uri: string, text: string): AkustoDocument
    getFragmentAt(offset: number): KustoFragment | undefined
    withEdit(edit: StringEdit): AkustoDocument  // returns new instance
}
```

### AkustoProject (immutable)
```ts
class AkustoProject {
    readonly documents: ReadonlyMap<string, AkustoDocument>
    
    withDocument(doc: AkustoDocument): AkustoProject
    getDefinitions(): Map<string, { fragment: KustoFragment, doc: AkustoDocument }>
    getDefinition(name: string): { fragment: KustoFragment, doc: AkustoDocument } | undefined
    resolve(fragment: KustoFragment): ResolvedKustoDocument
}
```

### DocumentOffset
```ts
interface DocumentOffset {
    readonly uri: string
    readonly offset: number
}
```

### SourceMap (maps virtual offsets → physical locations)
```ts
class SourceMap {
    // Segments MUST be sorted by virtualRange, non-overlapping (invariant enforced in ctor)
    readonly segments: readonly SourceSegment[]
    
    constructor(segments: readonly SourceSegment[])  // validates invariant
    
    toDocumentOffset(virtualOffset: number): DocumentOffset | undefined
    fromDocumentOffset(docOffset: DocumentOffset): number | undefined
}

interface SourceSegment {
    readonly virtualRange: OffsetRange    // range in virtual document
    readonly sourceUri: string            // which file this came from
    readonly sourceRange: OffsetRange     // range in source file
}
```

### ResolvedKustoDocument (simple data class, easily testable)
```ts
class ResolvedKustoDocument {
    constructor(
        readonly virtualText: string,
        readonly sourceMap: SourceMap
    ) {}
}
```

### KustoService (wraps Kusto API, has language service methods)
```ts
class KustoService {
    getCompletions(resolved: ResolvedKustoDocument, docOffset: DocumentOffset): CompletionItem[]
    getDiagnostics(resolved: ResolvedKustoDocument): Array<{ diagnostic: Diagnostic, location: DocumentOffset }>
    getHover(resolved: ResolvedKustoDocument, docOffset: DocumentOffset): Hover | null
    
    private createCodeService(text: string): Kusto.Language.Editor.KustoCodeService
}
```

## Resolution Algorithm

```
resolve(targetFragment):
    deps = topologicalSort(transitiveDependencies(targetFragment))
    // THROWS on cyclic dependency (we assume DAG)
    
    virtualParts = []
    segments = []
    currentOffset = 0
    
    for dep in deps:
        text = dep.text + ";"  // add semicolon to make it a statement
        segments.push({
            virtualRange: OffsetRange(currentOffset, currentOffset + text.length),
            sourceUri: dep.document.uri,
            sourceRange: dep.range
        })
        virtualParts.push(text)
        currentOffset += text.length + 1  // +1 for newline
    
    // Add target fragment
    segments.push({
        virtualRange: OffsetRange(currentOffset, currentOffset + targetFragment.text.length),
        sourceUri: targetFragment.document.uri,
        sourceRange: targetFragment.range
    })
    virtualParts.push(targetFragment.text)
    
    virtualText = virtualParts.join("\n")
    sourceMap = SourceMap(segments)
    
    return ResolvedKustoDocument(virtualText, sourceMap)
```

## SourceMap Mapping

The `SourceMap` handles multi-file position translation:

```
toDocumentOffset(virtualOffset):
    // Binary search possible since segments are sorted
    for segment in segments:
        if segment.virtualRange.contains(virtualOffset):
            localOffset = virtualOffset - segment.virtualRange.start
            return {
                uri: segment.sourceUri,
                offset: segment.sourceRange.start + localOffset
            }
    return undefined

fromDocumentOffset(docOffset):
    for segment in segments:
        if segment.sourceUri == docOffset.uri &&
           segment.sourceRange.contains(docOffset.offset):
            localOffset = docOffset.offset - segment.sourceRange.start
            return segment.virtualRange.start + localOffset
    return undefined
```

## Example

```kusto
// File: main.kql
let $events = RawEvents    ← Fragment[0], exports "$events"
| where Type == "click"

$events                     ← Fragment[1], refs "$events"  
| summarize count()
```

When cursor is in Fragment[1]:

Virtual document:
```kusto
let $events = RawEvents
| where Type == "click";
$events
| summarize count()
```

sourceEdit = `StringEdit.insert(0, "let $events = RawEvents\n| where Type == \"click\";\n")`

Physical offset 50 → `sourceEdit.applyToOffset(50)` → Virtual offset 50 + insertion length

## Assumptions
- **DAG only**: Cyclic dependencies throw an error during topological sort
- Fragments can reference definitions from any document in the project

## Open Questions
- [ ] Cross-file include resolution timing (lazy vs eager)
- [ ] Cache invalidation strategy for ResolvedKustoDocument
- [ ] How to handle parse errors in fragments
- [ ] Should SourceSegment track inserted characters (like the `;`) separately?


import { SourceMapBuilder, DocumentRange } from '../common/sourceMapBuilder';
import { OffsetRange } from '../common/offsetRange';
import { ResolvedKustoDocument } from './resolvedKustoDocument';
import { AkustoDocument } from './akustoDocument';
import { KustoFragment } from './kustoFragment';
import { Chapter, Instruction } from './ast';
import { parseInstructionExpression } from './instructionResolver';
import { ResolvedInstruction } from './instructionTypes';
import { DefinitionInfo, extractDefinitionInfo } from './definitionInfo';

/** Reference to a fragment within a document. */
export class FragmentRef {
    constructor(
        public readonly document: AkustoDocument,
        public readonly fragment: KustoFragment,
        /** The chapter this fragment belongs to, if any. */
        public readonly chapter: Chapter | undefined = undefined
    ) { }
}

/** Immutable project containing multiple Akusto documents. */
export class AkustoProject {
    /** Cached definition info, computed lazily */
    private _definitionInfoCache: Map<string, DefinitionInfo> | null = null;

    private constructor(
        public readonly documents: ReadonlyMap<string, AkustoDocument>
    ) { }

    static empty(): AkustoProject {
        return new AkustoProject(new Map());
    }

    static fromDocuments(documents: Iterable<AkustoDocument>): AkustoProject {
        const map = new Map<string, AkustoDocument>();
        for (const doc of documents) {
            map.set(doc.uri, doc);
        }
        return new AkustoProject(map);
    }

    withDocument(doc: AkustoDocument): AkustoProject {
        const newDocs = new Map(this.documents);
        newDocs.set(doc.uri, doc);
        return new AkustoProject(newDocs);
    }

    withoutDocument(uri: string): AkustoProject {
        const newDocs = new Map(this.documents);
        newDocs.delete(uri);
        return new AkustoProject(newDocs);
    }

    /** Get all global definitions across the project. */
    getDefinitions(): Map<string, FragmentRef> {
        const result = new Map<string, FragmentRef>();
        for (const doc of this.documents.values()) {
            for (const fragment of doc.topLevelFragments) {
                if (fragment.exportedName) {
                    result.set(fragment.exportedName, new FragmentRef(doc, fragment));
                }
            }
        }
        return result;
    }

    /** Get a global definition by name. */
    getDefinition(name: string): FragmentRef | undefined {
        for (const doc of this.documents.values()) {
            for (const fragment of doc.topLevelFragments) {
                if (fragment.exportedName === name) {
                    return new FragmentRef(doc, fragment);
                }
            }
        }
        return undefined;
    }

    /**
     * Get all definition info across the project.
     * Computed lazily and cached.
     */
    getDefinitionInfos(): ReadonlyMap<string, DefinitionInfo> {
        if (!this._definitionInfoCache) {
            this._definitionInfoCache = new Map();
            for (const doc of this.documents.values()) {
                for (const fragment of doc.topLevelFragments) {
                    if (fragment.exportedName) {
                        const info = extractDefinitionInfo(
                            doc.text,
                            fragment.text,
                            fragment.range.start,
                            fragment.exportedName,
                            doc.uri
                        );
                        this._definitionInfoCache.set(fragment.exportedName, info);
                    }
                }
            }
        }
        return this._definitionInfoCache;
    }

    /**
     * Get definition info by name.
     */
    getDefinitionInfo(name: string): DefinitionInfo | undefined {
        return this.getDefinitionInfos().get(name);
    }

    /** @throws Error on cyclic dependencies */
    resolve(targetDoc: AkustoDocument, targetFragment: KustoFragment): ResolvedKustoDocument {
        const startTime = performance.now();

        // Find the chapter context for this fragment
        const chapter = this._findChapterForFragment(targetDoc, targetFragment);
        const deps = this._getTransitiveDependencies(targetDoc, targetFragment, chapter);
        const builder = new SourceMapBuilder();

        // Build a map of $name -> name for variable renaming
        const renames = new Map<string, string>();
        for (const dep of deps) {
            if (dep.fragment.exportedName?.startsWith('$')) {
                // Strip $ and replace dots with underscores (Kusto doesn't allow dots in identifiers)
                const kustoName = dep.fragment.exportedName.substring(1).replace(/\./g, '_');
                renames.set(dep.fragment.exportedName, kustoName);
            }
        }

        // Emit dependencies as let statements
        for (const dep of deps) {
            const exportedName = dep.fragment.exportedName;
            if (exportedName) {
                const kustoName = renames.get(exportedName) ?? exportedName;
                // Emit: let name = <body>;
                builder.append(`let ${kustoName} = `);
                // Get the body text and its offset within the original fragment
                const { body: bodyText, bodyOffset } = this._getDefinitionBodyWithOffset(dep.fragment.text, exportedName);
                // Pass source mapping for dependencies so Go to Definition can find declarations
                const bodySourceOffset = dep.fragment.range.start + bodyOffset;
                this._appendWithRenames(builder, bodyText, renames, dep.document.uri, bodySourceOffset);
                builder.append(';\n');
            }
        }

        // Emit target fragment with variable renames, preserving source mapping for non-renamed parts
        this._appendWithRenames(builder, targetFragment.text, renames, targetDoc.uri, targetFragment.range.start);

        const { text, sourceMap } = builder.build();
        const instructions = this._collectInstructions(targetDoc, chapter);

        const totalTime = performance.now() - startTime;
        if (totalTime > 50) {
            console.log(`[Resolve] Slow: ${totalTime.toFixed(0)}ms for ${deps.length} deps`);
        }

        return new ResolvedKustoDocument(text, sourceMap, instructions);
    }

    /** Extract body from a definition (strip "let $name = " or "$name = " prefix). 
     * Handles leading comments before the let statement.
     * Returns both the body text and the offset where it starts in the original text.
     */
    private _getDefinitionBodyWithOffset(text: string, exportedName: string): { body: string; bodyOffset: number } {
        // Escape special regex characters in the name (especially $ and .)
        const escapedName = exportedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Match: optional leading content (comments/whitespace), then "let $name = ", capture the rest
        const letRegex = new RegExp(`^[\\s\\S]*?let\\s+${escapedName}\\s*=\\s*`);
        const letMatch = text.match(letRegex);
        if (letMatch) {
            const bodyOffset = letMatch[0].length;
            return { body: text.substring(bodyOffset), bodyOffset };
        }

        // Try simple "$name = " format
        const simpleRegex = new RegExp(`^[\\s\\S]*?${escapedName}\\s*=\\s*`);
        const simpleMatch = text.match(simpleRegex);
        if (simpleMatch) {
            const bodyOffset = simpleMatch[0].length;
            return { body: text.substring(bodyOffset), bodyOffset };
        }

        // Fallback: return as-is
        return { body: text, bodyOffset: 0 };
    }

    /** Extract body from a definition (strip "let $name = " or "$name = " prefix). 
     * Handles leading comments before the let statement.
     */
    private _getDefinitionBody(text: string, exportedName: string): string {
        return this._getDefinitionBodyWithOffset(text, exportedName).body;
    }

    /**
     * Append text to builder with renames, preserving source mapping for non-renamed parts.
     * Emits text piece by piece: unchanged parts get source mapping, renamed variables don't.
     */
    private _appendWithRenames(
        builder: SourceMapBuilder,
        text: string,
        renames: Map<string, string>,
        sourceUri?: string,
        sourceStartOffset?: number
    ): void {
        if (renames.size === 0 || !sourceUri || sourceStartOffset === undefined) {
            // No renames or no source mapping requested - just append the text
            if (sourceUri && sourceStartOffset !== undefined) {
                builder.append(text, new DocumentRange(sourceUri, new OffsetRange(sourceStartOffset, sourceStartOffset + text.length)));
            } else {
                builder.append(this._renameVariables(text, renames));
            }
            return;
        }

        // Find all variable occurrences that need renaming
        interface Match { start: number; end: number; replacement: string; }
        const matches: Match[] = [];

        // Sort by length descending to match longer names first
        const sortedRenames = [...renames.entries()].sort((a, b) => b[0].length - a[0].length);
        for (const [akustoName, kustoName] of sortedRenames) {
            const escapedName = akustoName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`${escapedName}(?![a-zA-Z0-9_.])`, 'g');
            let match;
            while ((match = regex.exec(text)) !== null) {
                // Check if this position is already covered by a longer match
                const overlaps = matches.some(m =>
                    (match!.index >= m.start && match!.index < m.end) ||
                    (match!.index + akustoName.length > m.start && match!.index + akustoName.length <= m.end)
                );
                if (!overlaps) {
                    matches.push({ start: match.index, end: match.index + akustoName.length, replacement: kustoName });
                }
            }
        }

        // Sort matches by position
        matches.sort((a, b) => a.start - b.start);

        // Emit text piece by piece
        let pos = 0;
        for (const match of matches) {
            // Emit unchanged part before this match (with source mapping)
            if (match.start > pos) {
                const chunk = text.substring(pos, match.start);
                builder.append(chunk, new DocumentRange(sourceUri, new OffsetRange(sourceStartOffset + pos, sourceStartOffset + match.start)));
            }
            // Emit renamed variable (without source mapping - length changed)
            builder.append(match.replacement);
            pos = match.end;
        }

        // Emit remaining unchanged text (with source mapping)
        if (pos < text.length) {
            const chunk = text.substring(pos);
            builder.append(chunk, new DocumentRange(sourceUri, new OffsetRange(sourceStartOffset + pos, sourceStartOffset + text.length)));
        }
    }

    /** Rename $variables to Kusto-compatible names. */
    private _renameVariables(text: string, renames: Map<string, string>): string {
        let result = text;
        // Sort by length descending to replace longer names first (e.g., $events.query before $events)
        const sortedRenames = [...renames.entries()].sort((a, b) => b[0].length - a[0].length);
        for (const [akustoName, kustoName] of sortedRenames) {
            // Escape special regex characters in the name (especially $ and .)
            const escapedName = akustoName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Word boundary excludes alphanumeric, underscore, and dot
            result = result.replace(new RegExp(`${escapedName}(?![a-zA-Z0-9_.])`, 'g'), kustoName);
        }
        return result;
    }

    /** Collect resolved instructions for a fragment context. */
    private _collectInstructions(doc: AkustoDocument, chapter: Chapter | undefined): ResolvedInstruction[] {
        const result: ResolvedInstruction[] = [];
        const addInstructions = (instrs: Instruction[]) => {
            for (const instr of instrs) {
                const parsed = parseInstructionExpression(instr.expression);
                if (parsed.ok && parsed.instruction.type !== 'include') {
                    result.push(parsed.instruction as ResolvedInstruction);
                }
            }
        };

        // Top-level instructions
        addInstructions(doc.ast.getInstructions());

        // Chapter instructions (if in a chapter)
        if (chapter) {
            addInstructions(chapter.getInstructions());
        }

        return result;
    }

    private _findChapterForFragment(doc: AkustoDocument, fragment: KustoFragment): Chapter | undefined {
        for (const [chapter, frags] of doc.chapterFragments) {
            if (frags.includes(fragment)) {
                return chapter;
            }
        }
        return undefined;
    }

    /** Get definition visible from a context (chapter-local first, then global). */
    private _getVisibleDefinition(
        name: string,
        contextDoc: AkustoDocument,
        contextChapter: Chapter | undefined
    ): FragmentRef | undefined {
        // Check chapter-local definitions first
        if (contextChapter) {
            const chapterFrags = contextDoc.chapterFragments.get(contextChapter) ?? [];
            for (const fragment of chapterFrags) {
                if (fragment.exportedName === name) {
                    return new FragmentRef(contextDoc, fragment, contextChapter);
                }
            }
        }
        // Fall back to global definitions
        return this.getDefinition(name);
    }

    // In topological order, throws on cyclic dependencies.
    private _getTransitiveDependencies(
        contextDoc: AkustoDocument,
        targetFragment: KustoFragment,
        contextChapter: Chapter | undefined
    ): FragmentRef[] {
        const visited = new Set<string>();
        const visiting = new Set<string>(); // For cycle detection
        const result: FragmentRef[] = [];

        const visit = (names: readonly string[]) => {
            for (const name of names) {
                if (visited.has(name)) {
                    continue;
                }
                if (visiting.has(name)) {
                    throw new Error(`Cyclic dependency detected: ${name}`);
                }

                const def = this._getVisibleDefinition(name, contextDoc, contextChapter);
                if (!def) {
                    // Unknown reference - skip (might be a built-in or external)
                    continue;
                }

                visiting.add(name);
                visit(def.fragment.referencedNames);
                visiting.delete(name);

                visited.add(name);
                result.push(def);
            }
        };

        visit(targetFragment.referencedNames);
        return result;
    }
}

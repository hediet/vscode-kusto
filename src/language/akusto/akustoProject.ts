import { SourceMapBuilder, DocumentRange } from '../common/sourceMapBuilder';
import { ResolvedKustoDocument } from './resolvedKustoDocument';
import { AkustoDocument } from './akustoDocument';
import { KustoFragment } from './kustoFragment';
import { Chapter, Instruction } from './ast';
import { parseInstructionExpression } from './instructionResolver';
import { ResolvedInstruction } from './instructionTypes';

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

    /** @throws Error on cyclic dependencies */
    resolve(targetDoc: AkustoDocument, targetFragment: KustoFragment): ResolvedKustoDocument {
        // Find the chapter context for this fragment
        const chapter = this._findChapterForFragment(targetDoc, targetFragment);
        const deps = this._getTransitiveDependencies(targetDoc, targetFragment, chapter);
        const builder = new SourceMapBuilder();

        // Build a map of $name -> name for variable renaming
        const renames = new Map<string, string>();
        for (const dep of deps) {
            if (dep.fragment.exportedName?.startsWith('$')) {
                const kustoName = dep.fragment.exportedName.substring(1); // Strip $
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
                // Get the body text (after the "= " in the original)
                const bodyText = this._getDefinitionBody(dep.fragment.text, exportedName);
                const renamedBody = this._renameVariables(bodyText, renames);
                builder.append(renamedBody, new DocumentRange(dep.document.uri, dep.fragment.range));
                builder.append(';\n');
            }
        }

        // Emit target fragment with variable renames
        const renamedTarget = this._renameVariables(targetFragment.text, renames);
        builder.append(renamedTarget, new DocumentRange(targetDoc.uri, targetFragment.range));

        const { text, sourceMap } = builder.build();
        const instructions = this._collectInstructions(targetDoc, chapter);
        return new ResolvedKustoDocument(text, sourceMap, instructions);
    }

    /** Extract body from a definition (strip "let $name = " or "$name = " prefix). */
    private _getDefinitionBody(text: string, exportedName: string): string {
        // Definition format: "let $name = <body>" or "$name = <body>"
        const letPrefix = `let ${exportedName} = `;
        if (text.startsWith(letPrefix)) {
            return text.substring(letPrefix.length);
        }
        const simplePrefix = `${exportedName} = `;
        if (text.startsWith(simplePrefix)) {
            return text.substring(simplePrefix.length);
        }
        // Fallback: return as-is
        return text;
    }

    /** Rename $variables to Kusto-compatible names. */
    private _renameVariables(text: string, renames: Map<string, string>): string {
        let result = text;
        for (const [akustoName, kustoName] of renames) {
            // Escape special regex characters in the name (especially $)
            const escapedName = akustoName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            result = result.replace(new RegExp(`${escapedName}(?![a-zA-Z0-9_])`, 'g'), kustoName);
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

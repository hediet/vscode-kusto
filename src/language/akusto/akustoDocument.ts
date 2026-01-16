import { OffsetRange } from '../common/offsetRange';
import { KustoFragment } from './kustoFragment';
import { parseDocument } from './documentParser';
import { DocumentAst, Chapter, CodeBlock } from './ast';

/**
 * Immutable Akusto document. Parses instructions, chapters, and code blocks.
 * Code blocks are further split into fragments separated by empty lines.
 * Supports global and chapter-scoped definitions via `let $name = ...` syntax.
 */
export class AkustoDocument {
    private constructor(
        public readonly uri: string,
        public readonly text: string,
        public readonly ast: DocumentAst,
        /** All fragments (top-level and in chapters). */
        public readonly fragments: readonly KustoFragment[],
        /** Top-level fragments only (globally visible definitions). */
        public readonly topLevelFragments: readonly KustoFragment[],
        /** Map from chapter to its fragments. */
        public readonly chapterFragments: ReadonlyMap<Chapter, readonly KustoFragment[]>
    ) { }

    static parse(uri: string, text: string): AkustoDocument {
        const ast = parseDocument(text);
        const allFragments: KustoFragment[] = [];
        const topLevelFragments: KustoFragment[] = [];
        const chapterFragments = new Map<Chapter, KustoFragment[]>();

        // Parse top-level code blocks
        for (const block of ast.getCodeBlocks()) {
            const frags = AkustoDocument._parseCodeBlock(text, block);
            allFragments.push(...frags);
            topLevelFragments.push(...frags);
        }

        // Parse chapter code blocks
        for (const chapter of ast.getChapters()) {
            const chapterFrags: KustoFragment[] = [];
            for (const block of chapter.getCodeBlocks()) {
                const frags = AkustoDocument._parseCodeBlock(text, block);
                allFragments.push(...frags);
                chapterFrags.push(...frags);
            }
            chapterFragments.set(chapter, chapterFrags);
        }

        return new AkustoDocument(uri, text, ast, allFragments, topLevelFragments, chapterFragments);
    }

    /**
     * Create a new document with an edit applied.
     * Currently just reparses the full document; incremental parsing can be added later.
     * 
     * @param start Start offset of the edit range
     * @param end End offset of the edit range (exclusive)
     * @param newText Text to insert at the edit range
     */
    withEdit(start: number, end: number, newText: string): AkustoDocument {
        // Apply the edit to get new text
        const newFullText = this.text.substring(0, start) + newText + this.text.substring(end);
        // For now, just reparse. Later we can implement incremental parsing.
        return AkustoDocument.parse(this.uri, newFullText);
    }

    /**
     * Apply multiple edits and return a new document.
     * Edits should be sorted by offset (ascending) - they're applied from end to start
     * to preserve offsets.
     */
    withEdits(edits: ReadonlyArray<{ start: number; end: number; text: string }>): AkustoDocument {
        if (edits.length === 0) {
            return this;
        }

        // Apply edits from end to start to preserve offsets
        let newText = this.text;
        const sortedEdits = [...edits].sort((a, b) => b.start - a.start);
        for (const edit of sortedEdits) {
            newText = newText.substring(0, edit.start) + edit.text + newText.substring(edit.end);
        }

        return AkustoDocument.parse(this.uri, newText);
    }

    /**
     * Get the fragment containing this offset.
     * Uses inclusive end to handle cursor at end of fragment.
     */
    getFragmentAt(offset: number): KustoFragment | undefined {
        return this.fragments.find(f => f.range.start <= offset && offset <= f.range.endExclusive);
    }

    /** Get the chapter containing this offset, if any. */
    getChapterAt(offset: number): Chapter | undefined {
        return this.ast.findChapterAt(offset);
    }

    /** Global definitions (top-level fragments that export a name). */
    getDefinitions(): Map<string, KustoFragment> {
        const result = new Map<string, KustoFragment>();
        for (const fragment of this.topLevelFragments) {
            if (fragment.exportedName) {
                result.set(fragment.exportedName, fragment);
            }
        }
        return result;
    }

    /** Definitions visible from a given offset (global + chapter-local if in chapter). */
    getVisibleDefinitions(offset: number): Map<string, KustoFragment> {
        const result = this.getDefinitions();
        const chapter = this.getChapterAt(offset);
        if (chapter) {
            const chapterFrags = this.chapterFragments.get(chapter) ?? [];
            for (const fragment of chapterFrags) {
                if (fragment.exportedName) {
                    result.set(fragment.exportedName, fragment);
                }
            }
        }
        return result;
    }

    /** Get chapter-local definitions for a chapter. */
    getChapterDefinitions(chapter: Chapter): Map<string, KustoFragment> {
        const result = new Map<string, KustoFragment>();
        const frags = this.chapterFragments.get(chapter) ?? [];
        for (const fragment of frags) {
            if (fragment.exportedName) {
                result.set(fragment.exportedName, fragment);
            }
        }
        return result;
    }

    /** Parse a CodeBlock into KustoFragments (split by empty lines). */
    private static _parseCodeBlock(docText: string, block: CodeBlock): KustoFragment[] {
        const fragments: KustoFragment[] = [];
        const blockText = block.text;
        const lines = blockText.split('\n');

        let fragmentStart = 0;
        let fragmentLines: string[] = [];
        let lineOffset = 0;

        const flushFragment = (endOffset: number) => {
            if (fragmentLines.length > 0) {
                const fragmentText = fragmentLines.join('\n');
                // Check if there's any non-whitespace content
                if (fragmentText.trim().length > 0) {
                    // Convert block-relative offsets to document offsets
                    // Keep the original text (with trailing whitespace) so cursor positions work
                    const docStart = block.range.start + fragmentStart;
                    const docEnd = block.range.start + endOffset;
                    const range = new OffsetRange(docStart, docEnd);

                    const exported = AkustoDocument._parseExportedName(fragmentText);
                    const referenced = AkustoDocument._parseReferencedNames(fragmentText, exported);
                    fragments.push(new KustoFragment(fragmentText, range, exported, referenced));
                }
            }
            fragmentLines = [];
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineEnd = lineOffset + line.length;
            const isEmptyLine = line.trim() === '';
            const isLastLine = i === lines.length - 1;

            if (isEmptyLine && fragmentLines.length > 0) {
                flushFragment(lineOffset > 0 ? lineOffset - 1 : 0);
                fragmentStart = lineEnd + (isLastLine ? 0 : 1);
            } else if (!isEmptyLine) {
                if (fragmentLines.length === 0) {
                    fragmentStart = lineOffset;
                }
                fragmentLines.push(line);
            }

            lineOffset = lineEnd + 1;
        }

        if (fragmentLines.length > 0) {
            flushFragment(blockText.length);
        }

        return fragments;
    }

    private static _parseExportedName(text: string): string | null {
        // Strip leading comments before looking for let statement
        const strippedText = AkustoDocument._stripLeadingComments(text);
        const match = strippedText.match(/^\s*let\s+(\$[a-zA-Z_][a-zA-Z0-9_.]*)\s*=/);
        return match ? match[1] : null;
    }

    /**
     * Strip leading single-line and multi-line comments from text.
     * Handles // comments and block comments.
     */
    private static _stripLeadingComments(text: string): string {
        let result = text;
        let changed = true;

        while (changed) {
            changed = false;
            // Strip leading whitespace
            result = result.replace(/^\s+/, '');

            // Strip single-line comment
            if (result.startsWith('//')) {
                const newlineIdx = result.indexOf('\n');
                if (newlineIdx >= 0) {
                    result = result.substring(newlineIdx + 1);
                    changed = true;
                } else {
                    // Entire text is a comment
                    return '';
                }
            }

            // Strip multi-line comment
            if (result.startsWith('/*')) {
                const endIdx = result.indexOf('*/');
                if (endIdx >= 0) {
                    result = result.substring(endIdx + 2);
                    changed = true;
                } else {
                    // Unclosed comment - return what we have
                    return result;
                }
            }
        }

        return result;
    }

    private static _parseReferencedNames(text: string, excludeExported: string | null): string[] {
        const refs = new Set<string>();
        const regex = /\$[a-zA-Z_][a-zA-Z0-9_.]*/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const name = match[0];
            if (name !== excludeExported) {
                refs.add(name);
            }
        }
        return Array.from(refs);
    }
}

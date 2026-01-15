import { OffsetRange } from '../common/offsetRange';

/** Base class for AST nodes. */
export abstract class AstNode {
    constructor(
        /** Range of this node in the source document. */
        public readonly range: OffsetRange
    ) { }

    /** Dump this node as a human-readable string. */
    abstract dump(indent?: string): string;
}

/** An instruction like `:include("./defs.kql")`. */
export class Instruction extends AstNode {
    constructor(
        /** The expression text (e.g., `include("./defs.kql")`). */
        public readonly expression: string,
        /** Range of the expression (excludes leading `:`). */
        public readonly expressionRange: OffsetRange,
        /** Full range including the `:` prefix. */
        range: OffsetRange
    ) {
        super(range);
    }

    dump(indent = ''): string {
        return `${indent}Instruction: :${this.expression}`;
    }
}

/** A chapter header like `# Query 123`. */
export class Chapter extends AstNode {
    constructor(
        /** The chapter title (e.g., `Query 123`). */
        public readonly title: string,
        /** Range of the title text (excludes `# `). */
        public readonly titleRange: OffsetRange,
        /** Child nodes within this chapter. */
        public readonly children: readonly AstNode[],
        /** Full range of the chapter (header + all children). */
        range: OffsetRange
    ) {
        super(range);
    }

    /** Get all instructions in this chapter. */
    getInstructions(): Instruction[] {
        return this.children.filter((n): n is Instruction => n instanceof Instruction);
    }

    /** Get all code blocks in this chapter. */
    getCodeBlocks(): CodeBlock[] {
        return this.children.filter((n): n is CodeBlock => n instanceof CodeBlock);
    }

    dump(indent = ''): string {
        const lines = [`${indent}Chapter: # ${this.title}`];
        for (const child of this.children) {
            lines.push(child.dump(indent + '  '));
        }
        return lines.join('\n');
    }
}

/** A block of Kusto code. */
export class CodeBlock extends AstNode {
    /** Exported name if this is a definition (e.g., `$events` from `let $events = ...`). */
    public readonly exportedName: string | null;

    constructor(
        /** The Kusto code text. */
        public readonly text: string,
        range: OffsetRange
    ) {
        super(range);
        this.exportedName = CodeBlock._parseExportedName(text);
    }

    get isDefinition(): boolean {
        return this.exportedName !== null;
    }

    dump(indent = ''): string {
        const firstLine = this.text.split('\n')[0];
        const preview = firstLine.length > 40 ? firstLine.slice(0, 40) + '...' : firstLine;
        const exported = this.exportedName ? ` [exports: ${this.exportedName}]` : '';
        return `${indent}CodeBlock: ${preview}${exported}`;
    }

    private static _parseExportedName(text: string): string | null {
        const match = text.match(/^\s*let\s+(\$[a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
        return match ? match[1] : null;
    }
}

/** Root document containing top-level nodes. */
export class DocumentAst {
    constructor(
        /** All top-level nodes (instructions, chapters, code blocks). */
        public readonly children: readonly AstNode[]
    ) { }

    /** Get all top-level instructions. */
    getInstructions(): Instruction[] {
        return this.children.filter((n): n is Instruction => n instanceof Instruction);
    }

    /** Get all chapters. */
    getChapters(): Chapter[] {
        return this.children.filter((n): n is Chapter => n instanceof Chapter);
    }

    /** Get all top-level code blocks. */
    getCodeBlocks(): CodeBlock[] {
        return this.children.filter((n): n is CodeBlock => n instanceof CodeBlock);
    }

    /** Find instruction at source offset. */
    findInstructionAt(offset: number): Instruction | undefined {
        for (const node of this.children) {
            if (node instanceof Instruction && node.expressionRange.contains(offset)) {
                return node;
            }
            if (node instanceof Chapter) {
                for (const child of node.children) {
                    if (child instanceof Instruction && child.expressionRange.contains(offset)) {
                        return child;
                    }
                }
            }
        }
        return undefined;
    }

    /** Find chapter at source offset. */
    findChapterAt(offset: number): Chapter | undefined {
        return this.getChapters().find(c => c.range.contains(offset));
    }

    /** Find node at source offset. */
    findNodeAt(offset: number): AstNode | undefined {
        for (const node of this.children) {
            if (node.range.contains(offset)) {
                if (node instanceof Chapter) {
                    for (const child of node.children) {
                        if (child.range.contains(offset)) {
                            return child;
                        }
                    }
                }
                return node;
            }
        }
        return undefined;
    }

    /** Dump the AST as a human-readable string. */
    dump(): string {
        const lines = ['DocumentAst'];
        for (const child of this.children) {
            lines.push(child.dump('  '));
        }
        return lines.join('\n');
    }
}

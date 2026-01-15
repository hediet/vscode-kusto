import { OffsetRange } from '../common/offsetRange';
import { DocumentAst, Instruction, Chapter, CodeBlock, AstNode } from './ast';

/** Line types for parsing. */
type ParsedLine =
    | { type: 'instruction'; expression: string; expressionStart: number; lineStart: number; lineEnd: number }
    | { type: 'chapter'; title: string; titleStart: number; lineStart: number; lineEnd: number }
    | { type: 'empty'; lineStart: number; lineEnd: number }
    | { type: 'code'; text: string; lineStart: number; lineEnd: number };

/** Parse document text into lines with type information. */
function parseLines(text: string): ParsedLine[] {
    const result: ParsedLine[] = [];
    const lines = text.split('\n');
    let offset = 0;

    for (const line of lines) {
        const lineStart = offset;
        const lineEnd = offset + line.length;
        const trimmed = line.trimStart();
        const leadingWhitespace = line.length - trimmed.length;

        if (trimmed === '') {
            result.push({ type: 'empty', lineStart, lineEnd });
        } else if (trimmed.startsWith(':')) {
            const expression = trimmed.slice(1);
            const expressionStart = lineStart + leadingWhitespace + 1;
            result.push({ type: 'instruction', expression, expressionStart, lineStart, lineEnd });
        } else if (trimmed.startsWith('# ')) {
            const title = trimmed.slice(2);
            const titleStart = lineStart + leadingWhitespace + 2;
            result.push({ type: 'chapter', title, titleStart, lineStart, lineEnd });
        } else {
            result.push({ type: 'code', text: line, lineStart, lineEnd });
        }

        offset = lineEnd + 1; // +1 for newline
    }

    return result;
}

/** Collect consecutive code lines into a CodeBlock. */
function collectCodeBlock(lines: ParsedLine[], startIdx: number): { block: CodeBlock; endIdx: number } {
    const codeLines: string[] = [];
    let i = startIdx;
    let rangeStart = lines[i].lineStart;
    let rangeEnd = lines[i].lineEnd;

    while (i < lines.length) {
        const line = lines[i];
        if (line.type === 'code') {
            codeLines.push(line.text);
            rangeEnd = line.lineEnd;
            i++;
        } else if (line.type === 'empty' && i + 1 < lines.length && lines[i + 1].type === 'code') {
            // Include empty lines between code
            codeLines.push('');
            rangeEnd = line.lineEnd;
            i++;
        } else {
            break;
        }
    }

    const text = codeLines.join('\n');
    const block = new CodeBlock(text, new OffsetRange(rangeStart, rangeEnd));
    return { block, endIdx: i };
}

/** Parse document text into AST. */
export function parseDocument(text: string): DocumentAst {
    const lines = parseLines(text);
    const children: AstNode[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (line.type === 'empty') {
            i++;
            continue;
        }

        if (line.type === 'instruction') {
            children.push(new Instruction(
                line.expression,
                new OffsetRange(line.expressionStart, line.lineEnd),
                new OffsetRange(line.lineStart, line.lineEnd)
            ));
            i++;
            continue;
        }

        if (line.type === 'chapter') {
            const { chapter, endIdx } = parseChapter(lines, i);
            children.push(chapter);
            i = endIdx;
            continue;
        }

        if (line.type === 'code') {
            const { block, endIdx } = collectCodeBlock(lines, i);
            children.push(block);
            i = endIdx;
            continue;
        }

        i++;
    }

    return new DocumentAst(children);
}

/** Parse a chapter starting at given line index. */
function parseChapter(lines: ParsedLine[], startIdx: number): { chapter: Chapter; endIdx: number } {
    const headerLine = lines[startIdx] as Extract<ParsedLine, { type: 'chapter' }>;
    const chapterChildren: AstNode[] = [];
    let i = startIdx + 1;
    let rangeEnd = headerLine.lineEnd;

    while (i < lines.length) {
        const line = lines[i];

        // Next chapter header ends this chapter
        if (line.type === 'chapter') {
            break;
        }

        if (line.type === 'empty') {
            rangeEnd = line.lineEnd;
            i++;
            continue;
        }

        if (line.type === 'instruction') {
            chapterChildren.push(new Instruction(
                line.expression,
                new OffsetRange(line.expressionStart, line.lineEnd),
                new OffsetRange(line.lineStart, line.lineEnd)
            ));
            rangeEnd = line.lineEnd;
            i++;
            continue;
        }

        if (line.type === 'code') {
            const { block, endIdx } = collectCodeBlock(lines, i);
            chapterChildren.push(block);
            rangeEnd = block.range.endExclusive;
            i = endIdx;
            continue;
        }

        i++;
    }

    const chapter = new Chapter(
        headerLine.title,
        new OffsetRange(headerLine.titleStart, headerLine.lineEnd),
        chapterChildren,
        new OffsetRange(headerLine.lineStart, rangeEnd)
    );

    return { chapter, endIdx: i };
}

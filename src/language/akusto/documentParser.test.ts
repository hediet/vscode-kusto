import { describe, test, expect } from 'vitest';
import { parseDocument } from './documentParser';

describe('parseDocument', () => {
    test('empty document', () => {
        const ast = parseDocument('');
        expect(ast.children).toHaveLength(0);
    });

    test('simple code block', () => {
        const ast = parseDocument('StormEvents | take 10');
        expect(ast.children).toHaveLength(1);
        const block = ast.getCodeBlocks()[0];
        expect(block.text).toBe('StormEvents | take 10');
    });

    test('instruction only', () => {
        const ast = parseDocument(':include("./defs.kql")');
        expect(ast.children).toHaveLength(1);
        const instr = ast.getInstructions()[0];
        expect(instr.expression).toBe('include("./defs.kql")');
    });

    test('instruction with leading whitespace', () => {
        const ast = parseDocument('  :setConnection({})');
        expect(ast.children).toHaveLength(1);
        const instr = ast.getInstructions()[0];
        expect(instr.expression).toBe('setConnection({})');
        expect(instr.expressionRange.start).toBe(3);
    });

    test('chapter with code', () => {
        const text = `# My Query
StormEvents | take 10`;
        const ast = parseDocument(text);
        expect(ast.children).toHaveLength(1);

        const chapter = ast.getChapters()[0];
        expect(chapter.title).toBe('My Query');
        expect(chapter.getCodeBlocks()).toHaveLength(1);
    });

    test('multiple chapters', () => {
        const text = `# First
let $a = 1

# Second
print $a`;
        const ast = parseDocument(text);
        expect(ast.getChapters()).toHaveLength(2);

        const [first, second] = ast.getChapters();
        expect(first.title).toBe('First');
        expect(second.title).toBe('Second');
    });

    test('top-level instruction and chapter', () => {
        const text = `:include("./defs.kql")

# Query
StormEvents`;
        const ast = parseDocument(text);
        expect(ast.getInstructions()).toHaveLength(1);
        expect(ast.getChapters()).toHaveLength(1);
    });

    test('instruction within chapter', () => {
        const text = `# Config
:setConnection({ type: "azureIdentity", cluster: "help" })
StormEvents`;
        const ast = parseDocument(text);
        expect(ast.getInstructions()).toHaveLength(0);

        const chapter = ast.getChapters()[0];
        expect(chapter.getInstructions()).toHaveLength(1);
        expect(chapter.getCodeBlocks()).toHaveLength(1);
    });

    test('exported definition detection', () => {
        const ast = parseDocument('let $events = StormEvents | take 10');
        const block = ast.getCodeBlocks()[0];
        expect(block.isDefinition).toBe(true);
        expect(block.exportedName).toBe('$events');
    });

    test('non-definition code block', () => {
        const ast = parseDocument('StormEvents | take 10');
        const block = ast.getCodeBlocks()[0];
        expect(block.isDefinition).toBe(false);
        expect(block.exportedName).toBeNull();
    });

    test('findInstructionAt', () => {
        const text = `:include("./test.kql")`;
        const ast = parseDocument(text);
        // Position within expression
        const instr = ast.findInstructionAt(1);
        expect(instr).toBeDefined();
        expect(instr?.expression).toBe('include("./test.kql")');
    });

    test('findChapterAt', () => {
        const text = `# Test
code here`;
        const ast = parseDocument(text);
        const chapter = ast.findChapterAt(10);
        expect(chapter).toBeDefined();
        expect(chapter?.title).toBe('Test');
    });

    test('dump output', () => {
        const text = `:include("./defs.kql")

# Query
let $x = 1
StormEvents`;
        const ast = parseDocument(text);
        expect(ast.dump()).toMatchInlineSnapshot(`
			"DocumentAst
			  Instruction: :include("./defs.kql")
			  Chapter: # Query
			    CodeBlock: let $x = 1 [exports: $x]"
		`);
    });
});

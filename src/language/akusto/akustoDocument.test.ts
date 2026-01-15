import { describe, it, expect } from 'vitest';
import { AkustoDocument } from './akustoDocument';

describe('AkustoDocument', () => {
    describe('parse single fragment', () => {
        it('parses simple query', () => {
            const doc = AkustoDocument.parse('file://test.kql', 'Events | take 10');
            expect(doc.fragments.map(f => ({ text: f.text, exported: f.exportedName, refs: f.referencedNames }))).toMatchInlineSnapshot(`
				[
				  {
				    "exported": null,
				    "refs": [],
				    "text": "Events | take 10",
				  },
				]
			`);
        });

        it('parses definition', () => {
            const doc = AkustoDocument.parse('file://test.kql', 'let $events = Events | where Type == "click"');
            expect(doc.fragments.map(f => ({ text: f.text, exported: f.exportedName, refs: f.referencedNames }))).toMatchInlineSnapshot(`
				[
				  {
				    "exported": "$events",
				    "refs": [],
				    "text": "let $events = Events | where Type == \"click\"",
				  },
				]
			`);
        });

        it('parses query referencing variable', () => {
            const doc = AkustoDocument.parse('file://test.kql', '$events | summarize count()');
            expect(doc.fragments.map(f => ({ text: f.text, exported: f.exportedName, refs: f.referencedNames }))).toMatchInlineSnapshot(`
				[
				  {
				    "exported": null,
				    "refs": [
				      "$events",
				    ],
				    "text": "$events | summarize count()",
				  },
				]
			`);
        });
    });

    describe('parse multiple fragments', () => {
        it('splits on empty line', () => {
            const doc = AkustoDocument.parse('file://test.kql',
                `let $events = Events

$events | take 10`);
            expect(doc.fragments.map(f => ({ text: f.text, exported: f.exportedName, refs: f.referencedNames }))).toMatchInlineSnapshot(`
				[
				  {
				    "exported": "$events",
				    "refs": [],
				    "text": "let $events = Events",
				  },
				  {
				    "exported": null,
				    "refs": [
				      "$events",
				    ],
				    "text": "$events | take 10",
				  },
				]
			`);
        });

        it('handles multiple empty lines between fragments', () => {
            const doc = AkustoDocument.parse('file://test.kql',
                `Events


Logs`);
            expect(doc.fragments.map(f => f.text)).toMatchInlineSnapshot(`
				[
				  "Events",
				  "Logs",
				]
			`);
        });

        it('handles multiline fragments', () => {
            const doc = AkustoDocument.parse('file://test.kql',
                `let $data = Events
| where Timestamp > ago(1h)
| project Name, Value

$data
| summarize count() by Name`);
            expect(doc.fragments.map(f => ({ text: f.text, exported: f.exportedName }))).toMatchInlineSnapshot(`
				[
				  {
				    "exported": "$data",
				    "text": "let $data = Events
				| where Timestamp > ago(1h)
				| project Name, Value",
				  },
				  {
				    "exported": null,
				    "text": "$data
				| summarize count() by Name",
				  },
				]
			`);
        });
    });

    describe('parse references', () => {
        it('finds multiple references', () => {
            const doc = AkustoDocument.parse('file://test.kql', '$a | join $b on Id | extend x = $c');
            expect(doc.fragments[0].referencedNames).toMatchInlineSnapshot(`
				[
				  "$a",
				  "$b",
				  "$c",
				]
			`);
        });

        it('excludes exported name from references', () => {
            const doc = AkustoDocument.parse('file://test.kql', 'let $events = $events | take 10');
            expect(doc.fragments[0].exportedName).toMatchInlineSnapshot(`"$events"`);
            expect(doc.fragments[0].referencedNames).toMatchInlineSnapshot(`[]`);
        });

        it('deduplicates references', () => {
            const doc = AkustoDocument.parse('file://test.kql', '$x | join $x on Id');
            expect(doc.fragments[0].referencedNames).toMatchInlineSnapshot(`
				[
				  "$x",
				]
			`);
        });
    });

    describe('getFragmentAt', () => {
        const doc = AkustoDocument.parse('file://test.kql',
            `Events

Logs`);

        it('finds fragment at start', () => {
            expect(doc.getFragmentAt(0)?.text).toMatchInlineSnapshot(`"Events"`);
        });

        it('finds fragment in middle', () => {
            expect(doc.getFragmentAt(3)?.text).toMatchInlineSnapshot(`"Events"`);
        });

        it('returns undefined in empty line', () => {
            expect(doc.getFragmentAt(7)).toMatchInlineSnapshot(`undefined`);
        });

        it('finds second fragment', () => {
            expect(doc.getFragmentAt(9)?.text).toMatchInlineSnapshot(`"Logs"`);
        });
    });

    describe('getDefinitions', () => {
        it('returns map of exported names to fragments', () => {
            const doc = AkustoDocument.parse('file://test.kql',
                `let $events = Events

let $logs = Logs

$events | join $logs`);
            const defs = doc.getDefinitions();
            expect(Array.from(defs.keys())).toMatchInlineSnapshot(`
				[
				  "$events",
				  "$logs",
				]
			`);
        });

        it('returns empty map for no definitions', () => {
            const doc = AkustoDocument.parse('file://test.kql', 'Events | take 10');
            expect(doc.getDefinitions().size).toMatchInlineSnapshot(`0`);
        });
    });

    describe('instructions and chapters', () => {
        it('parses instructions', () => {
            const doc = AkustoDocument.parse('file://test.kql',
                `:setDefaultDb("VSCode")

Events | take 10`);
            expect(doc.ast.getInstructions().map(i => i.expression)).toMatchInlineSnapshot(`
				[
				  "setDefaultDb("VSCode")",
				]
			`);
            expect(doc.fragments.map(f => f.text)).toMatchInlineSnapshot(`
				[
				  "Events | take 10",
				]
			`);
        });

        it('parses chapters with fragments', () => {
            const doc = AkustoDocument.parse('file://test.kql',
                `let $global = Events

# My Chapter

let $local = Logs

$local | take 10`);

            expect(doc.topLevelFragments.map(f => f.text)).toMatchInlineSnapshot(`
				[
				  "let $global = Events",
				]
			`);

            const chapter = doc.ast.getChapters()[0];
            const chapterFrags = doc.chapterFragments.get(chapter)!;
            expect(chapterFrags.map(f => f.text)).toMatchInlineSnapshot(`
				[
				  "let $local = Logs",
				  "$local | take 10",
				]
			`);
        });

        it('chapter definitions are private', () => {
            const doc = AkustoDocument.parse('file://test.kql',
                `let $global = Events

# Chapter 1

let $private1 = Logs

# Chapter 2

let $private2 = Requests`);

            // Global definitions only include top-level
            expect(Array.from(doc.getDefinitions().keys())).toMatchInlineSnapshot(`
				[
				  "$global",
				]
			`);

            // Chapter definitions are separate
            const [ch1, ch2] = doc.ast.getChapters();
            expect(Array.from(doc.getChapterDefinitions(ch1).keys())).toMatchInlineSnapshot(`
				[
				  "$private1",
				]
			`);
            expect(Array.from(doc.getChapterDefinitions(ch2).keys())).toMatchInlineSnapshot(`
				[
				  "$private2",
				]
			`);
        });
    });

    describe('getVisibleDefinitions', () => {
        it('returns global definitions at top level', () => {
            const doc = AkustoDocument.parse('file://test.kql',
                `let $global = Events

# Chapter

let $private = Logs`);

            // At top level (offset 0), only global is visible
            expect(Array.from(doc.getVisibleDefinitions(0).keys())).toMatchInlineSnapshot(`
				[
				  "$global",
				]
			`);
        });

        it('returns global + chapter definitions inside chapter', () => {
            const doc = AkustoDocument.parse('file://test.kql',
                `let $global = Events

# Chapter

let $private = Logs

$global | join $private`);

            // Inside chapter, both are visible
            const chapter = doc.ast.getChapters()[0];
            const insideChapter = chapter.range.start + 10;
            const visible = doc.getVisibleDefinitions(insideChapter);
            expect(Array.from(visible.keys()).sort()).toMatchInlineSnapshot(`
				[
				  "$global",
				  "$private",
				]
			`);
        });

        it('chapter definitions shadow global definitions', () => {
            const doc = AkustoDocument.parse('file://test.kql',
                `let $x = Events

# Chapter

let $x = Logs`);

            const chapter = doc.ast.getChapters()[0];
            const insideChapter = chapter.range.start + 10;
            const visible = doc.getVisibleDefinitions(insideChapter);

            // The chapter-local $x shadows the global one
            expect(visible.get('$x')?.text).toMatchInlineSnapshot(`"let $x = Logs"`);
        });
    });

    describe('getChapterAt', () => {
        it('returns chapter at offset', () => {
            const doc = AkustoDocument.parse('file://test.kql',
                `Events

# My Chapter

Logs`);

            expect(doc.getChapterAt(0)).toBeUndefined();
            expect(doc.getChapterAt(20)?.title).toBe('My Chapter');
        });
    });
});

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

    it('parses definition with dot in name', () => {
      const doc = AkustoDocument.parse('file://test.kql', 'let $events.query = Events | where Type == "click"');
      expect(doc.fragments.map(f => ({ text: f.text, exported: f.exportedName, refs: f.referencedNames }))).toMatchInlineSnapshot(`
				[
				  {
				    "exported": "$events.query",
				    "refs": [],
				    "text": "let $events.query = Events | where Type == \"click\"",
				  },
				]
			`);
    });

    it('parses definition with multiple dots in name', () => {
      const doc = AkustoDocument.parse('file://test.kql', 'let $events.debug.didViewMemory = Events');
      expect(doc.fragments.map(f => ({ text: f.text, exported: f.exportedName, refs: f.referencedNames }))).toMatchInlineSnapshot(`
				[
				  {
				    "exported": "$events.debug.didViewMemory",
				    "refs": [],
				    "text": "let $events.debug.didViewMemory = Events",
				  },
				]
			`);
    });

    it('parses definition with leading single-line comment', () => {
      const doc = AkustoDocument.parse('file://test.kql', `// Owner: sandy081
let $events.extensions_action_install = RawEventsVSCode
| where EventName == "monacoworkbench/extensions:action:install"`);
      expect(doc.fragments.map(f => ({ text: f.text, exported: f.exportedName, refs: f.referencedNames }))).toMatchInlineSnapshot(`
              [
                {
                  "exported": "$events.extensions_action_install",
                  "refs": [],
                  "text": "// Owner: sandy081
              let $events.extensions_action_install = RawEventsVSCode
              | where EventName == "monacoworkbench/extensions:action:install"",
                },
              ]
            `);
    });

    it('parses definition with leading multi-line comment', () => {
      const doc = AkustoDocument.parse('file://test.kql', `/* Owner: sandy081
   Description: Extension installs */
let $events.extensions_action_install = RawEventsVSCode`);
      expect(doc.fragments.map(f => ({ text: f.text, exported: f.exportedName, refs: f.referencedNames }))).toMatchInlineSnapshot(`
              [
                {
                  "exported": "$events.extensions_action_install",
                  "refs": [],
                  "text": "/* Owner: sandy081
                 Description: Extension installs */
              let $events.extensions_action_install = RawEventsVSCode",
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

    it('parses query referencing variable with dot in name', () => {
      const doc = AkustoDocument.parse('file://test.kql', '$events.query | summarize count()');
      expect(doc.fragments.map(f => ({ text: f.text, exported: f.exportedName, refs: f.referencedNames }))).toMatchInlineSnapshot(`
				[
				  {
				    "exported": null,
				    "refs": [
				      "$events.query",
				    ],
				    "text": "$events.query | summarize count()",
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

    it('finds fragment at end of line before empty line', () => {
      // "Events" is 6 chars (0-5), \n at 6, empty line starts at 7
      // Cursor at position 6 (right after "Events", at the newline) should still find the fragment
      expect(doc.getFragmentAt(6)?.text).toMatchInlineSnapshot(`"Events"`);
    });

    it('finds fragment at end of last line', () => {
      // "Logs" ends at position 12 (exclusive), cursor at 12 should find it
      expect(doc.getFragmentAt(12)?.text).toMatchInlineSnapshot(`"Logs"`);
    });

    it('finds multi-line fragment at end', () => {
      const multiLine = AkustoDocument.parse('file://test.kql',
        `StormEvents
| project State`);
      // Total length is 27, cursor at end should find the fragment
      expect(multiLine.getFragmentAt(27)?.text).toBe(`StormEvents
| project State`);
    });

    it('finds multi-line fragment at end before empty line', () => {
      const multiLine = AkustoDocument.parse('file://test.kql',
        `StormEvents
| project State

second`);
      // Cursor at end of "State" line (position 27) should find first fragment
      // But need to figure out exact position - let's check
      const firstFrag = multiLine.fragments[0];
      expect(firstFrag?.text).toBe(`StormEvents
| project State`);
      // Cursor just after "State" (at the newline) should still be in fragment
      expect(multiLine.getFragmentAt(firstFrag!.range.endExclusive)?.text).toBe(`StormEvents
| project State`);
    });

    it('finds fragment when cursor at end with trailing newline', () => {
      const withTrailing = AkustoDocument.parse('file://test.kql', `Events
`);
      // Cursor at position 6 (after "Events") should find the fragment
      expect(withTrailing.getFragmentAt(6)?.text).toMatchInlineSnapshot(`"Events"`);
    });

    it('finds fragment at end of document without trailing newline', () => {
      const noTrailing = AkustoDocument.parse('file://test.kql', `Events`);
      // Cursor at position 6 (end of document) should find the fragment
      expect(noTrailing.getFragmentAt(6)?.text).toMatchInlineSnapshot(`"Events"`);
    });

    it('finds fragment at end of line when followed by empty line only', () => {
      // Bug: cursor at end of "| project " before empty line doesn't get completions
      // Case 2 from user: fragment followed by just empty line (no more content)
      const doc = AkustoDocument.parse('file://test.kql',
        `StormEvents
| project 
`);
      // "StormEvents\n| project \n" = 11 + 1 + 10 + 1 = 23 chars total
      // Fragment keeps trailing space for correct cursor-to-offset mapping
      const frag = doc.fragments[0];
      expect(frag?.text).toBe(`StormEvents
| project `);
      // Cursor at position 22 (end of "| project " before newline) should find fragment
      expect(doc.getFragmentAt(22)?.text).toBe(`StormEvents
| project `);
    });

    it('finds fragment at end when followed by two empty lines', () => {
      // Another variation - fragment followed by multiple empty lines
      const doc = AkustoDocument.parse('file://test.kql',
        `StormEvents
| project 

`);
      const frag = doc.fragments[0];
      expect(frag?.text).toBe(`StormEvents
| project `);
      // Position 22 is at end of "| project " (before first \n)
      expect(doc.getFragmentAt(22)?.text).toBe(`StormEvents
| project `);
    });

    it('finds fragment at end when followed by empty line then comment', () => {
      // Case 1 from user: works - fragment, empty line, then comment
      const doc = AkustoDocument.parse('file://test.kql',
        `StormEvents
| project 

//`);
      // Should be 2 fragments - first keeps trailing space for cursor mapping
      expect(doc.fragments.length).toBe(2);
      const frag = doc.fragments[0];
      expect(frag?.text).toBe(`StormEvents
| project `);
      // Position 22 is at end of "| project " (before first \n)
      expect(doc.getFragmentAt(22)?.text).toBe(`StormEvents
| project `);
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

  describe('withEdit', () => {
    it('applies simple text insertion', () => {
      const doc = AkustoDocument.parse('file://test.kql', 'Events');
      const edited = doc.withEdit(6, 6, ' | take 10');

      expect(edited.text).toBe('Events | take 10');
      expect(edited.fragments).toHaveLength(1);
      expect(edited.fragments[0].text).toBe('Events | take 10');
    });

    it('applies text deletion', () => {
      const doc = AkustoDocument.parse('file://test.kql', 'Events | take 10');
      const edited = doc.withEdit(6, 16, '');

      expect(edited.text).toBe('Events');
    });

    it('applies text replacement', () => {
      const doc = AkustoDocument.parse('file://test.kql', 'let $x = 1');
      const edited = doc.withEdit(9, 10, '42');

      expect(edited.text).toBe('let $x = 42');
    });

    it('preserves URI', () => {
      const doc = AkustoDocument.parse('file://test.kql', 'Events');
      const edited = doc.withEdit(0, 6, 'Logs');

      expect(edited.uri).toBe('file://test.kql');
    });

    it('reparses after edit', () => {
      const doc = AkustoDocument.parse('file://test.kql', 'Events');
      expect(doc.fragments[0].exportedName).toBeNull();

      const edited = doc.withEdit(0, 6, 'let $events = Events');
      expect(edited.fragments[0].exportedName).toBe('$events');
    });
  });

  describe('withEdits', () => {
    it('applies multiple edits', () => {
      const doc = AkustoDocument.parse('file://test.kql', 'let $a = 1\nlet $b = 2');
      const edited = doc.withEdits([
        { start: 9, end: 10, text: '10' },
        { start: 20, end: 21, text: '20' },
      ]);

      expect(edited.text).toBe('let $a = 10\nlet $b = 20');
    });

    it('handles unordered edits', () => {
      const doc = AkustoDocument.parse('file://test.kql', 'AB');
      // Provide edits in reverse order - should still work
      const edited = doc.withEdits([
        { start: 1, end: 2, text: 'X' },
        { start: 0, end: 1, text: 'Y' },
      ]);

      expect(edited.text).toBe('YX');
    });

    it('returns same document for empty edits', () => {
      const doc = AkustoDocument.parse('file://test.kql', 'Events');
      const edited = doc.withEdits([]);

      expect(edited).toBe(doc);
    });
  });
});

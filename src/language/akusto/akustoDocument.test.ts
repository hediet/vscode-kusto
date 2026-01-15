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
			// The second $events is a reference, but since it equals exported, it's excluded
			// Actually, this is a weird edge case - the right side $events references something else
			// For now, we exclude the exported name from refs
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
});

import { describe, it, expect } from 'vitest';
import { AkustoProject } from './akustoProject';
import { AkustoDocument } from './akustoDocument';
import { DocumentOffset } from '../common/documentOffset';

describe('AkustoProject', () => {
	describe('empty', () => {
		it('creates empty project', () => {
			const project = AkustoProject.empty();
			expect(project.documents.size).toMatchInlineSnapshot(`0`);
		});
	});

	describe('withDocument', () => {
		it('adds document to empty project', () => {
			const doc = AkustoDocument.parse('file://a.kql', 'Events');
			const project = AkustoProject.empty().withDocument(doc);
			expect(project.documents.size).toMatchInlineSnapshot(`1`);
		});

		it('replaces existing document', () => {
			const doc1 = AkustoDocument.parse('file://a.kql', 'Events');
			const doc2 = AkustoDocument.parse('file://a.kql', 'Logs');
			const project = AkustoProject.empty()
				.withDocument(doc1)
				.withDocument(doc2);
			expect(project.documents.get('file://a.kql')?.text).toMatchInlineSnapshot(`"Logs"`);
		});

		it('is immutable', () => {
			const doc = AkustoDocument.parse('file://a.kql', 'Events');
			const project1 = AkustoProject.empty();
			const project2 = project1.withDocument(doc);
			expect(project1.documents.size).toMatchInlineSnapshot(`0`);
			expect(project2.documents.size).toMatchInlineSnapshot(`1`);
		});
	});

	describe('getDefinitions', () => {
		it('returns all definitions across documents', () => {
			const doc1 = AkustoDocument.parse('file://a.kql', 'let $events = Events');
			const doc2 = AkustoDocument.parse('file://b.kql', 'let $logs = Logs');
			const project = AkustoProject.fromDocuments([doc1, doc2]);
			
			expect(Array.from(project.getDefinitions().keys()).sort()).toMatchInlineSnapshot(`
				[
				  "$events",
				  "$logs",
				]
			`);
		});
	});

	describe('getDefinition', () => {
		it('finds definition by name', () => {
			const doc = AkustoDocument.parse('file://a.kql', 'let $events = Events');
			const project = AkustoProject.fromDocuments([doc]);
			
			expect(project.getDefinition('$events')?.fragment.text).toMatchInlineSnapshot(`"let $events = Events"`);
		});

		it('returns undefined for unknown name', () => {
			const project = AkustoProject.empty();
			expect(project.getDefinition('$unknown')).toMatchInlineSnapshot(`undefined`);
		});
	});

	describe('resolve', () => {
		it('resolves fragment with no dependencies', () => {
			const doc = AkustoDocument.parse('file://a.kql', 'Events | take 10');
			const project = AkustoProject.fromDocuments([doc]);
			const resolved = project.resolve(doc, doc.fragments[0]);
			
			expect(resolved.virtualText).toMatchInlineSnapshot(`"Events | take 10"`);
		});

		it('resolves fragment with single dependency', () => {
			const doc = AkustoDocument.parse('file://a.kql', 
`let $events = Events

$events | take 10`);
			const project = AkustoProject.fromDocuments([doc]);
			const resolved = project.resolve(doc, doc.fragments[1]);
			
			expect(resolved.virtualText).toMatchInlineSnapshot(`
				"let $events = Events;
				$events | take 10"
			`);
		});

		it('resolves fragment with cross-file dependency', () => {
			const doc1 = AkustoDocument.parse('file://defs.kql', 'let $events = Events');
			const doc2 = AkustoDocument.parse('file://main.kql', '$events | take 10');
			const project = AkustoProject.fromDocuments([doc1, doc2]);
			const resolved = project.resolve(doc2, doc2.fragments[0]);
			
			expect(resolved.virtualText).toMatchInlineSnapshot(`
				"let $events = Events;
				$events | take 10"
			`);
		});

		it('resolves transitive dependencies in topological order', () => {
			const doc = AkustoDocument.parse('file://a.kql', 
`let $a = Events

let $b = $a | where x > 0

$b | take 10`);
			const project = AkustoProject.fromDocuments([doc]);
			const resolved = project.resolve(doc, doc.fragments[2]);
			
			// $b depends on $a, so $a should come first
			expect(resolved.virtualText).toMatchInlineSnapshot(`
				"let $a = Events;
				let $b = $a | where x > 0;
				$b | take 10"
			`);
		});

		it('throws on cyclic dependency', () => {
			const doc = AkustoDocument.parse('file://a.kql', 
`let $a = $b

let $b = $a`);
			const project = AkustoProject.fromDocuments([doc]);
			
			expect(() => project.resolve(doc, doc.fragments[0])).toThrowErrorMatchingInlineSnapshot(
				`[Error: Cyclic dependency detected: $b]`
			);
		});

		it('skips unknown references (built-ins)', () => {
			const doc = AkustoDocument.parse('file://a.kql', '$unknown | take 10');
			const project = AkustoProject.fromDocuments([doc]);
			const resolved = project.resolve(doc, doc.fragments[0]);
			
			// Should not throw, just resolves without the unknown ref
			expect(resolved.virtualText).toMatchInlineSnapshot(`"$unknown | take 10"`);
		});
	});

	describe('resolve sourceMap', () => {
		it('maps virtual offset back to source', () => {
			const doc = AkustoDocument.parse('file://a.kql', 
`let $events = Events

$events | take 10`);
			const project = AkustoProject.fromDocuments([doc]);
			const resolved = project.resolve(doc, doc.fragments[1]);
			
			// Virtual text: "let $events = Events;\n$events | take 10"
			// Position in "$events | take 10" part should map back to second fragment
			const virtualEventPos = resolved.virtualText.indexOf('$events | take');
			const docOffset = resolved.sourceMap.toDocumentOffset(virtualEventPos);
			
			expect(docOffset).toMatchInlineSnapshot(`
				DocumentOffset {
				  "offset": 22,
				  "uri": "file://a.kql",
				}
			`);
		});

		it('maps source offset to virtual', () => {
			const doc = AkustoDocument.parse('file://a.kql', 
`let $events = Events

$events | take 10`);
			const project = AkustoProject.fromDocuments([doc]);
			const resolved = project.resolve(doc, doc.fragments[1]);
			
			// Offset 22 is start of second fragment in source
			const virtualOffset = resolved.sourceMap.fromDocumentOffset(
				new DocumentOffset('file://a.kql', 22)
			);
			
			expect(virtualOffset).toMatchInlineSnapshot(`22`);
		});
	});
});

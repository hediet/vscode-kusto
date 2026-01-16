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

    describe('getDefinitionInfo', () => {
        it('returns definition info for simple definition', () => {
            const doc = AkustoDocument.parse('file://a.kql', 'let $events = Events | take 10');
            const project = AkustoProject.fromDocuments([doc]);

            const info = project.getDefinitionInfo('$events');
            expect(info).toBeDefined();
            expect(info?.name).toBe('$events');
            expect(info?.uri).toBe('file://a.kql');
            expect(info?.body).toBe('Events | take 10');
        });

        it('returns definition info for dotted name', () => {
            const doc = AkustoDocument.parse('file://a.kql', 'let $events.editTelemetry.codeSuggested = RawEventsVSCode\n| where EventName == "test"');
            const project = AkustoProject.fromDocuments([doc]);

            const info = project.getDefinitionInfo('$events.editTelemetry.codeSuggested');
            expect(info).toBeDefined();
            expect(info?.name).toBe('$events.editTelemetry.codeSuggested');
        });

        it('returns definition info with documentation from comment', () => {
            const doc = AkustoDocument.parse('file://a.kql', `// Owner: testuser
let $events.test = Events`);
            const project = AkustoProject.fromDocuments([doc]);

            const info = project.getDefinitionInfo('$events.test');
            expect(info).toBeDefined();
            expect(info?.documentation).toBe('Owner: testuser');
        });

        it('returns all definition infos from project', () => {
            const doc = AkustoDocument.parse('file://a.kql', `let $events = Events

let $logs = Logs`);
            const project = AkustoProject.fromDocuments([doc]);

            const infos = project.getDefinitionInfos();
            expect(Array.from(infos.keys()).sort()).toEqual(['$events', '$logs']);
        });

        it('returns undefined for unknown definition name', () => {
            const doc = AkustoDocument.parse('file://a.kql', 'let $events = Events');
            const project = AkustoProject.fromDocuments([doc]);

            expect(project.getDefinitionInfo('$unknown')).toBeUndefined();
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
              "let events = Events;
              events | take 10"
            `);
        });

        it('resolves fragment with cross-file dependency', () => {
            const doc1 = AkustoDocument.parse('file://defs.kql', 'let $events = Events');
            const doc2 = AkustoDocument.parse('file://main.kql', '$events | take 10');
            const project = AkustoProject.fromDocuments([doc1, doc2]);
            const resolved = project.resolve(doc2, doc2.fragments[0]);

            expect(resolved.virtualText).toMatchInlineSnapshot(`
              "let events = Events;
              events | take 10"
            `);
        });

        it('resolves fragment with dot-containing name', () => {
            const doc = AkustoDocument.parse('file://a.kql',
                `let $events.query = Events

$events.query | take 10`);
            const project = AkustoProject.fromDocuments([doc]);
            const resolved = project.resolve(doc, doc.fragments[1]);

            // Dots are converted to underscores in the Kusto name
            expect(resolved.virtualText).toMatchInlineSnapshot(`
              "let events_query = Events;
              events_query | take 10"
            `);
        });

        it('resolves fragment with multiple dot-containing names', () => {
            const doc = AkustoDocument.parse('file://a.kql',
                `let $events.debug.memory = Events

let $events.debug.cpu = Perf

$events.debug.memory | union $events.debug.cpu`);
            const project = AkustoProject.fromDocuments([doc]);
            const resolved = project.resolve(doc, doc.fragments[2]);

            expect(resolved.virtualText).toMatchInlineSnapshot(`
              "let events_debug_memory = Events;
              let events_debug_cpu = Perf;
              events_debug_memory | union events_debug_cpu"
            `);
        });

        it('resolves definition with leading comment', () => {
            const doc = AkustoDocument.parse('file://a.kql',
                `// Owner: sandy081
let $events.install = RawEvents
| where EventName == "install"

$events.install | take 10`);
            const project = AkustoProject.fromDocuments([doc]);
            const resolved = project.resolve(doc, doc.fragments[1]);

            // The comment should NOT be included in the body, only the actual expression
            expect(resolved.virtualText).toMatchInlineSnapshot(`
              "let events_install = RawEvents
              | where EventName == "install";
              events_install | take 10"
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
              "let a = Events;
              let b = a | where x > 0;
              b | take 10"
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

            expect(docOffset).toMatchInlineSnapshot(`undefined`);
        });

        it('maps source offset to virtual', () => {
            const doc = AkustoDocument.parse('file://a.kql',
                `let $events = Events

$events | take 10`);
            const project = AkustoProject.fromDocuments([doc]);
            const resolved = project.resolve(doc, doc.fragments[1]);

            // Offset 22 is start of second fragment ($events), which gets renamed.
            // Since $events -> events changes length, the renamed part has no source mapping.
            // Instead, test the non-renamed part: " | take 10" starts at source offset 29
            const virtualOffset = resolved.sourceMap.fromDocumentOffset(
                new DocumentOffset('file://a.kql', 29)  // position of " | take 10"
            );

            // In virtual text: "let events = Events;\nevents | take 10"
            // "events" is 6 chars, then " | take 10" starts at position 27
            expect(virtualOffset).toMatchInlineSnapshot(`27`);
        });
    });

    describe('chapter-scoped definitions', () => {
        it('global definitions only include top-level', () => {
            const doc = AkustoDocument.parse('file://a.kql',
                `let $global = Events

# Chapter

let $private = Logs`);
            const project = AkustoProject.fromDocuments([doc]);

            expect(Array.from(project.getDefinitions().keys())).toMatchInlineSnapshot(`
				[
				  "$global",
				]
			`);
        });

        it('resolves chapter-local definition for fragment in chapter', () => {
            const doc = AkustoDocument.parse('file://a.kql',
                `let $global = Events

# Chapter

let $local = Logs

$local | take 10`);
            const project = AkustoProject.fromDocuments([doc]);
            const chapter = doc.ast.getChapters()[0];
            const chapterFrags = doc.chapterFragments.get(chapter)!;
            const queryFragment = chapterFrags[1]; // $local | take 10

            const resolved = project.resolve(doc, queryFragment);
            expect(resolved.virtualText).toMatchInlineSnapshot(`
              "let local = Logs;
              local | take 10"
            `);
        });

        it('resolves both global and chapter-local definitions', () => {
            const doc = AkustoDocument.parse('file://a.kql',
                `let $global = Events

# Chapter

let $local = Logs

$global | join $local`);
            const project = AkustoProject.fromDocuments([doc]);
            const chapter = doc.ast.getChapters()[0];
            const chapterFrags = doc.chapterFragments.get(chapter)!;
            const queryFragment = chapterFrags[1]; // $global | join $local

            const resolved = project.resolve(doc, queryFragment);
            expect(resolved.virtualText).toMatchInlineSnapshot(`
              "let global = Events;
              let local = Logs;
              global | join local"
            `);
        });

        it('chapter definition shadows global with same name', () => {
            const doc = AkustoDocument.parse('file://a.kql',
                `let $x = Events

# Chapter

let $x = Logs

$x | take 10`);
            const project = AkustoProject.fromDocuments([doc]);
            const chapter = doc.ast.getChapters()[0];
            const chapterFrags = doc.chapterFragments.get(chapter)!;
            const queryFragment = chapterFrags[1]; // $x | take 10

            const resolved = project.resolve(doc, queryFragment);
            // Should use the chapter-local $x = Logs, not the global $x = Events
            expect(resolved.virtualText).toMatchInlineSnapshot(`
              "let x = Logs;
              x | take 10"
            `);
        });

        it('top-level fragment does not see chapter definitions', () => {
            const doc = AkustoDocument.parse('file://a.kql',
                `# Chapter

let $private = Logs

$private | take 10`);
            const project = AkustoProject.fromDocuments([doc]);

            // Create a doc with top-level reference to $private
            const doc2 = AkustoDocument.parse('file://b.kql', '$private | take 5');
            const project2 = project.withDocument(doc2);

            const resolved = project2.resolve(doc2, doc2.fragments[0]);
            // $private is not visible from top-level, so no dependency included
            expect(resolved.virtualText).toMatchInlineSnapshot(`"$private | take 5"`);
        });
    });

    describe('multi-file project with instructions', () => {
        it('resolves query using definition from library file with connection', () => {
            // Library file: shared definitions
            const libDoc = AkustoDocument.parse('file://lib/defs.kql',
                `let $stormEvents = StormEvents
| where StartTime > ago(7d)

let $signInLogs = SignInLogs
| where TimeGenerated > ago(1d)`);

            // Main file: uses definitions from lib and sets connection
            const mainDoc = AkustoDocument.parse('file://main.kql',
                `:setConnection({ type: "azureIdentity", cluster: "help.kusto.windows.net" })
:setDefaultDb("Samples")

# Storm Analysis

$stormEvents
| summarize Count=count() by State
| top 10 by Count`);

            const project = AkustoProject.fromDocuments([libDoc, mainDoc]);
            const chapter = mainDoc.ast.getChapters()[0];
            const queryFragment = mainDoc.chapterFragments.get(chapter)![0];

            const resolved = project.resolve(mainDoc, queryFragment);

            // Virtual text includes the dependency definition
            expect(resolved.virtualText).toMatchInlineSnapshot(`
              "let stormEvents = StormEvents
              | where StartTime > ago(7d);
              stormEvents
              | summarize Count=count() by State
              | top 10 by Count"
            `);

            // Instructions are resolved with typed values
            expect(resolved.instructions).toMatchInlineSnapshot(`
				[
				  {
				    "type": "setConnection",
				    "value": {
				      "cluster": "help.kusto.windows.net",
				      "type": "azureIdentity",
				    },
				  },
				  {
				    "type": "setDefaultDb",
				    "value": "Samples",
				  },
				]
			`);
        });

        it('combines global and chapter instructions', () => {
            const doc = AkustoDocument.parse('file://main.kql',
                `:setConnection({ type: "azureIdentity", cluster: "global.kusto.windows.net" })

# Query 1
:setDefaultDb("Database1")
Events | take 10

# Query 2
:setDefaultDb("Database2")
Logs | take 5`);

            const project = AkustoProject.fromDocuments([doc]);

            // Resolve query 1
            const chapter1 = doc.ast.getChapters()[0];
            const query1 = doc.chapterFragments.get(chapter1)![0];
            const resolved1 = project.resolve(doc, query1);

            expect(resolved1.instructions).toMatchInlineSnapshot(`
				[
				  {
				    "type": "setConnection",
				    "value": {
				      "cluster": "global.kusto.windows.net",
				      "type": "azureIdentity",
				    },
				  },
				  {
				    "type": "setDefaultDb",
				    "value": "Database1",
				  },
				]
			`);

            // Resolve query 2 - different chapter instructions
            const chapter2 = doc.ast.getChapters()[1];
            const query2 = doc.chapterFragments.get(chapter2)![0];
            const resolved2 = project.resolve(doc, query2);

            expect(resolved2.instructions).toMatchInlineSnapshot(`
				[
				  {
				    "type": "setConnection",
				    "value": {
				      "cluster": "global.kusto.windows.net",
				      "type": "azureIdentity",
				    },
				  },
				  {
				    "type": "setDefaultDb",
				    "value": "Database2",
				  },
				]
			`);
        });

        it('transitive dependencies across files with instructions', () => {
            // Base definitions
            const baseDoc = AkustoDocument.parse('file://base.kql',
                `let $events = Events | where TimeGenerated > ago(7d)`);

            // Derived definitions
            const derivedDoc = AkustoDocument.parse('file://derived.kql',
                `let $alertEvents = $events | where Level == "Alert"

let $criticalEvents = $alertEvents | where Severity > 3`);

            // Main query
            const mainDoc = AkustoDocument.parse('file://main.kql',
                `:setConnection({ type: "connectionString", connectionString: "Data Source=https://cluster.kusto.windows.net" })

$criticalEvents | take 100`);

            const project = AkustoProject.fromDocuments([baseDoc, derivedDoc, mainDoc]);
            const query = mainDoc.fragments[0];
            const resolved = project.resolve(mainDoc, query);

            // All transitive dependencies in topological order
            expect(resolved.virtualText).toMatchInlineSnapshot(`
              "let events = Events | where TimeGenerated > ago(7d);
              let alertEvents = events | where Level == "Alert";
              let criticalEvents = alertEvents | where Severity > 3;
              criticalEvents | take 100"
            `);

            expect(resolved.instructions).toMatchInlineSnapshot(`
				[
				  {
				    "type": "setConnection",
				    "value": {
				      "connectionString": "Data Source=https://cluster.kusto.windows.net",
				      "type": "connectionString",
				    },
				  },
				]
			`);
        });

        it('sourceMap maps across multiple dependency files', () => {
            const libDoc = AkustoDocument.parse('file://lib.kql', 'let $x = Events');
            const mainDoc = AkustoDocument.parse('file://main.kql', '$x | take 10');

            const project = AkustoProject.fromDocuments([libDoc, mainDoc]);
            const resolved = project.resolve(mainDoc, mainDoc.fragments[0]);

            // The main query "$x | take 10" becomes "x | take 10" in virtual.
            // The "$x" -> "x" rename means that part has no source mapping.
            // But " | take 10" (source offset 2) should map correctly.
            const pipeStart = resolved.virtualText.indexOf(' | take');
            const docOffset = resolved.sourceMap.toDocumentOffset(pipeStart);

            expect(docOffset).toBeDefined();
            expect(docOffset!.uri).toBe('file://main.kql');
            expect(docOffset!.offset).toBe(2);  // After "$x" in source

            // Dependencies are not source-mapped since their body is extracted and transformed.
            // This is intentional - errors in dependencies should be fixed in the dependency file.
        });
    });
});

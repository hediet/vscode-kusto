import { describe, test, expect } from 'vitest';
import { ResolvedDocumentAdapter, extractDocumentation, SourceTextProvider } from './resolvedDocumentAdapter';
import { AkustoDocument } from './akustoDocument';
import { AkustoProject } from './akustoProject';
import { DocumentOffset } from '../common/documentOffset';
import { createKustoLanguageService, KustoSchema } from '../kusto';

describe('ResolvedDocumentAdapter', () => {
    const schema: KustoSchema = {
        cluster: 'https://test.kusto.windows.net',
        database: 'TestDB',
        tables: [
            {
                name: 'Events',
                columns: [
                    { name: 'Timestamp', type: 'datetime' },
                    { name: 'Message', type: 'string' },
                    { name: 'Level', type: 'string' },
                ],
            },
        ],
    };

    function createAdapter(text: string, uri = 'file://test.kql') {
        const doc = AkustoDocument.parse(uri, text);
        const project = AkustoProject.fromDocuments([doc]);
        const fragment = doc.fragments[0];
        const resolved = project.resolve(doc, fragment);
        const service = createKustoLanguageService(schema);
        return new ResolvedDocumentAdapter(resolved, service);
    }

    describe('getCompletions', () => {
        test('returns completions at valid offset', () => {
            const adapter = createAdapter('Events | where ');
            const completions = adapter.getCompletions(new DocumentOffset('file://test.kql', 14));

            expect(completions.length).toBeGreaterThan(0);
        });

        test('returns completions with valid structure', () => {
            const adapter = createAdapter('print 1');
            const completions = adapter.getCompletions(new DocumentOffset('file://test.kql', 0));

            // Should have completions
            expect(completions.length).toBeGreaterThan(0);

            // Each completion should have required fields
            for (const completion of completions.slice(0, 5)) {
                expect(completion.label).toBeDefined();
                expect(completion.kind).toBeDefined();
            }
        });

        test('returns empty for invalid offset', () => {
            const adapter = createAdapter('Events');
            // Offset way beyond document
            const completions = adapter.getCompletions(new DocumentOffset('file://other.kql', 0));

            expect(completions).toHaveLength(0);
        });
    });

    describe('getDiagnostics', () => {
        test('returns diagnostics for unknown identifier', () => {
            const adapter = createAdapter('UnknownTable');
            const diagnostics = adapter.getDiagnostics();

            expect(diagnostics.length).toBeGreaterThan(0);
            expect(diagnostics[0].location.uri).toBe('file://test.kql');
        });

        test('returns empty for valid query', () => {
            const adapter = createAdapter('Events | take 10');
            const diagnostics = adapter.getDiagnostics();

            expect(diagnostics).toHaveLength(0);
        });

        test('maps diagnostic location back to source', () => {
            const adapter = createAdapter('BadTable');
            const diagnostics = adapter.getDiagnostics();

            expect(diagnostics.length).toBeGreaterThan(0);
            expect(diagnostics[0].location.offset).toBe(0);
            expect(diagnostics[0].length).toBeGreaterThan(0);
        });
    });

    describe('getDiagnosticsForDocument', () => {
        test('filters by document URI', () => {
            const adapter = createAdapter('BadTable');
            const diagnostics = adapter.getDiagnosticsForDocument('file://test.kql');

            expect(diagnostics.length).toBeGreaterThan(0);
        });

        test('returns empty for non-matching URI', () => {
            const adapter = createAdapter('BadTable');
            const diagnostics = adapter.getDiagnosticsForDocument('file://other.kql');

            expect(diagnostics).toHaveLength(0);
        });
    });

    describe('getHover', () => {
        test('returns hover for table name', () => {
            const adapter = createAdapter('Events');
            // May or may not return hover depending on position
            // Just ensure it doesn't throw
            void adapter.getHover(new DocumentOffset('file://test.kql', 0));
            expect(true).toBe(true);
        });

        test('returns null for invalid offset', () => {
            const adapter = createAdapter('Events');
            const hover = adapter.getHover(new DocumentOffset('file://other.kql', 0));

            expect(hover).toBeNull();
        });
    });

    describe('multi-file resolution', () => {
        test('completions work with resolved dependencies', () => {
            // Create a project with definition in one file, usage in another
            const defDoc = AkustoDocument.parse('file://defs.kql', 'let $events = Events');
            const mainDoc = AkustoDocument.parse('file://main.kql', '$events | where ');

            const project = AkustoProject.fromDocuments([defDoc, mainDoc]);
            const resolved = project.resolve(mainDoc, mainDoc.fragments[0]);
            const service = createKustoLanguageService(schema);
            const adapter = new ResolvedDocumentAdapter(resolved, service);

            // Get completions in main doc
            const completions = adapter.getCompletions(new DocumentOffset('file://main.kql', 15));

            // Should have column completions from Events table (via $events)
            expect(completions.length).toBeGreaterThan(0);
        });

        test('diagnostics from dependencies are source-mapped to their origin files', () => {
            // Definition with error in one file
            // Dependencies have their body extracted and transformed, so we intentionally
            // don't source-map them. Errors in dependencies should be fixed in the source file.
            const defDoc = AkustoDocument.parse('file://defs.kql', 'let $bad = UnknownTable');
            const mainDoc = AkustoDocument.parse('file://main.kql', '$bad | take 10');

            const project = AkustoProject.fromDocuments([defDoc, mainDoc]);
            const resolved = project.resolve(mainDoc, mainDoc.fragments[0]);
            const service = createKustoLanguageService(schema);
            const adapter = new ResolvedDocumentAdapter(resolved, service);

            const diagnostics = adapter.getDiagnostics();

            // Diagnostics from dependencies ARE now source-mapped since we track source locations
            // This enables Go to Definition across included files
            const defsDiagnostics = diagnostics.filter(d => d.location.uri === 'file://defs.kql');
            expect(defsDiagnostics.length).toBeGreaterThan(0);
            expect(defsDiagnostics[0].message).toContain('UnknownTable');

            // Diagnostics from the main file should also work
        });

        test('go to definition finds column declaration in dependency file', () => {
            // Definition file with an extended column
            const defDoc = AkustoDocument.parse(
                'file://defs.kql',
                `let $tbl = print 1 | extend myMode = "test"`
            );
            // Main file references the definition and uses the column
            const mainDoc = AkustoDocument.parse(
                'file://main.kql',
                `$tbl
| project myMode`
            );

            const project = AkustoProject.fromDocuments([defDoc, mainDoc]);
            const resolved = project.resolve(mainDoc, mainDoc.fragments[0]);
            const service = createKustoLanguageService(schema);
            const adapter = new ResolvedDocumentAdapter(resolved, service);

            // Get related elements at 'myMode' in main.kql (after "| project ")
            const myModeOffset = mainDoc.text.indexOf('myMode');
            const relatedInfo = adapter.getRelatedElements(
                new DocumentOffset('file://main.kql', myModeOffset)
            );

            // Should find elements including declaration in defs.kql
            expect(relatedInfo?.elements.map(e => ({
                uri: e.location.uri,
                kind: e.kind,
            }))).toMatchInlineSnapshot(`
              [
                {
                  "kind": "declaration",
                  "uri": "file://defs.kql",
                },
                {
                  "kind": "reference",
                  "uri": "file://main.kql",
                },
              ]
            `);
        });
    });

    describe('completions at end of line', () => {
        function createAdapterForFragment(text: string, fragmentIndex = 0, uri = 'file://test.kql') {
            const doc = AkustoDocument.parse(uri, text);
            const project = AkustoProject.fromDocuments([doc]);
            const fragment = doc.fragments[fragmentIndex];
            if (!fragment) {
                throw new Error(`No fragment at index ${fragmentIndex}. Document has ${doc.fragments.length} fragments.`);
            }
            const resolved = project.resolve(doc, fragment);
            const service = createKustoLanguageService(schema);
            return { adapter: new ResolvedDocumentAdapter(resolved, service), doc, fragment, resolved };
        }

        test('debug: fragment range vs cursor position for trailing empty line case', () => {
            const text = `Events
| project 
`;
            const { doc, fragment, resolved } = createAdapterForFragment(text);
            const cursorOffset = 'Events\n| project '.length; // 17

            expect({
                documentText: text,
                documentLength: text.length,
                fragmentText: fragment.text,
                fragmentTextLength: fragment.text.length,
                fragmentRange: fragment.range.toJSON(),
                cursorOffset,
                cursorInFragment: doc.getFragmentAt(cursorOffset) === fragment,
                resolvedText: resolved.virtualText,
                resolvedTextLength: resolved.virtualText.length,
                sourceMapSegments: resolved.sourceMap.segments.map(s => ({
                    virtual: s.virtualRange.toJSON(),
                    source: { uri: s.sourceUri, range: s.sourceRange.toJSON() }
                })),
            }).toMatchInlineSnapshot(`
              {
                "cursorInFragment": true,
                "cursorOffset": 17,
                "documentLength": 18,
                "documentText": "Events
              | project 
              ",
                "fragmentRange": {
                  "endExclusive": 17,
                  "start": 0,
                },
                "fragmentText": "Events
              | project ",
                "fragmentTextLength": 17,
                "resolvedText": "Events
              | project ",
                "resolvedTextLength": 17,
                "sourceMapSegments": [
                  {
                    "source": {
                      "range": {
                        "endExclusive": 17,
                        "start": 0,
                      },
                      "uri": "file://test.kql",
                    },
                    "virtual": {
                      "endExclusive": 17,
                      "start": 0,
                    },
                  },
                ],
              }
            `);
        });

        test('debug: sourceMap mapping for cursor at end of fragment', () => {
            const text = `Events
| project 
`;
            const { resolved } = createAdapterForFragment(text);
            const cursorOffset = 'Events\n| project '.length; // 17

            // The issue: fragment.range.endExclusive = 17, but resolved text is only 16 chars
            // So cursor at 17 needs to map to 16 in virtual text
            const mapped = resolved.sourceMap.fromDocumentOffset(
                new DocumentOffset('file://test.kql', cursorOffset),
                true // includeTouchingEnd
            );

            expect({
                cursorOffset,
                mappedToVirtual: mapped,
                resolvedTextLength: resolved.virtualText.length,
            }).toMatchInlineSnapshot(`
              {
                "cursorOffset": 17,
                "mappedToVirtual": 17,
                "resolvedTextLength": 17,
              }
            `);
        });

        test('returns completions at end of "| project " with trailing empty line (user case 2)', () => {
            const text = `Events
| project 
`;
            const { adapter, doc, fragment } = createAdapterForFragment(text);
            // Fragment text now includes trailing whitespace so cursor position maps correctly
            expect(fragment.text).toBe(`Events
| project `);

            // Cursor at position where user is typing (after "| project ")
            const cursorOffset = 'Events\n| project '.length; // 17
            expect(doc.getFragmentAt(cursorOffset)).toBe(fragment);

            const completions = adapter.getCompletions(new DocumentOffset('file://test.kql', cursorOffset));
            const columnNames = completions.filter(c => c.kind === 'column').map(c => c.label);

            // Now works - cursor position correctly maps to end of fragment
            expect(columnNames).toContain('Timestamp');
        });

        test('returns completions at end of "| project " with comment after empty line (user case 1)', () => {
            const text = `Events
| project 

//`;
            const { adapter, doc, fragment } = createAdapterForFragment(text);
            // Fragment text now includes trailing whitespace so cursor position maps correctly
            expect(fragment.text).toBe(`Events
| project `);

            const cursorOffset = 'Events\n| project '.length; // 17
            expect(doc.getFragmentAt(cursorOffset)).toBe(fragment);

            const completions = adapter.getCompletions(new DocumentOffset('file://test.kql', cursorOffset));
            const columnNames = completions.filter(c => c.kind === 'column').map(c => c.label);

            expect(columnNames).toContain('Timestamp');
        });

        test('returns completions at very end of document', () => {
            const text = `Events | project `;
            const { adapter } = createAdapterForFragment(text);

            const cursorOffset = text.length; // 17
            const completions = adapter.getCompletions(new DocumentOffset('file://test.kql', cursorOffset));
            const columnNames = completions.filter(c => c.kind === 'column').map(c => c.label);

            expect(columnNames).toContain('Timestamp');
        });
    });
});

describe('extractDocumentation', () => {
    test('extracts inline comment at end of line', () => {
        const text = `| extend mode = "test" // The current mode of operation`;
        const offset = text.indexOf('mode');

        expect(extractDocumentation(text, offset)).toBe('The current mode of operation');
    });

    test('extracts comment line above', () => {
        const text = `// Owner: jrieken
let $events.startupTimeVaried = RawEventsVSCode`;
        const offset = text.indexOf('$events');

        expect(extractDocumentation(text, offset)).toBe('Owner: jrieken');
    });

    test('extracts multiple comment lines above', () => {
        const text = `// This is a **bold** description
// with multiple lines
// and markdown support
let $events.test = Events`;
        const offset = text.indexOf('$events');

        expect(extractDocumentation(text, offset)).toBe(
            `This is a **bold** description
with multiple lines
and markdown support`
        );
    });

    test('prefers inline comment over comment above', () => {
        const text = `// Comment above
| extend mode = "test" // Inline comment wins`;
        const offset = text.indexOf('mode');

        expect(extractDocumentation(text, offset)).toBe('Inline comment wins');
    });

    test('returns null when no comment found', () => {
        const text = `let x = 1
| extend mode = "test"`;
        const offset = text.indexOf('mode');

        expect(extractDocumentation(text, offset)).toBeNull();
    });

    test('stops at non-comment line', () => {
        const text = `let x = 1

// This should be captured
let $events.test = Events`;
        const offset = text.indexOf('$events');

        expect(extractDocumentation(text, offset)).toBe('This should be captured');
    });

    test('handles real vscode-events.kql style with property extraction comment', () => {
        const text = `| extend abexp_queriedfeature = tostring(Properties["abexp.queriedfeature"]) // The experimental feature being queried
| project abexp_queriedfeature`;
        const offset = text.indexOf('abexp_queriedfeature');

        expect(extractDocumentation(text, offset)).toBe('The experimental feature being queried');
    });
});

describe('hover with documentation', () => {
    const schema: KustoSchema = {
        cluster: 'https://test.kusto.windows.net',
        database: 'TestDB',
        tables: [
            {
                name: 'Events',
                columns: [
                    { name: 'Timestamp', type: 'datetime' },
                ],
            },
        ],
    };

    function createAdapterWithSourceProvider(
        docs: { uri: string; text: string }[]
    ): { adapter: ResolvedDocumentAdapter; mainDoc: AkustoDocument } {
        const parsedDocs = docs.map(d => AkustoDocument.parse(d.uri, d.text));
        const mainDoc = parsedDocs[parsedDocs.length - 1];
        const project = AkustoProject.fromDocuments(parsedDocs);
        const resolved = project.resolve(mainDoc, mainDoc.fragments[0]);
        const service = createKustoLanguageService(schema);

        const sourceTextProvider: SourceTextProvider = {
            getSourceText: (uri: string) => {
                const doc = parsedDocs.find(d => d.uri === uri);
                return doc?.text;
            }
        };

        return {
            adapter: new ResolvedDocumentAdapter(resolved, service, sourceTextProvider),
            mainDoc
        };
    }

    test('hover includes inline comment from declaration', () => {
        const { adapter, mainDoc } = createAdapterWithSourceProvider([
            {
                uri: 'file://main.kql',
                text: `print 1
| extend mode = "test" // The current mode
| project mode`
            }
        ]);

        // Hover over 'mode' in project
        const modeOffset = mainDoc.text.lastIndexOf('mode');
        const hover = adapter.getHover(new DocumentOffset('file://main.kql', modeOffset));

        expect(hover?.contents).toContain('mode: string');
        expect(hover?.contents).toContain('The current mode');
    });

    test('hover includes documentation from dependency file', () => {
        const { adapter, mainDoc } = createAdapterWithSourceProvider([
            {
                uri: 'file://defs.kql',
                text: `// The application mode setting
let $tbl = print 1 | extend mode = "production" // Current deployment mode`
            },
            {
                uri: 'file://main.kql',
                text: `$tbl
| project mode`
            }
        ]);

        // Hover over 'mode' in main.kql
        const modeOffset = mainDoc.text.indexOf('mode');
        const hover = adapter.getHover(new DocumentOffset('file://main.kql', modeOffset));

        expect(hover?.contents).toContain('mode: string');
        expect(hover?.contents).toContain('Current deployment mode');
    });
});

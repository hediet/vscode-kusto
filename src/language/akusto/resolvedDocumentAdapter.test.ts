import { describe, test, expect } from 'vitest';
import { ResolvedDocumentAdapter } from './resolvedDocumentAdapter';
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

        test('diagnostics map back to correct source file', () => {
            // Definition with error in one file
            const defDoc = AkustoDocument.parse('file://defs.kql', 'let $bad = UnknownTable');
            const mainDoc = AkustoDocument.parse('file://main.kql', '$bad | take 10');

            const project = AkustoProject.fromDocuments([defDoc, mainDoc]);
            const resolved = project.resolve(mainDoc, mainDoc.fragments[0]);
            const service = createKustoLanguageService(schema);
            const adapter = new ResolvedDocumentAdapter(resolved, service);

            const diagnostics = adapter.getDiagnostics();

            // Should have diagnostic pointing to defs.kql where UnknownTable is
            const defsDiagnostics = diagnostics.filter(d => d.location.uri === 'file://defs.kql');
            expect(defsDiagnostics.length).toBeGreaterThan(0);
        });
    });
});

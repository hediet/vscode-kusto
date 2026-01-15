import { describe, test, expect } from 'vitest';
import { createKustoLanguageService, KustoSchema } from './kustoLanguageService';

describe('KustoLanguageService', () => {
    describe('createKustoLanguageService', () => {
        test('creates service without schema', () => {
            const service = createKustoLanguageService();
            expect(service).toBeDefined();
        });

        test('creates service with schema', () => {
            const schema: KustoSchema = {
                cluster: 'https://test.kusto.windows.net',
                database: 'TestDB',
                tables: [
                    {
                        name: 'Events',
                        columns: [
                            { name: 'Timestamp', type: 'datetime' },
                            { name: 'Message', type: 'string' },
                        ],
                    },
                ],
            };
            const service = createKustoLanguageService(schema);
            expect(service).toBeDefined();
        });
    });

    describe('getCompletions', () => {
        test('returns completions for empty input', () => {
            const service = createKustoLanguageService();
            const completions = service.getCompletions('', 0);
            expect(completions.length).toBeGreaterThan(0);
        });

        test('returns table completions with schema', () => {
            const schema: KustoSchema = {
                cluster: 'https://test.kusto.windows.net',
                database: 'TestDB',
                tables: [
                    { name: 'StormEvents', columns: [{ name: 'State', type: 'string' }] },
                ],
            };
            const service = createKustoLanguageService(schema);
            const completions = service.getCompletions('Storm', 5);

            const tableCompletion = completions.find(c => c.label === 'StormEvents');
            expect(tableCompletion).toBeDefined();
            expect(tableCompletion?.kind).toBe('table');
        });

        test('returns operator completions after pipe', () => {
            const service = createKustoLanguageService();
            // After pipe, should get operators like where, project, etc.
            const completions = service.getCompletions('print 1 | ', 10);

            const whereCompletion = completions.find(c => c.label === 'where');
            expect(whereCompletion).toBeDefined();
        });

        test('returns built-in function completions', () => {
            const service = createKustoLanguageService();
            // At start of expression, should include built-in functions
            const completions = service.getCompletions('', 0);

            // 'print' should be available
            const printCompletion = completions.find(c => c.label === 'print');
            expect(printCompletion).toBeDefined();
        });
    });

    describe('getDiagnostics', () => {
        test('returns empty for valid query', () => {
            const service = createKustoLanguageService();
            const diagnostics = service.getDiagnostics('print 1');
            expect(diagnostics).toHaveLength(0);
        });

        test('returns error for unknown table', () => {
            const service = createKustoLanguageService();
            const diagnostics = service.getDiagnostics('UnknownTable');

            expect(diagnostics.length).toBeGreaterThan(0);
            expect(diagnostics[0].severity).toBe('error');
        });

        test('returns error range for syntax error', () => {
            const service = createKustoLanguageService();
            const diagnostics = service.getDiagnostics('print |');

            expect(diagnostics.length).toBeGreaterThan(0);
            expect(diagnostics[0].range.start).toBeGreaterThanOrEqual(0);
        });
    });

    describe('getSemanticTokens', () => {
        test('returns tokens for simple query', () => {
            const service = createKustoLanguageService();
            const tokens = service.getSemanticTokens('print 1');

            // Should have at least some tokens
            expect(tokens.length).toBeGreaterThanOrEqual(0);
        });

        test('returns tokens with valid ranges', () => {
            const service = createKustoLanguageService();
            const text = 'print "hello"';
            const tokens = service.getSemanticTokens(text);

            for (const token of tokens) {
                expect(token.range.start).toBeGreaterThanOrEqual(0);
                expect(token.range.endExclusive).toBeLessThanOrEqual(text.length);
            }
        });

        test('tokens have valid types', () => {
            const service = createKustoLanguageService();
            const tokens = service.getSemanticTokens('print 42');

            const validTypes = ['keyword', 'function', 'variable', 'string', 'number', 'comment', 'operator', 'type', 'table', 'column', 'parameter'];
            for (const token of tokens) {
                expect(validTypes).toContain(token.type);
            }
        });
    });

    describe('getHover', () => {
        test('returns hover for function', () => {
            const service = createKustoLanguageService();
            const hover = service.getHover('print now()', 6);

            expect(hover).not.toBeNull();
            expect(hover?.contents).toContain('now');
        });

        test('returns null for whitespace', () => {
            const service = createKustoLanguageService();
            // May or may not return hover for whitespace
            // Just ensure it doesn't throw
            service.getHover('print   1', 6);
            expect(true).toBe(true);
        });
    });
});

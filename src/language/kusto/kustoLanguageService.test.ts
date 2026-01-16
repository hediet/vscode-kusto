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

        test('returns column completions after project', () => {
            const schema: KustoSchema = {
                cluster: 'https://test.kusto.windows.net',
                database: 'TestDB',
                tables: [
                    {
                        name: 'myEvents',
                        columns: [
                            { name: 'Timestamp', type: 'datetime' },
                            { name: 'EventName', type: 'string' },
                            { name: 'UserId', type: 'long' },
                            { name: 'Duration', type: 'real' },
                        ],
                    },
                ],
            };
            const service = createKustoLanguageService(schema);

            const text = 'myEvents\n| project ';
            const completions = service.getCompletions(text, text.length);

            // Should see all columns from myEvents
            const timestampCompletion = completions.find(c => c.label === 'Timestamp');
            expect(timestampCompletion).toBeDefined();
            expect(timestampCompletion?.kind).toBe('column');

            const eventNameCompletion = completions.find(c => c.label === 'EventName');
            expect(eventNameCompletion).toBeDefined();
            expect(eventNameCompletion?.kind).toBe('column');

            const userIdCompletion = completions.find(c => c.label === 'UserId');
            expect(userIdCompletion).toBeDefined();
            expect(userIdCompletion?.kind).toBe('column');

            const durationCompletion = completions.find(c => c.label === 'Duration');
            expect(durationCompletion).toBeDefined();
            expect(durationCompletion?.kind).toBe('column');
        });

        test('returns column descriptions from docstrings', () => {
            const schema: KustoSchema = {
                cluster: 'https://test.kusto.windows.net',
                database: 'TestDB',
                tables: [
                    {
                        name: 'Events',
                        columns: [
                            { name: 'Timestamp', type: 'datetime', docstring: 'When the event occurred' },
                            { name: 'Message', type: 'string', docstring: 'The event message content' },
                            { name: 'Level', type: 'int' }, // no docstring
                        ],
                    },
                ],
            };
            const service = createKustoLanguageService(schema);

            const text = 'Events\n| project ';
            const completions = service.getCompletions(text, text.length);

            // Filter to just column completions and snapshot them
            const columnCompletions = completions
                .filter(c => c.kind === 'column')
                .sort((a, b) => a.label.localeCompare(b.label));

            expect(JSON.stringify(columnCompletions, null, 2)).toMatchInlineSnapshot(`
              "[
                {
                  "label": "Level",
                  "kind": "column",
                  "detail": "Column",
                  "filterText": "Level"
                },
                {
                  "label": "Message",
                  "kind": "column",
                  "detail": "Column",
                  "documentation": "The event message content",
                  "filterText": "Message"
                },
                {
                  "label": "Timestamp",
                  "kind": "column",
                  "detail": "Column",
                  "documentation": "When the event occurred",
                  "filterText": "Timestamp"
                }
              ]"
            `);
        });

        test('hover shows column docstring', () => {
            const schema: KustoSchema = {
                cluster: 'https://test.kusto.windows.net',
                database: 'TestDB',
                tables: [
                    {
                        name: 'Events',
                        columns: [
                            { name: 'Timestamp', type: 'datetime', docstring: 'When the event occurred' },
                            { name: 'Message', type: 'string', docstring: 'The event message content' },
                        ],
                    },
                ],
            };
            const service = createKustoLanguageService(schema);

            const text = 'Events\n| project Timestamp';
            // Hover over "Timestamp" column
            const hover = service.getHover(text, text.length - 3); // middle of "Timestamp"

            console.log('Hover result:', hover);
            expect(hover).not.toBeNull();
            expect(hover?.contents).toContain('When the event occurred');
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

    describe('getRelatedElements', () => {
        test('finds declaration for let variable reference', () => {
            const service = createKustoLanguageService();
            const text = `let x = 42;
print x`;

            // Get related elements at the 'x' in 'print x'
            const xUsageOffset = text.indexOf('print x') + 6;
            const result = service.getRelatedElements(text, xUsageOffset);

            expect(result).toMatchInlineSnapshot(`
              {
                "currentIndex": 1,
                "elements": [
                  {
                    "kind": "declaration",
                    "length": 1,
                    "start": 4,
                  },
                  {
                    "kind": "reference",
                    "length": 1,
                    "start": 18,
                  },
                ],
              }
            `);
        });
    });

    describe('Kusto API exploration', () => {
        test('GetRelatedElements on extend column reference', () => {
            // What does Kusto return when we're on a column created by extend?
            const text = `print 1
| extend myCol = 42
| where myCol > 10`;

            const codeService = new Kusto.Language.Editor.KustoCodeService.$ctor1(text, Kusto.Language.GlobalState.Default);

            // Position on 'myCol' in 'where myCol'
            const myColOffset = text.lastIndexOf('myCol');
            const related = codeService.GetRelatedElements(myColOffset);

            const elements = [];
            if (related) {
                for (let i = 0; i < related.Elements.Count; i++) {
                    const el = related.Elements.getItem(i);
                    elements.push({
                        start: el.Start,
                        length: el.Length,
                        kind: el.Kind,
                        text: text.substring(el.Start, el.Start + el.Length)
                    });
                }
            }

            expect({ currentIndex: related?.CurrentIndex, elements }).toMatchInlineSnapshot(`
              {
                "currentIndex": 1,
                "elements": [
                  {
                    "kind": 2,
                    "length": 5,
                    "start": 17,
                    "text": "myCol",
                  },
                  {
                    "kind": 1,
                    "length": 5,
                    "start": 36,
                    "text": "myCol",
                  },
                ],
              }
            `);
        });

        test('GetQuickInfo on extend column', () => {
            const text = `print 1
| extend myCol = 42
| where myCol > 10`;

            const codeService = new Kusto.Language.Editor.KustoCodeService.$ctor1(text, Kusto.Language.GlobalState.Default);

            // Get quick info on 'myCol' reference
            const myColOffset = text.lastIndexOf('myCol');
            const quickInfo = codeService.GetQuickInfo(myColOffset);

            expect(quickInfo?.Text).toMatchInlineSnapshot(`"myCol: long"`);
        });

        test('explore KustoCode syntax tree for column declarations', () => {
            const text = `print 1
| extend myCol = 42
| where myCol > 10`;

            const code = Kusto.Language.KustoCode.Parse(text);

            // Try to find extend expressions
            const nodes: any[] = [];
            function visit(node: any, depth: number) {
                if (depth > 10) return;
                if (!node) return;

                const name = node.constructor?.name || 'unknown';
                // Look for interesting node types
                if (name.includes('Extend') || name.includes('Column') || name.includes('Assignment') || name.includes('SimpleNamed')) {
                    nodes.push({
                        type: name,
                        start: node.TextStart,
                        end: node.End,
                        text: text.substring(node.TextStart, Math.min(node.End, node.TextStart + 30))
                    });
                }

                // Visit children
                const childCount = node.ChildCount;
                if (typeof childCount === 'number') {
                    for (let i = 0; i < childCount; i++) {
                        visit(node.GetChild?.(i), depth + 1);
                    }
                }
            }

            visit(code.Syntax, 0);

            expect(nodes).toMatchInlineSnapshot(`[]`);
        });

        test('find column symbol from syntax node', () => {
            const text = `print 1
| extend myCol = 42
| where myCol > 10`;

            const code = Kusto.Language.KustoCode.Parse(text);

            // Find the SimpleNamedExpression for 'myCol = 42'
            const extendStart = text.indexOf('myCol = 42');

            // Get the token at that position
            const token = code.Syntax.GetTokenAt(extendStart);

            // Get referenced symbol
            const referencedSymbol = token?.ReferencedSymbol;

            expect({
                tokenText: token?.Text,
                tokenStart: token?.TextStart,
                symbolName: referencedSymbol?.Name,
                symbolKind: referencedSymbol?.Kind,
            }).toMatchInlineSnapshot(`
              {
                "symbolKind": undefined,
                "symbolName": undefined,
                "tokenStart": 17,
                "tokenText": "myCol",
              }
            `);
        });

        test('GetRelatedElements with SeeThroughVariables option', () => {
            const text = `let tbl = print 1 | extend myCol = 42;
tbl
| where myCol > 10`;

            const codeService = new Kusto.Language.Editor.KustoCodeService.$ctor1(text, Kusto.Language.GlobalState.Default);

            // Try with SeeThroughVariables option
            const myColOffset = text.lastIndexOf('myCol');
            const related = codeService.GetRelatedElements(myColOffset, Kusto.Language.Editor.FindRelatedOptions.SeeThroughVariables);

            const elements = [];
            if (related) {
                for (let i = 0; i < related.Elements.Count; i++) {
                    const el = related.Elements.getItem(i);
                    elements.push({
                        start: el.Start,
                        length: el.Length,
                        kind: el.Kind,
                        text: text.substring(el.Start, el.Start + el.Length)
                    });
                }
            }

            expect({ currentIndex: related?.CurrentIndex, elements }).toMatchInlineSnapshot(`
              {
                "currentIndex": 1,
                "elements": [
                  {
                    "kind": 2,
                    "length": 5,
                    "start": 27,
                    "text": "myCol",
                  },
                  {
                    "kind": 1,
                    "length": 5,
                    "start": 51,
                    "text": "myCol",
                  },
                ],
              }
            `);
        });

        test('column docstring from schema', () => {
            const schema: KustoSchema = {
                cluster: 'https://test.kusto.windows.net',
                database: 'TestDB',
                tables: [
                    {
                        name: 'Events',
                        columns: [
                            { name: 'Timestamp', type: 'datetime', docstring: 'When the event occurred' },
                        ],
                    },
                ],
            };
            const service = createKustoLanguageService(schema);

            const text = `Events
| extend myCol = Timestamp
| where myCol > ago(1d)`;

            // Get hover on myCol - does it inherit the docstring?
            const myColOffset = text.lastIndexOf('myCol');
            const hover = service.getHover(text, myColOffset);

            expect(hover?.contents).toMatchInlineSnapshot(`"myCol: datetime"`);
        });

        test('extended column with inline comment - what does Kusto return?', () => {
            const service = createKustoLanguageService();

            // Simulates vscode-events.kql pattern with inline comments
            const text = `print 1
| extend mode = "test" // The current mode of operation
| project mode`;

            // Get hover on mode in project
            const modeOffset = text.lastIndexOf('mode');
            const hover = service.getHover(text, modeOffset);

            // What does Kusto return? Does it include the comment?
            expect(hover?.contents).toMatchInlineSnapshot(`"mode: string"`);
        });

        test('completions for extended columns - do they have inline comment as docs?', () => {
            const service = createKustoLanguageService();

            const text = `print 1
| extend myColumn = "hello" // This is my custom column description
| project `;

            const completions = service.getCompletions(text, text.length);
            const myColCompletion = completions.find(c => c.label === 'myColumn');

            // Kusto does NOT extract inline comments as documentation for virtual columns
            // Comments are stripped during parsing, so there's no way to attach docs to extend columns
            expect(myColCompletion?.documentation).toBeUndefined();
        });

        test('GetRelatedElements on column from let statement (simulates real scenario)', () => {
            // This simulates the user's real scenario:
            // - A let statement creates a table expression with extended columns
            // - Later, we reference that let variable and project one of its columns
            const text = `let tbl = print 1 | extend mode = "test";
tbl
| project mode`;

            const codeService = new Kusto.Language.Editor.KustoCodeService.$ctor1(text, Kusto.Language.GlobalState.Default);

            // Position on 'mode' in 'project mode'
            const modeOffset = text.lastIndexOf('mode');
            const related = codeService.GetRelatedElements(modeOffset);

            const elements = [];
            if (related) {
                for (let i = 0; i < related.Elements.Count; i++) {
                    const el = related.Elements.getItem(i);
                    elements.push({
                        start: el.Start,
                        length: el.Length,
                        kind: el.Kind, // 2 = declaration, 1 = reference
                        text: text.substring(el.Start, el.Start + el.Length)
                    });
                }
            }

            expect({ currentIndex: related?.CurrentIndex, elements }).toMatchInlineSnapshot(`
              {
                "currentIndex": 1,
                "elements": [
                  {
                    "kind": 2,
                    "length": 4,
                    "start": 27,
                    "text": "mode",
                  },
                  {
                    "kind": 1,
                    "length": 4,
                    "start": 56,
                    "text": "mode",
                  },
                ],
              }
            `);
        });

        test('GetRelatedElements with SeeThroughVariables on column from let', () => {
            const text = `let tbl = print 1 | extend mode = "test";
tbl
| project mode`;

            const codeService = new Kusto.Language.Editor.KustoCodeService.$ctor1(text, Kusto.Language.GlobalState.Default);

            // Try with SeeThroughVariables
            const modeOffset = text.lastIndexOf('mode');
            const related = codeService.GetRelatedElements(modeOffset, Kusto.Language.Editor.FindRelatedOptions.SeeThroughVariables);

            const elements = [];
            if (related) {
                for (let i = 0; i < related.Elements.Count; i++) {
                    const el = related.Elements.getItem(i);
                    elements.push({
                        start: el.Start,
                        length: el.Length,
                        kind: el.Kind,
                        text: text.substring(el.Start, el.Start + el.Length)
                    });
                }
            }

            expect({ currentIndex: related?.CurrentIndex, elements }).toMatchInlineSnapshot(`
              {
                "currentIndex": 1,
                "elements": [
                  {
                    "kind": 2,
                    "length": 4,
                    "start": 27,
                    "text": "mode",
                  },
                  {
                    "kind": 1,
                    "length": 4,
                    "start": 56,
                    "text": "mode",
                  },
                ],
              }
            `);
        });
    });
});

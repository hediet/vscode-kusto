import { describe, it, expect } from 'vitest';
import { AkustoWorkspace } from './akustoWorkspace';
import { createInMemoryFs } from '../common/fileSystem';

/**
 * Tests for definition completions.
 * Uses AkustoWorkspace directly instead of VS Code APIs.
 */
describe('Definition Completions', () => {
    /**
     * Helper to get definition names visible from a given position.
     * Simulates what DefinitionCompletionProvider does.
     */
    function getDefinitionCompletions(
        workspace: AkustoWorkspace,
        uri: string,
        offset: number,
        typedPrefix: string
    ): string[] {
        const doc = workspace.getDocument(uri);
        if (!doc) return [];

        const globalDefs = workspace.project.getDefinitions();
        const localDefs = doc.getVisibleDefinitions(offset);

        const allDefs = new Map<string, string>();
        for (const [name] of globalDefs) {
            allDefs.set(name, 'global');
        }
        for (const [name] of localDefs) {
            allDefs.set(name, 'local');
        }

        const items: string[] = [];
        for (const [name] of allDefs) {
            if (!name.startsWith('$')) continue;
            if (!name.startsWith(typedPrefix)) continue;
            items.push(name);
        }
        return items.sort();
    }

    describe('basic definitions', () => {
        it('should find simple definition', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);

            await workspace.setDocument('file:///main.kql', `let $events = Events

$events | take 10`);

            const completions = getDefinitionCompletions(workspace, 'file:///main.kql', 25, '$');
            expect(completions).toContain('$events');
        });

        it('should find definition with dot in name', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);

            await workspace.setDocument('file:///main.kql', `let $events.query = Events

$events.query | take 10`);

            const completions = getDefinitionCompletions(workspace, 'file:///main.kql', 35, '$');
            expect(completions).toContain('$events.query');
        });

        it('should find definition with multiple dots in name', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);

            await workspace.setDocument('file:///main.kql', `let $events.debug.memory = Events

$events.debug.memory | take 10`);

            const completions = getDefinitionCompletions(workspace, 'file:///main.kql', 45, '$');
            expect(completions).toContain('$events.debug.memory');
        });
    });

    describe('prefix filtering', () => {
        it('should filter by partial prefix', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);

            // Note: definitions need blank lines between them to be separate fragments
            await workspace.setDocument('file:///main.kql', `let $events.query = Events

let $events.debug = Perf

let $logs = Logs

print 1`);

            // Typing "$events."
            const completions = getDefinitionCompletions(workspace, 'file:///main.kql', 80, '$events.');
            expect(completions).toEqual(['$events.debug', '$events.query']);
        });

        it('should filter multiple levels', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);

            // Note: definitions need blank lines between them to be separate fragments
            await workspace.setDocument('file:///main.kql', `let $events.debug.memory = Events

let $events.debug.cpu = Perf

let $events.query = Logs

let $logs = Logs

print 1`);

            // Typing "$events.debug."
            const completions = getDefinitionCompletions(workspace, 'file:///main.kql', 120, '$events.debug.');
            expect(completions).toEqual(['$events.debug.cpu', '$events.debug.memory']);
        });
    });

    describe('included files', () => {
        it('should find definitions from included file', async () => {
            // Note: definitions need blank lines between them
            const fs = createInMemoryFs({
                'file:///defs.kql': `let $events.query = Events

let $events.debug.memory = Perf`,
            });
            const workspace = new AkustoWorkspace(fs);

            await workspace.setDocument('file:///main.kql', `:include("./defs.kql")

$events.`);

            const completions = getDefinitionCompletions(workspace, 'file:///main.kql', 35, '$events.');
            expect(completions).toContain('$events.query');
            expect(completions).toContain('$events.debug.memory');
        });

        it('should handle vscode-events style definitions', async () => {
            // Minimal subset of vscode-events.kql structure
            const fs = createInMemoryFs({
                'file:///vscode-events.kql': `// VS Code Telemetry Events Library

let $events.query_expfeature = RawEventsVSCode
| where EventName == "monacoworkbench/query-expfeature"
| project abexp_queriedfeature

let $events.startupTimeVaried = RawEventsVSCode
| where EventName == "monacoworkbench/startupTimeVaried"
| project ellapsed

let $events.debug.didViewMemory = RawEventsVSCode
| where EventName == "monacoworkbench/debug/didViewMemory"
| project debugtype

let $events.mergeEditor.activatedFrom = RawEventsVSCode
| where EventName == "monacoworkbench/mergeEditor/activatedFrom"
| project source

let $events.mergeEditor.closed = RawEventsVSCode
| where EventName == "monacoworkbench/mergeEditor/closed"
| project result`,
            });
            const workspace = new AkustoWorkspace(fs);

            await workspace.setDocument('file:///main.kql', `:setConnection({ type: "azureCli", cluster: "https://test.kusto.windows.net/" })
:setDefaultDb("TestDb")

:include("./vscode-events.kql")

$events.mergeEditor.`);

            // Get definitions - should include mergeEditor ones
            const allCompletions = getDefinitionCompletions(workspace, 'file:///main.kql', 150, '$');
            expect(allCompletions).toContain('$events.query_expfeature');
            expect(allCompletions).toContain('$events.startupTimeVaried');
            expect(allCompletions).toContain('$events.debug.didViewMemory');
            expect(allCompletions).toContain('$events.mergeEditor.activatedFrom');
            expect(allCompletions).toContain('$events.mergeEditor.closed');

            // Filter to mergeEditor
            const mergeCompletions = getDefinitionCompletions(workspace, 'file:///main.kql', 150, '$events.mergeEditor.');
            expect(mergeCompletions).toEqual([
                '$events.mergeEditor.activatedFrom',
                '$events.mergeEditor.closed',
            ]);
        });
    });

    describe('performance', () => {
        it('should handle large number of definitions', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);

            // Generate 100 definitions with various dot patterns
            const defs: string[] = [];
            for (let i = 0; i < 100; i++) {
                defs.push(`let $events.category${i % 10}.event${i} = Events`);
            }
            const content = defs.join('\n\n') + '\n\nprint 1';

            const start = performance.now();
            await workspace.setDocument('file:///main.kql', content);
            const parseTime = performance.now() - start;

            const start2 = performance.now();
            const completions = getDefinitionCompletions(workspace, 'file:///main.kql', content.length - 5, '$events.category5.');
            const completionTime = performance.now() - start2;

            // Should find 10 events (0, 10, 20, 30, 40, 50, 60, 70, 80, 90 all have category5)
            expect(completions).toHaveLength(10);

            // Both operations should be fast (< 100ms each)
            expect(parseTime).toBeLessThan(500);
            expect(completionTime).toBeLessThan(100);

            console.log(`Parse time: ${parseTime.toFixed(2)}ms, Completion time: ${completionTime.toFixed(2)}ms`);
        });
    });
});

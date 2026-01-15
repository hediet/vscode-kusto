import { describe, it, expect, vi } from 'vitest';
import { AkustoWorkspace } from './akustoWorkspace';
import { createInMemoryFs } from '../common/fileSystem';

describe('AkustoWorkspace', () => {
    describe('setDocument', () => {
        it('should parse and store document', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);

            await workspace.setDocument('file:///main.kql', 'print "hello"');

            expect(workspace.getDocument('file:///main.kql')).toBeDefined();
            expect(workspace.project.documents.size).toBe(1);
        });

        it('should update existing document', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);

            await workspace.setDocument('file:///main.kql', 'print 1');
            await workspace.setDocument('file:///main.kql', 'print 2');

            const doc = workspace.getDocument('file:///main.kql');
            expect(doc?.text).toBe('print 2');
        });

        it('should resolve includes from file system', async () => {
            const fs = createInMemoryFs({
                'file:///main.kql': ':include("./defs.kql")\nprint $x',
                'file:///defs.kql': 'let $x = 42;',
            });
            const workspace = new AkustoWorkspace(fs);

            await workspace.setDocument('file:///main.kql', ':include("./defs.kql")\nprint $x');

            expect(workspace.project.documents.size).toBe(2);
            expect(workspace.project.documents.has('file:///defs.kql')).toBe(true);
        });

        it('should prefer local document over file system', async () => {
            const fs = createInMemoryFs({
                'file:///main.kql': ':include("./defs.kql")\nprint $x',
                'file:///defs.kql': 'let $x = 42;',
            });
            const workspace = new AkustoWorkspace(fs);

            // Set local version first
            await workspace.setDocument('file:///defs.kql', 'let $x = 99;');
            await workspace.setDocument('file:///main.kql', ':include("./defs.kql")\nprint $x');

            const defsDoc = workspace.project.documents.get('file:///defs.kql');
            expect(defsDoc?.text).toBe('let $x = 99;');
        });

        it('should notify listeners on change', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);
            const listener = vi.fn();

            workspace.onDocumentChange(listener);
            await workspace.setDocument('file:///main.kql', 'print 1');

            expect(listener).toHaveBeenCalledWith({
                uri: 'file:///main.kql',
                content: 'print 1',
            });
        });
    });

    describe('closeDocument', () => {
        it('should remove document', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);

            await workspace.setDocument('file:///main.kql', 'print 1');
            workspace.closeDocument('file:///main.kql');

            expect(workspace.getDocument('file:///main.kql')).toBeUndefined();
            expect(workspace.project.documents.size).toBe(0);
        });
    });

    describe('getOpenDocuments', () => {
        it('should return all open URIs', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);

            await workspace.setDocument('file:///a.kql', 'print 1');
            await workspace.setDocument('file:///b.kql', 'print 2');

            const uris = workspace.getOpenDocuments();
            expect(uris).toHaveLength(2);
            expect(uris).toContain('file:///a.kql');
            expect(uris).toContain('file:///b.kql');
        });
    });

    describe('findFragmentAtOffset', () => {
        it('should find fragment containing offset', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);

            await workspace.setDocument('file:///main.kql', 'let $x = 1;\n\nprint $x');

            const fragment = workspace.findFragmentAtOffset('file:///main.kql', 15);
            expect(fragment?.text).toBe('print $x');
        });

        it('should return undefined for invalid offset', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);

            await workspace.setDocument('file:///main.kql', 'print 1');

            const fragment = workspace.findFragmentAtOffset('file:///main.kql', 1000);
            expect(fragment).toBeUndefined();
        });
    });

    describe('getAdapterAtOffset', () => {
        it('should return adapter for fragment at offset', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);

            await workspace.setDocument('file:///main.kql', 'print "hello"');

            const adapter = workspace.getAdapterAtOffset('file:///main.kql', 5);
            expect(adapter).not.toBeNull();
        });

        it('should resolve dependencies in adapter', async () => {
            const fs = createInMemoryFs({
                'file:///defs.kql': 'let $x = 42;',
            });
            const workspace = new AkustoWorkspace(fs);

            await workspace.setDocument('file:///main.kql', ':include("./defs.kql")\n\nprint $x');

            const adapter = workspace.getAdapterAtOffset('file:///main.kql', 25);
            expect(adapter).not.toBeNull();
            // The resolved text should include the dependency ($ stripped for Kusto compatibility)
            expect(adapter?.text).toContain('let x = 42');
            expect(adapter?.text).toContain('print x');
        });

        it('should return null for invalid document', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);

            const adapter = workspace.getAdapterAtOffset('file:///missing.kql', 0);
            expect(adapter).toBeNull();
        });
    });

    describe('onDocumentChange', () => {
        it('should return unsubscribe function', async () => {
            const fs = createInMemoryFs({});
            const workspace = new AkustoWorkspace(fs);
            const listener = vi.fn();

            const unsubscribe = workspace.onDocumentChange(listener);
            await workspace.setDocument('file:///a.kql', 'print 1');
            expect(listener).toHaveBeenCalledTimes(1);

            unsubscribe();
            await workspace.setDocument('file:///b.kql', 'print 2');
            expect(listener).toHaveBeenCalledTimes(1); // Still 1, not called again
        });
    });
});

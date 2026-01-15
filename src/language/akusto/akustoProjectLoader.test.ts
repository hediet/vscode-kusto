import { describe, it, expect } from 'vitest';
import { AkustoProjectLoader } from './akustoProjectLoader';
import { createInMemoryFs } from '../common/fileSystem';

describe('AkustoProjectLoader', () => {
    describe('loadSingle', () => {
        it('should load a single document', async () => {
            const fs = createInMemoryFs({
                'file:///main.kql': 'print "hello"',
            });
            const loader = new AkustoProjectLoader(fs);

            const doc = await loader.loadSingle('file:///main.kql');

            expect(doc.uri).toBe('file:///main.kql');
            expect(doc.topLevelFragments).toHaveLength(1);
        });

        it('should throw on missing file', async () => {
            const fs = createInMemoryFs({});
            const loader = new AkustoProjectLoader(fs);

            await expect(loader.loadSingle('file:///missing.kql')).rejects.toThrow('File not found');
        });
    });

    describe('loadDocument', () => {
        it('should load document without includes', async () => {
            const fs = createInMemoryFs({
                'file:///main.kql': `
let $x = 1;

print $x
`,
            });
            const loader = new AkustoProjectLoader(fs);

            const project = await loader.loadDocument('file:///main.kql');

            expect(project.documents.size).toBe(1);
            expect(project.documents.has('file:///main.kql')).toBe(true);
        });

        it('should load document with single include', async () => {
            const fs = createInMemoryFs({
                'file:///main.kql': `
:include("./defs.kql")

print $x
`,
                'file:///defs.kql': 'let $x = 42;',
            });
            const loader = new AkustoProjectLoader(fs);

            const project = await loader.loadDocument('file:///main.kql');

            expect(project.documents.size).toBe(2);
            expect(project.documents.has('file:///main.kql')).toBe(true);
            expect(project.documents.has('file:///defs.kql')).toBe(true);
        });

        it('should load transitive includes', async () => {
            const fs = createInMemoryFs({
                'file:///main.kql': ':include("./a.kql")\nprint $x',
                'file:///a.kql': ':include("./b.kql")\nlet $y = $z + 1;',
                'file:///b.kql': 'let $z = 10;',
            });
            const loader = new AkustoProjectLoader(fs);

            const project = await loader.loadDocument('file:///main.kql');

            expect(project.documents.size).toBe(3);
            expect(project.documents.has('file:///main.kql')).toBe(true);
            expect(project.documents.has('file:///a.kql')).toBe(true);
            expect(project.documents.has('file:///b.kql')).toBe(true);
        });

        it('should not duplicate shared includes', async () => {
            const fs = createInMemoryFs({
                'file:///main.kql': `
:include("./a.kql")
:include("./b.kql")
print $shared
`,
                'file:///a.kql': ':include("./shared.kql")\nlet $x = $shared;',
                'file:///b.kql': ':include("./shared.kql")\nlet $y = $shared;',
                'file:///shared.kql': 'let $shared = 99;',
            });
            const loader = new AkustoProjectLoader(fs);

            const project = await loader.loadDocument('file:///main.kql');

            expect(project.documents.size).toBe(4);
        });

        it('should detect circular includes', async () => {
            const fs = createInMemoryFs({
                'file:///a.kql': ':include("./b.kql")\nlet $x = 1;',
                'file:///b.kql': ':include("./a.kql")\nlet $y = 2;',
            });
            const loader = new AkustoProjectLoader(fs);

            await expect(loader.loadDocument('file:///a.kql')).rejects.toThrow('Circular include');
        });

        it('should resolve relative paths correctly', async () => {
            const fs = createInMemoryFs({
                'file:///project/src/main.kql': ':include("../lib/utils.kql")\nprint $util',
                'file:///project/lib/utils.kql': 'let $util = "helper";',
            });
            const loader = new AkustoProjectLoader(fs);

            const project = await loader.loadDocument('file:///project/src/main.kql');

            expect(project.documents.size).toBe(2);
            expect(project.documents.has('file:///project/lib/utils.kql')).toBe(true);
        });
    });

    describe('loadDocuments', () => {
        it('should load multiple entry points', async () => {
            const fs = createInMemoryFs({
                'file:///a.kql': 'let $a = 1;',
                'file:///b.kql': 'let $b = 2;',
            });
            const loader = new AkustoProjectLoader(fs);

            const project = await loader.loadDocuments([
                'file:///a.kql',
                'file:///b.kql',
            ]);

            expect(project.documents.size).toBe(2);
        });

        it('should merge includes from multiple entry points', async () => {
            const fs = createInMemoryFs({
                'file:///a.kql': ':include("./shared.kql")\nlet $a = $s;',
                'file:///b.kql': ':include("./shared.kql")\nlet $b = $s;',
                'file:///shared.kql': 'let $s = "shared";',
            });
            const loader = new AkustoProjectLoader(fs);

            const project = await loader.loadDocuments([
                'file:///a.kql',
                'file:///b.kql',
            ]);

            // a, b, and shared (not duplicated)
            expect(project.documents.size).toBe(3);
        });
    });

    describe('chapter includes', () => {
        it('should handle includes inside chapters', async () => {
            const fs = createInMemoryFs({
                'file:///main.kql': `
# Analysis
:include("./analysis-helpers.kql")
print $helper
`,
                'file:///analysis-helpers.kql': 'let $helper = "help";',
            });
            const loader = new AkustoProjectLoader(fs);

            const project = await loader.loadDocument('file:///main.kql');

            expect(project.documents.size).toBe(2);
        });
    });
});

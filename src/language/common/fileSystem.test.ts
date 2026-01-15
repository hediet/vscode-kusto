import { describe, it, expect } from 'vitest';
import { InMemoryFileSystem, createInMemoryFs } from './fileSystem';

describe('InMemoryFileSystem', () => {
    it('should read file content', async () => {
        const fs = new InMemoryFileSystem();
        fs.set('file:///test.kql', 'print "hello"');

        const content = await fs.readFile('file:///test.kql');
        expect(content.text).toBe('print "hello"');
        expect(content.version).toBe(1);
    });

    it('should throw on missing file', async () => {
        const fs = new InMemoryFileSystem();

        await expect(fs.readFile('file:///missing.kql')).rejects.toThrow('File not found');
    });

    it('should check existence', async () => {
        const fs = new InMemoryFileSystem();
        fs.set('file:///exists.kql', 'content');

        expect(await fs.exists('file:///exists.kql')).toBe(true);
        expect(await fs.exists('file:///missing.kql')).toBe(false);
    });

    it('should delete files', async () => {
        const fs = new InMemoryFileSystem();
        fs.set('file:///test.kql', 'content');

        expect(await fs.exists('file:///test.kql')).toBe(true);
        fs.delete('file:///test.kql');
        expect(await fs.exists('file:///test.kql')).toBe(false);
    });

    it('should clear all files', async () => {
        const fs = new InMemoryFileSystem();
        fs.set('file:///a.kql', 'a');
        fs.set('file:///b.kql', 'b');

        fs.clear();
        expect(await fs.exists('file:///a.kql')).toBe(false);
        expect(await fs.exists('file:///b.kql')).toBe(false);
    });

    it('should normalize backslashes', async () => {
        const fs = new InMemoryFileSystem();
        fs.set('file:///path/to/file.kql', 'content');

        // Should find with backslashes
        const { text } = await fs.readFile('file:///path\\to\\file.kql');
        expect(text).toBe('content');
    });

    describe('resolvePath', () => {
        const fs = new InMemoryFileSystem();

        it('should resolve sibling file', () => {
            const result = fs.resolvePath('file:///project/main.kql', './defs.kql');
            expect(result).toBe('file:///project/defs.kql');
        });

        it('should resolve file without ./', () => {
            const result = fs.resolvePath('file:///project/main.kql', 'defs.kql');
            expect(result).toBe('file:///project/defs.kql');
        });

        it('should resolve parent directory', () => {
            const result = fs.resolvePath('file:///project/src/main.kql', '../common/defs.kql');
            expect(result).toBe('file:///project/common/defs.kql');
        });

        it('should resolve nested path', () => {
            const result = fs.resolvePath('file:///project/main.kql', './lib/utils.kql');
            expect(result).toBe('file:///project/lib/utils.kql');
        });

        it('should handle multiple parent refs', () => {
            const result = fs.resolvePath('file:///a/b/c/d.kql', '../../x.kql');
            expect(result).toBe('file:///a/x.kql');
        });
    });
});

describe('createInMemoryFs', () => {
    it('should create fs with files', async () => {
        const fs = createInMemoryFs({
            'file:///a.kql': 'content a',
            'file:///b.kql': 'content b',
        });

        expect((await fs.readFile('file:///a.kql')).text).toBe('content a');
        expect((await fs.readFile('file:///b.kql')).text).toBe('content b');
    });
});

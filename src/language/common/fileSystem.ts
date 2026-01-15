/**
 * File system abstraction for reading and watching documents.
 * 
 * This abstraction allows:
 * - In-memory file system for tests
 * - VS Code workspace file system for extension
 * - Node.js file system for LSP server (future)
 */

/** A text edit (replace range [start, end) with text). */
export interface StringEdit {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

/** File content with version for cache invalidation. */
export interface FileContent {
    readonly text: string;
    readonly version: number;
}

/** File change event. */
export interface FileChangeEvent {
    readonly uri: string;
    readonly version: number;
    /** If provided, incremental edits. If undefined, must re-read file. */
    readonly edits?: readonly StringEdit[];
}

/** Disposable interface. */
export interface IDisposable {
    dispose(): void;
}

/** Basic file system operations. */
export interface FileSystem {
    /** Read file contents. Throws if file doesn't exist. */
    readFile(uri: string): Promise<FileContent>;

    /** Check if a file exists. */
    exists(uri: string): Promise<boolean>;

    /** Resolve a relative path against a base URI. */
    resolvePath(baseUri: string, relativePath: string): string;
}

/** File system with watching capabilities. */
export interface WatchableFileSystem extends FileSystem {
    /**
     * Watch a file for changes.
     * The callback is called when the file content changes.
     * Returns disposable to stop watching.
     */
    watchFile(uri: string, onDidChange: (event: FileChangeEvent) => void): IDisposable;
}

/**
 * In-memory file system for testing.
 * Stores files in a Map with URI keys.
 * Supports watching for change notifications.
 */
export class InMemoryFileSystem implements WatchableFileSystem {
    private readonly files = new Map<string, { content: string; version: number }>();
    private readonly watchers = new Map<string, Set<(event: FileChangeEvent) => void>>();

    /** Set file content. Notifies watchers. */
    set(uri: string, content: string): this {
        const normalized = this.normalizeUri(uri);
        const existing = this.files.get(normalized);
        const version = (existing?.version ?? 0) + 1;
        this.files.set(normalized, { content, version });

        // Notify watchers (no incremental edits for set)
        this._notifyWatchers(normalized, { uri: normalized, version });
        return this;
    }

    /** Apply edits to a file. Notifies watchers with edit info. */
    applyEdits(uri: string, edits: readonly StringEdit[]): this {
        const normalized = this.normalizeUri(uri);
        const existing = this.files.get(normalized);
        if (!existing) {
            throw new Error(`File not found: ${uri}`);
        }

        // Apply edits from end to start
        let newContent = existing.content;
        const sortedEdits = [...edits].sort((a, b) => b.start - a.start);
        for (const edit of sortedEdits) {
            newContent = newContent.substring(0, edit.start) + edit.text + newContent.substring(edit.end);
        }

        const version = existing.version + 1;
        this.files.set(normalized, { content: newContent, version });

        // Notify watchers with edit info
        this._notifyWatchers(normalized, { uri: normalized, version, edits });
        return this;
    }

    /** Delete a file. Notifies watchers. */
    delete(uri: string): boolean {
        const normalized = this.normalizeUri(uri);
        const existed = this.files.delete(normalized);
        if (existed) {
            // Notify watchers that file is gone (they should handle this)
            this._notifyWatchers(normalized, { uri: normalized, version: -1 });
        }
        return existed;
    }

    /** Clear all files. */
    clear(): void {
        this.files.clear();
    }

    /** Get all file URIs. */
    keys(): IterableIterator<string> {
        return this.files.keys();
    }

    async readFile(uri: string): Promise<FileContent> {
        const normalized = this.normalizeUri(uri);
        const file = this.files.get(normalized);
        if (!file) {
            throw new Error(`File not found: ${uri}`);
        }
        return { text: file.content, version: file.version };
    }

    async exists(uri: string): Promise<boolean> {
        return this.files.has(this.normalizeUri(uri));
    }

    resolvePath(baseUri: string, relativePath: string): string {
        // Simple path resolution for file:// URIs
        const base = this.normalizeUri(baseUri);

        // Get directory of base
        const lastSlash = base.lastIndexOf('/');
        const baseDir = lastSlash >= 0 ? base.substring(0, lastSlash) : base;

        // Handle relative path
        if (relativePath.startsWith('./')) {
            relativePath = relativePath.substring(2);
        }

        // Split and resolve .. segments
        const baseParts = baseDir.split('/');
        const relParts = relativePath.split('/');

        for (const part of relParts) {
            if (part === '..') {
                baseParts.pop();
            } else if (part !== '.' && part !== '') {
                baseParts.push(part);
            }
        }

        return baseParts.join('/');
    }

    watchFile(uri: string, onDidChange: (event: FileChangeEvent) => void): IDisposable {
        const normalized = this.normalizeUri(uri);
        let watcherSet = this.watchers.get(normalized);
        if (!watcherSet) {
            watcherSet = new Set();
            this.watchers.set(normalized, watcherSet);
        }
        watcherSet.add(onDidChange);

        return {
            dispose: () => {
                watcherSet!.delete(onDidChange);
                if (watcherSet!.size === 0) {
                    this.watchers.delete(normalized);
                }
            }
        };
    }

    private _notifyWatchers(uri: string, event: FileChangeEvent): void {
        const watcherSet = this.watchers.get(uri);
        if (watcherSet) {
            for (const callback of watcherSet) {
                callback(event);
            }
        }
    }

    /** Normalize URI for consistent storage/lookup. */
    private normalizeUri(uri: string): string {
        // Ensure consistent forward slashes
        return uri.replace(/\\/g, '/');
    }
}

/**
 * Create a simple in-memory file system with files.
 * Convenience function for tests.
 */
export function createInMemoryFs(files: Record<string, string>): InMemoryFileSystem {
    const fs = new InMemoryFileSystem();
    for (const [uri, content] of Object.entries(files)) {
        fs.set(uri, content);
    }
    return fs;
}

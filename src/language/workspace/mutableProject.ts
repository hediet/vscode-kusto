import {
    IObservable,
    ISettableObservable,
    observableValue,
    derived
} from '@vscode/observables';
import {
    WatchableFileSystem,
    FileChangeEvent,
    IDisposable
} from '../common/fileSystem';
import { AkustoDocument } from '../akusto/akustoDocument';
import { AkustoProject } from '../akusto/akustoProject';
import { parseInstructionExpression } from '../akusto/instructionResolver';

/**
 * A mutable project that watches for file changes and maintains an observable AkustoProject.
 * 
 * Key behaviors:
 * - Tracks "root" documents (entry points) and their transitive includes
 * - Automatically watches all relevant files
 * - Updates the observable project when any watched file changes
 * - Supports incremental updates via StringEdit
 */
export class MutableProject implements IDisposable {
    /** Observable project state. */
    public readonly project: IObservable<AkustoProject>;

    /** Observable map of URI -> AkustoDocument for all tracked documents. */
    public readonly documents: IObservable<ReadonlyMap<string, AkustoDocument>>;

    private readonly _documents: ISettableObservable<ReadonlyMap<string, AkustoDocument>>;
    private readonly _rootUris = new Set<string>();
    private readonly _watchers = new Map<string, IDisposable>();
    private _disposed = false;

    constructor(private readonly fs: WatchableFileSystem) {
        this._documents = observableValue('MutableProject.documents', new Map<string, AkustoDocument>());
        this.documents = this._documents;

        // Derive project from documents
        this.project = derived(this, reader => {
            const docs = this._documents.read(reader);
            return AkustoProject.fromDocuments(docs.values());
        });
    }

    /**
     * Add a root document. 
     * The document and all its transitive includes will be watched.
     */
    async addRoot(uri: string): Promise<void> {
        console.log(`[MutableProject] addRoot called for: ${uri}`);
        const normalizedUri = this._normalizeUri(uri);
        if (this._rootUris.has(normalizedUri)) {
            console.log(`[MutableProject] Already has root: ${normalizedUri}`);
            return;
        }
        this._rootUris.add(normalizedUri);
        console.log(`[MutableProject] Loading and watching: ${normalizedUri}`);
        await this._loadAndWatch(normalizedUri);
        console.log(`[MutableProject] Done loading: ${normalizedUri}, docs: ${Array.from(this._documents.get().keys()).join(', ')}`);
    }

    /**
     * Remove a root document.
     * Files only referenced by this root will be unwatched.
     */
    removeRoot(uri: string): void {
        const normalizedUri = this._normalizeUri(uri);
        this._rootUris.delete(normalizedUri);
        this._updateWatchers();
    }

    /**
     * Get all root document URIs.
     */
    getRoots(): string[] {
        return Array.from(this._rootUris);
    }

    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;

        // Dispose all watchers
        for (const watcher of this._watchers.values()) {
            watcher.dispose();
        }
        this._watchers.clear();
    }

    /**
     * Load a document and set up watching.
     */
    private async _loadAndWatch(uri: string): Promise<void> {
        // Read file
        const { text } = await this.fs.readFile(uri);
        const doc = AkustoDocument.parse(uri, text);

        // Update documents map
        this._updateDocument(uri, doc);

        // Watch for changes
        this._ensureWatching(uri);

        // Load includes
        const includes = this._getIncludes(doc);
        for (const includePath of includes) {
            const resolvedUri = this.fs.resolvePath(uri, includePath);
            if (!this._documents.get().has(resolvedUri)) {
                await this._loadAndWatch(resolvedUri);
            }
        }
    }

    /**
     * Ensure we're watching a URI.
     */
    private _ensureWatching(uri: string): void {
        if (this._watchers.has(uri)) {
            return;
        }

        const watcher = this.fs.watchFile(uri, event => this._handleFileChange(event));
        this._watchers.set(uri, watcher);
    }

    /**
     * Handle a file change event.
     */
    private async _handleFileChange(event: FileChangeEvent): Promise<void> {
        const uri = event.uri;
        const currentDocs = this._documents.get();
        const existingDoc = currentDocs.get(uri);

        if (event.version === -1) {
            // File was deleted
            if (existingDoc) {
                this._removeDocument(uri);
                this._updateWatchers();
            }
            return;
        }

        let newDoc: AkustoDocument;

        if (existingDoc && event.edits) {
            // Incremental update
            newDoc = existingDoc.withEdits(event.edits);
        } else {
            // Full re-read
            const { text } = await this.fs.readFile(uri);
            newDoc = AkustoDocument.parse(uri, text);
        }

        // Update the document
        this._updateDocument(uri, newDoc);

        // Check if includes changed - may need to load new files or unwatch old ones
        await this._updateIncludesFor(uri, newDoc);
    }

    /**
     * Update includes for a document (load new, potentially unwatch old).
     */
    private async _updateIncludesFor(uri: string, doc: AkustoDocument): Promise<void> {
        const includes = this._getIncludes(doc);
        for (const includePath of includes) {
            const resolvedUri = this.fs.resolvePath(uri, includePath);
            if (!this._documents.get().has(resolvedUri)) {
                try {
                    await this._loadAndWatch(resolvedUri);
                } catch (e) {
                    console.error(`Failed to load include ${resolvedUri}:`, e);
                }
            }
        }

        // Update watchers (may remove watchers for files no longer needed)
        this._updateWatchers();
    }

    /**
     * Update watchers - add watchers for needed files, remove watchers for unneeded files.
     */
    private _updateWatchers(): void {
        const needed = this._getNeededUris();

        // Remove watchers for files no longer needed
        for (const [uri, watcher] of this._watchers) {
            if (!needed.has(uri)) {
                watcher.dispose();
                this._watchers.delete(uri);
            }
        }

        // Remove documents no longer needed
        const currentDocs = this._documents.get();
        const newDocs = new Map<string, AkustoDocument>();
        for (const [uri, doc] of currentDocs) {
            if (needed.has(uri)) {
                newDocs.set(uri, doc);
            }
        }

        if (newDocs.size !== currentDocs.size) {
            this._documents.set(newDocs, undefined, undefined);
        }
    }

    /**
     * Get all URIs that are needed (roots + transitive includes).
     */
    private _getNeededUris(): Set<string> {
        const needed = new Set<string>();
        const currentDocs = this._documents.get();

        const visit = (uri: string) => {
            if (needed.has(uri)) return;
            needed.add(uri);

            const doc = currentDocs.get(uri);
            if (doc) {
                for (const includePath of this._getIncludes(doc)) {
                    const resolvedUri = this.fs.resolvePath(uri, includePath);
                    visit(resolvedUri);
                }
            }
        };

        for (const root of this._rootUris) {
            visit(root);
        }

        return needed;
    }

    /**
     * Extract include paths from a document.
     */
    private _getIncludes(doc: AkustoDocument): string[] {
        const includes: string[] = [];

        const processInstructions = (instructions: { expression: string }[]) => {
            for (const instr of instructions) {
                const parsed = parseInstructionExpression(instr.expression);
                if (parsed.ok && parsed.instruction.type === 'include') {
                    includes.push(parsed.instruction.path);
                }
            }
        };

        processInstructions(doc.ast.getInstructions());
        for (const chapter of doc.ast.getChapters()) {
            processInstructions(chapter.getInstructions());
        }

        return includes;
    }

    private _updateDocument(uri: string, doc: AkustoDocument): void {
        const current = this._documents.get();
        const newMap = new Map(current);
        newMap.set(uri, doc);
        this._documents.set(newMap, undefined, undefined);
    }

    private _removeDocument(uri: string): void {
        const current = this._documents.get();
        if (!current.has(uri)) return;
        const newMap = new Map(current);
        newMap.delete(uri);
        this._documents.set(newMap, undefined, undefined);
    }

    private _normalizeUri(uri: string): string {
        return uri.replace(/\\/g, '/');
    }
}

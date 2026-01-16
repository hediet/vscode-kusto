import { FileSystem, FileContent } from '../common/fileSystem';
import { AkustoDocument, AkustoProject, AkustoProjectLoader, ResolvedDocumentAdapter, SourceTextProvider } from '../akusto';
import { createKustoLanguageService, KustoLanguageService, KustoSchema } from '../kusto';
import { KustoFragment } from '../akusto/kustoFragment';

/**
 * Document change event.
 */
export interface DocumentChangeEvent {
    readonly uri: string;
    readonly content: string;
}

/**
 * Listener for document changes.
 */
export type DocumentChangeListener = (event: DocumentChangeEvent) => void;

/**
 * A file system wrapper that reads from local documents first, then falls back to the underlying FS.
 */
class LocalFirstFileSystem implements FileSystem {
    constructor(
        private readonly localDocs: Map<string, AkustoDocument>,
        private readonly underlying: FileSystem
    ) { }

    async readFile(uri: string): Promise<FileContent> {
        const normalizedUri = uri.replace(/\\/g, '/');
        const localDoc = this.localDocs.get(normalizedUri);
        if (localDoc) {
            return { text: localDoc.text, version: 0 };
        }
        return this.underlying.readFile(uri);
    }

    async exists(uri: string): Promise<boolean> {
        const normalizedUri = uri.replace(/\\/g, '/');
        if (this.localDocs.has(normalizedUri)) {
            return true;
        }
        return this.underlying.exists(uri);
    }

    resolvePath(baseUri: string, relativePath: string): string {
        return this.underlying.resolvePath(baseUri, relativePath);
    }
}

/**
 * Manages the Akusto workspace - tracks documents, resolves dependencies, provides language features.
 * 
 * This class is platform-agnostic. VS Code integration happens via a thin wrapper.
 */
export class AkustoWorkspace {
    private readonly _documents = new Map<string, AkustoDocument>();
    private _project: AkustoProject = AkustoProject.empty();
    private _languageService: KustoLanguageService;
    private readonly _listeners = new Set<DocumentChangeListener>();

    constructor(
        private readonly fs: FileSystem,
        schema?: KustoSchema
    ) {
        this._languageService = createKustoLanguageService(schema);
    }

    /**
     * Update the schema (e.g., after fetching from cluster).
     */
    updateSchema(schema: KustoSchema): void {
        this._languageService = createKustoLanguageService(schema);
    }

    /**
     * Open or update a document.
     * Triggers re-parsing and include resolution.
     */
    async setDocument(uri: string, content: string): Promise<void> {
        const normalizedUri = this._normalizeUri(uri);
        const doc = AkustoDocument.parse(normalizedUri, content);
        this._documents.set(normalizedUri, doc);

        // Reload project with all includes
        await this._reloadProject(normalizedUri);

        // Notify listeners
        this._notifyChange({ uri: normalizedUri, content });
    }

    /**
     * Close a document.
     */
    closeDocument(uri: string): void {
        const normalizedUri = this._normalizeUri(uri);
        this._documents.delete(normalizedUri);
        this._rebuildProject();
    }

    /**
     * Get a document by URI.
     */
    getDocument(uri: string): AkustoDocument | undefined {
        return this._documents.get(this._normalizeUri(uri));
    }

    /**
     * Get all open document URIs.
     */
    getOpenDocuments(): string[] {
        return Array.from(this._documents.keys());
    }

    /**
     * Get the current project state.
     */
    get project(): AkustoProject {
        return this._project;
    }

    /**
     * Get adapter for a specific fragment in a document.
     * Returns null if document or fragment not found.
     */
    getAdapter(uri: string, fragment: KustoFragment): ResolvedDocumentAdapter | null {
        const normalizedUri = this._normalizeUri(uri);
        const doc = this._project.documents.get(normalizedUri);
        if (!doc) {
            return null;
        }

        try {
            const resolved = this._project.resolve(doc, fragment);
            // Create a source text provider that looks up documents from the project
            const sourceTextProvider: SourceTextProvider = {
                getSourceText: (sourceUri: string) => {
                    const sourceDoc = this._project.documents.get(sourceUri);
                    return sourceDoc?.text;
                }
            };
            return new ResolvedDocumentAdapter(resolved, this._languageService, sourceTextProvider);
        } catch {
            return null;
        }
    }

    /**
     * Get adapter for a fragment at a specific offset in a document.
     */
    getAdapterAtOffset(uri: string, offset: number): ResolvedDocumentAdapter | null {
        const normalizedUri = this._normalizeUri(uri);
        const doc = this._project.documents.get(normalizedUri);
        if (!doc) {
            return null;
        }

        // Find the fragment containing this offset
        const fragment = doc.fragments.find(f => f.range.contains(offset));
        if (!fragment) {
            return null;
        }

        return this.getAdapter(uri, fragment);
    }

    /**
     * Find the fragment at a given offset in a document.
     */
    findFragmentAtOffset(uri: string, offset: number): KustoFragment | undefined {
        const normalizedUri = this._normalizeUri(uri);
        const doc = this._project.documents.get(normalizedUri);
        return doc?.fragments.find(f => f.range.contains(offset));
    }

    /**
     * Subscribe to document changes.
     */
    onDocumentChange(listener: DocumentChangeListener): () => void {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    /**
     * Reload project starting from a document, resolving all includes.
     */
    private async _reloadProject(entryUri: string): Promise<void> {
        try {
            // Use a file system that reads from local documents first
            const localFirstFs = new LocalFirstFileSystem(this._documents, this.fs);
            const loader = new AkustoProjectLoader(localFirstFs);

            // Load includes from file system (local docs take priority)
            const loaded = await loader.loadDocument(entryUri);

            // Use the loaded project directly - local docs were already included via LocalFirstFileSystem
            this._project = loaded;
        } catch (e) {
            // If loading fails, just use locally tracked documents
            console.error('Failed to reload project:', e);
            this._rebuildProject();
        }
    }

    /**
     * Rebuild project from locally tracked documents only.
     */
    private _rebuildProject(): void {
        this._project = AkustoProject.fromDocuments(this._documents.values());
    }

    private _notifyChange(event: DocumentChangeEvent): void {
        for (const listener of this._listeners) {
            try {
                listener(event);
            } catch (e) {
                console.error('Document change listener error:', e);
            }
        }
    }

    private _normalizeUri(uri: string): string {
        return uri.replace(/\\/g, '/');
    }
}

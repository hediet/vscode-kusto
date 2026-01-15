import {
    ISettableObservable,
    observableValue,
    derived,
    IObservable,
    transaction,
} from '@vscode/observables';
import { AkustoDocument } from '../language/akusto/akustoDocument';
import { AkustoProject } from '../language/akusto/akustoProject';

/**
 * Observable model for a workspace containing Akusto documents.
 * Documents are updated via edits (not by replacing content).
 */
export class WorkspaceModel {
    /** Observable map of URI -> AkustoDocument */
    private readonly _documents: ISettableObservable<ReadonlyMap<string, AkustoDocument>>;

    /** Observable project derived from all documents */
    public readonly project: IObservable<AkustoProject>;

    constructor() {
        this._documents = observableValue('WorkspaceModel.documents', new Map<string, AkustoDocument>());

        // Derive project from documents
        this.project = derived(this, reader => {
            const docs = this._documents.read(reader);
            return AkustoProject.fromDocuments(docs.values());
        });
    }

    /** Get observable map of all documents */
    get documents(): IObservable<ReadonlyMap<string, AkustoDocument>> {
        return this._documents;
    }

    /** Get a derived observable for a specific document */
    getDocument(uri: string): IObservable<AkustoDocument | undefined> {
        return derived(this, reader => {
            const docs = this._documents.read(reader);
            return docs.get(uri);
        });
    }

    /**
     * Open a document with initial content.
     * If already open, this replaces the document.
     */
    openDocument(uri: string, content: string): void {
        const doc = AkustoDocument.parse(uri, content);
        this._updateDocument(uri, doc);
    }

    /**
     * Close a document.
     */
    closeDocument(uri: string): void {
        const current = this._documents.get();
        if (!current.has(uri)) {
            return;
        }
        const newMap = new Map(current);
        newMap.delete(uri);
        this._documents.set(newMap, undefined, undefined);
    }

    /**
     * Apply an edit to a document.
     * The document must already be open.
     */
    applyEdit(uri: string, start: number, end: number, newText: string): void {
        const current = this._documents.get();
        const doc = current.get(uri);
        if (!doc) {
            console.warn(`WorkspaceModel: Cannot apply edit to unopened document: ${uri}`);
            return;
        }

        const newDoc = doc.withEdit(start, end, newText);
        this._updateDocument(uri, newDoc);
    }

    /**
     * Apply multiple edits to a document atomically.
     * Edits should be in document order.
     */
    applyEdits(uri: string, edits: ReadonlyArray<{ start: number; end: number; text: string }>): void {
        const current = this._documents.get();
        const doc = current.get(uri);
        if (!doc) {
            console.warn(`WorkspaceModel: Cannot apply edits to unopened document: ${uri}`);
            return;
        }

        const newDoc = doc.withEdits(edits);
        this._updateDocument(uri, newDoc);
    }

    /**
     * Apply edits to multiple documents in a single transaction.
     */
    applyBatchEdits(edits: ReadonlyArray<{
        uri: string;
        edits: ReadonlyArray<{ start: number; end: number; text: string }>;
    }>): void {
        transaction(tx => {
            const current = this._documents.get();
            const newMap = new Map(current);

            for (const docEdit of edits) {
                const doc = newMap.get(docEdit.uri);
                if (doc) {
                    newMap.set(docEdit.uri, doc.withEdits(docEdit.edits));
                }
            }

            this._documents.set(newMap, tx, undefined);
        });
    }

    private _updateDocument(uri: string, doc: AkustoDocument): void {
        const current = this._documents.get();
        const newMap = new Map(current);
        newMap.set(uri, doc);
        this._documents.set(newMap, undefined, undefined);
    }
}

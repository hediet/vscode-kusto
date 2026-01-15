import * as vscode from 'vscode';
import { WorkspaceModel } from './workspaceModel';
import { Disposable } from '../utils/disposables';

/**
 * Connects VS Code document events to the WorkspaceModel.
 * Listens for document open/close/change events and updates the model.
 */
export class VsCodeDocumentSync extends Disposable {
    constructor(
        private readonly model: WorkspaceModel,
        /** Filter for which documents to track (e.g., .kql files only) */
        private readonly filter: (doc: vscode.TextDocument) => boolean = isKustoDocument
    ) {
        super();

        // Sync already-open documents
        for (const doc of vscode.workspace.textDocuments) {
            if (this.filter(doc)) {
                this._onDocumentOpen(doc);
            }
        }

        // Listen for document events
        this._register(vscode.workspace.onDidOpenTextDocument(doc => {
            if (this.filter(doc)) {
                this._onDocumentOpen(doc);
            }
        }));

        this._register(vscode.workspace.onDidCloseTextDocument(doc => {
            if (this.filter(doc)) {
                this._onDocumentClose(doc);
            }
        }));

        this._register(vscode.workspace.onDidChangeTextDocument(event => {
            if (this.filter(event.document)) {
                this._onDocumentChange(event);
            }
        }));
    }

    private _onDocumentOpen(doc: vscode.TextDocument): void {
        const uri = doc.uri.toString();
        this.model.openDocument(uri, doc.getText());
    }

    private _onDocumentClose(doc: vscode.TextDocument): void {
        const uri = doc.uri.toString();
        this.model.closeDocument(uri);
    }

    private _onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        const uri = event.document.uri.toString();

        if (event.contentChanges.length === 0) {
            return;
        }

        // Convert VS Code changes to our edit format
        const edits = event.contentChanges.map(change => ({
            start: change.rangeOffset,
            end: change.rangeOffset + change.rangeLength,
            text: change.text,
        }));

        // Apply all edits
        this.model.applyEdits(uri, edits);
    }
}

/** Check if a document is a Kusto file */
function isKustoDocument(doc: vscode.TextDocument): boolean {
    return doc.languageId === 'kusto' ||
        doc.fileName.endsWith('.kql') ||
        doc.fileName.endsWith('.csl');
}

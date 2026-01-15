import * as vscode from 'vscode';
import {
    WatchableFileSystem,
    FileContent,
    FileChangeEvent,
    IDisposable,
    StringEdit,
} from '../language/common/fileSystem';

const KUSTO_LANGUAGE_ID = 'kusto';

/**
 * VS Code-backed watchable file system.
 * 
 * Key behaviors:
 * - Reading checks open TextDocuments first (handles unsaved changes)
 * - Watching uses TextDocument events for open files, FileSystemWatcher for closed files
 * - Automatically switches between the two when documents open/close
 * - Tracks all open Kusto documents via onDidOpenKustoDocument / onDidCloseKustoDocument events
 */
export class VsCodeWatchableFileSystem implements WatchableFileSystem, IDisposable {
    private readonly _openDocVersions = new Map<string, number>();
    private readonly _disposables: vscode.Disposable[] = [];

    private readonly _onDidOpenKustoDocument = new vscode.EventEmitter<vscode.TextDocument>();
    private readonly _onDidCloseKustoDocument = new vscode.EventEmitter<vscode.TextDocument>();

    /** Fires when a Kusto document is opened in VS Code. */
    public readonly onDidOpenKustoDocument = this._onDidOpenKustoDocument.event;

    /** Fires when a Kusto document is closed in VS Code. */
    public readonly onDidCloseKustoDocument = this._onDidCloseKustoDocument.event;

    constructor() {
        // Track document open/close for Kusto files
        this._disposables.push(
            vscode.workspace.onDidOpenTextDocument(doc => {
                if (doc.languageId === KUSTO_LANGUAGE_ID) {
                    this._onDidOpenKustoDocument.fire(doc);
                }
            }),
            vscode.workspace.onDidCloseTextDocument(doc => {
                if (doc.languageId === KUSTO_LANGUAGE_ID) {
                    this._onDidCloseKustoDocument.fire(doc);
                }
            }),
            this._onDidOpenKustoDocument,
            this._onDidCloseKustoDocument
        );
    }

    /**
     * Get all currently open Kusto documents.
     */
    getOpenKustoDocuments(): vscode.TextDocument[] {
        return vscode.workspace.textDocuments.filter(doc => doc.languageId === KUSTO_LANGUAGE_ID);
    }

    dispose(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables.length = 0;
    }

    async readFile(uri: string): Promise<FileContent> {
        const vsUri = vscode.Uri.parse(uri);

        // Check if document is open (handles unsaved changes)
        const openDoc = vscode.workspace.textDocuments.find(
            doc => doc.uri.toString() === vsUri.toString()
        );

        if (openDoc) {
            return {
                text: openDoc.getText(),
                version: openDoc.version,
            };
        }

        // Read from disk
        const bytes = await vscode.workspace.fs.readFile(vsUri);
        return {
            text: new TextDecoder().decode(bytes),
            version: 0, // Disk files don't have a meaningful version
        };
    }

    async exists(uri: string): Promise<boolean> {
        try {
            const vsUri = vscode.Uri.parse(uri);

            // Check open documents
            const openDoc = vscode.workspace.textDocuments.find(
                doc => doc.uri.toString() === vsUri.toString()
            );
            if (openDoc) {
                return true;
            }

            // Check disk
            await vscode.workspace.fs.stat(vsUri);
            return true;
        } catch {
            return false;
        }
    }

    resolvePath(baseUri: string, relativePath: string): string {
        const base = vscode.Uri.parse(baseUri);

        // Handle relative path
        if (relativePath.startsWith('./')) {
            relativePath = relativePath.substring(2);
        }

        // Get directory of base
        const basePath = base.path;
        const lastSlash = basePath.lastIndexOf('/');
        const baseDir = lastSlash >= 0 ? basePath.substring(0, lastSlash) : basePath;

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

        // Reconstruct URI
        return base.with({ path: baseParts.join('/') }).toString();
    }

    watchFile(uri: string, onDidChange: (event: FileChangeEvent) => void): IDisposable {
        const vsUri = vscode.Uri.parse(uri);
        const uriString = vsUri.toString();
        const disposables: vscode.Disposable[] = [];

        // Track whether we're currently watching via TextDocument or FileSystemWatcher
        let documentWatcher: vscode.Disposable | undefined;
        let fileWatcher: vscode.FileSystemWatcher | undefined;
        let lastVersion = -1;

        const setupDocumentWatching = (doc: vscode.TextDocument) => {
            // Dispose file watcher if active
            fileWatcher?.dispose();
            fileWatcher = undefined;

            // Track version to detect changes
            lastVersion = doc.version;
            this._openDocVersions.set(uriString, lastVersion);

            // Watch for content changes
            documentWatcher = vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.uri.toString() !== uriString) return;
                if (event.contentChanges.length === 0) return;

                const newVersion = event.document.version;

                // Convert VS Code changes to StringEdits
                const edits: StringEdit[] = event.contentChanges.map(change => ({
                    start: change.rangeOffset,
                    end: change.rangeOffset + change.rangeLength,
                    text: change.text,
                }));

                onDidChange({
                    uri: uriString,
                    version: newVersion,
                    edits,
                });

                lastVersion = newVersion;
                this._openDocVersions.set(uriString, lastVersion);
            });
            disposables.push(documentWatcher);
        };

        const setupFileWatching = () => {
            // Dispose document watcher if active
            documentWatcher?.dispose();
            documentWatcher = undefined;
            this._openDocVersions.delete(uriString);

            // Create file system watcher
            // Note: FileSystemWatcher doesn't give us incremental edits
            // Watch specifically this file
            fileWatcher = vscode.workspace.createFileSystemWatcher(
                vsUri.fsPath,
                false, // ignoreCreateEvents
                false, // ignoreChangeEvents
                false  // ignoreDeleteEvents
            );

            fileWatcher.onDidChange(() => {
                lastVersion++;
                onDidChange({
                    uri: uriString,
                    version: lastVersion,
                    // No edits - must re-read
                });
            });

            fileWatcher.onDidDelete(() => {
                onDidChange({
                    uri: uriString,
                    version: -1, // Signal deletion
                });
            });

            fileWatcher.onDidCreate(() => {
                lastVersion++;
                onDidChange({
                    uri: uriString,
                    version: lastVersion,
                });
            });

            disposables.push(fileWatcher);
        };

        // Check if document is already open
        const openDoc = vscode.workspace.textDocuments.find(
            doc => doc.uri.toString() === uriString
        );

        if (openDoc) {
            setupDocumentWatching(openDoc);
        } else {
            setupFileWatching();
        }

        // Watch for document open/close to switch modes
        disposables.push(vscode.workspace.onDidOpenTextDocument(doc => {
            if (doc.uri.toString() === uriString) {
                setupDocumentWatching(doc);
            }
        }));

        disposables.push(vscode.workspace.onDidCloseTextDocument(doc => {
            if (doc.uri.toString() === uriString) {
                setupFileWatching();
            }
        }));

        return {
            dispose: () => {
                for (const d of disposables) {
                    d.dispose();
                }
                this._openDocVersions.delete(uriString);
            }
        };
    }
}

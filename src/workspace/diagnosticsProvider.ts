import * as vscode from 'vscode';
import { autorun, ISettableObservable, observableValue } from '@vscode/observables';
import { Disposable } from '../utils/disposables';
import { MutableProject } from '../language/workspace/mutableProject';
import { ResolvedDocumentAdapter } from '../language/akusto/resolvedDocumentAdapter';
import { AkustoDocument } from '../language/akusto/akustoDocument';
import { getLanguageServiceForInstructions } from './languageServiceResolver';

/**
 * Provides diagnostics for Kusto documents.
 * Only computes diagnostics for the active editor's document to avoid performance issues
 * with large definition files.
 */
export class DiagnosticsProvider extends Disposable {
    private readonly diagnostics: vscode.DiagnosticCollection;
    private readonly _activeUri: ISettableObservable<string | undefined>;

    constructor(private readonly model: MutableProject) {
        super();

        this.diagnostics = vscode.languages.createDiagnosticCollection('kusto');
        this._register({ dispose: () => this.diagnostics.dispose() });

        this._activeUri = observableValue('DiagnosticsProvider.activeUri', undefined as string | undefined);

        // Track active editor changes
        this._register(vscode.window.onDidChangeActiveTextEditor(editor => {
            this._onActiveEditorChanged(editor);
        }));

        // Initial update for current active editor
        this._onActiveEditorChanged(vscode.window.activeTextEditor);

        // Autorun: update diagnostics for active document when it changes
        this._register(autorun(reader => {
            /** @description Update Kusto diagnostics for active document */
            const documents = this.model.documents.read(reader);
            const project = this.model.project.read(reader);
            const activeUri = this._activeUri.read(reader);

            if (!activeUri) {
                return;
            }

            const doc = documents.get(activeUri);
            if (!doc) {
                return;
            }

            const startTime = performance.now();

            const vsDiagnostics = this._computeDiagnostics(doc, project);
            this.diagnostics.set(vscode.Uri.parse(activeUri), vsDiagnostics);

            const totalTime = performance.now() - startTime;
            if (totalTime > 100) {
                console.log(`[Diagnostics] Slow: ${totalTime.toFixed(0)}ms for ${vsDiagnostics.length} diagnostics`);
            }
        }));
    }

    private _onActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
        const newUri = editor?.document.languageId === 'kusto'
            ? editor.document.uri.toString()
            : undefined;

        const currentUri = this._activeUri.get();
        if (newUri === currentUri) {
            return;
        }

        // Clear diagnostics for old document
        if (currentUri) {
            this.diagnostics.delete(vscode.Uri.parse(currentUri));
        }

        this._activeUri.set(newUri, undefined);
    }

    private _computeDiagnostics(
        doc: AkustoDocument,
        project: import('../language/akusto/akustoProject').AkustoProject
    ): vscode.Diagnostic[] {
        const results: vscode.Diagnostic[] = [];

        // Only compute diagnostics for non-definition fragments (executable queries)
        // Skip definitions (let $name = ...) as they're not meant to run standalone
        const executableFragments = doc.fragments.filter(f => !f.exportedName);

        for (const fragment of executableFragments) {
            try {
                const resolved = project.resolve(doc, fragment);
                const service = getLanguageServiceForInstructions(resolved.instructions);
                const adapter = new ResolvedDocumentAdapter(resolved, service);

                // Only get diagnostics for the current document, not dependencies
                const fragmentDiags = adapter.getDiagnosticsForDocument(doc.uri);

                for (const diag of fragmentDiags) {
                    const startPos = this._offsetToPosition(doc.text, diag.location.offset);
                    const endPos = this._offsetToPosition(doc.text, diag.location.offset + diag.length);

                    results.push(new vscode.Diagnostic(
                        new vscode.Range(startPos, endPos),
                        diag.message,
                        this._mapSeverity(diag.severity)
                    ));
                }
            } catch (e) {
                // Don't log errors for every fragment - too noisy
            }
        }

        return results;
    }

    private _offsetToPosition(text: string, offset: number): vscode.Position {
        let line = 0;
        let col = 0;
        for (let i = 0; i < offset && i < text.length; i++) {
            if (text[i] === '\n') {
                line++;
                col = 0;
            } else {
                col++;
            }
        }
        return new vscode.Position(line, col);
    }

    private _mapSeverity(severity: string): vscode.DiagnosticSeverity {
        switch (severity) {
            case 'error': return vscode.DiagnosticSeverity.Error;
            case 'warning': return vscode.DiagnosticSeverity.Warning;
            case 'suggestion': return vscode.DiagnosticSeverity.Hint;
            default: return vscode.DiagnosticSeverity.Information;
        }
    }
}

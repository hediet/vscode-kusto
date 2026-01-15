import * as vscode from 'vscode';
import { autorun } from '@vscode/observables';
import { Disposable } from '../utils/disposables';
import { MutableProject } from '../language/workspace/mutableProject';
import { ResolvedDocumentAdapter } from '../language/akusto/resolvedDocumentAdapter';
import { AkustoDocument } from '../language/akusto/akustoDocument';
import { getLanguageServiceForInstructions } from './languageServiceResolver';

/**
 * Provides diagnostics for Kusto documents using observables.
 * Automatically updates diagnostics when documents change.
 */
export class DiagnosticsProvider extends Disposable {
    private readonly diagnostics: vscode.DiagnosticCollection;

    constructor(private readonly model: MutableProject) {
        super();

        this.diagnostics = vscode.languages.createDiagnosticCollection('kusto');
        this._register({ dispose: () => this.diagnostics.dispose() });

        // Autorun: update diagnostics whenever documents change
        this._register(autorun(reader => {
            /** @description Update Kusto diagnostics */
            const documents = this.model.documents.read(reader);
            const project = this.model.project.read(reader);

            // Clear all diagnostics first
            this.diagnostics.clear();

            // Compute diagnostics for each document
            for (const [uri, doc] of documents) {
                const vsDiagnostics = this._computeDiagnostics(doc, project);
                this.diagnostics.set(vscode.Uri.parse(uri), vsDiagnostics);
            }
        }));
    }

    private _computeDiagnostics(
        doc: AkustoDocument,
        project: import('../language/akusto/akustoProject').AkustoProject
    ): vscode.Diagnostic[] {
        const results: vscode.Diagnostic[] = [];

        // Get diagnostics for each fragment in the document
        for (const fragment of doc.fragments) {
            try {
                const resolved = project.resolve(doc, fragment);
                const service = getLanguageServiceForInstructions(resolved.instructions);
                const adapter = new ResolvedDocumentAdapter(resolved, service);
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
                console.error(`DiagnosticsProvider: Error computing diagnostics for fragment:`, e);
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

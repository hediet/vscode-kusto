import * as vscode from 'vscode';
import { Disposable } from '../utils/disposables';
import { MutableProject } from '../language/workspace/mutableProject';
import { ResolvedDocumentAdapter } from '../language/akusto/resolvedDocumentAdapter';
import { DocumentOffset } from '../language/common/documentOffset';
import { getLanguageServiceForInstructions } from './languageServiceResolver';

/**
 * Provides hover information for Kusto documents.
 */
export class HoverProvider extends Disposable implements vscode.HoverProvider {
    constructor(private readonly model: MutableProject) {
        super();

        this._register(vscode.languages.registerHoverProvider(
            [{ language: 'kusto' }, { pattern: '**/*.kql' }, { pattern: '**/*.csl' }],
            this
        ));
    }

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | null {
        const uri = document.uri.toString();
        const offset = document.offsetAt(position);

        const doc = this.model.documents.get().get(uri);
        const project = this.model.project.get();

        if (!doc) {
            return null;
        }

        const fragment = doc.getFragmentAt(offset);
        if (!fragment) {
            return null;
        }

        try {
            const resolved = project.resolve(doc, fragment);
            const service = getLanguageServiceForInstructions(resolved.instructions);
            const adapter = new ResolvedDocumentAdapter(resolved, service);
            const hover = adapter.getHover(new DocumentOffset(uri, offset));

            if (!hover) {
                return null;
            }

            return new vscode.Hover(new vscode.MarkdownString(hover.contents));
        } catch (e) {
            console.error('HoverProvider: Error getting hover:', e);
            return null;
        }
    }
}

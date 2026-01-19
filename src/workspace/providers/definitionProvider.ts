import * as vscode from 'vscode';
import { Disposable } from '../../utils/disposables';
import { MutableProject } from '../../language/workspace/mutableProject';
import { ResolvedDocumentAdapter } from '../../language/akusto/resolvedDocumentAdapter';
import { getDefinitionNameAtOffset } from '../../language/akusto/definitionInfo';
import { DocumentOffset } from '../../language/common/documentOffset';
import { getLanguageServiceForInstructions } from '../languageServiceResolver';

/**
 * Provides "Go to Definition" for Kusto documents.
 * Uses Kusto's GetRelatedElements to find declarations.
 * Also handles $definition references.
 */
export class DefinitionProvider extends Disposable implements vscode.DefinitionProvider {
    constructor(private readonly model: MutableProject) {
        super();

        this._register(vscode.languages.registerDefinitionProvider(
            [{ language: 'kusto' }, { pattern: '**/*.kql' }, { pattern: '**/*.csl' }],
            this
        ));
    }

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Definition | vscode.LocationLink[] | null {
        const uri = document.uri.toString();
        const offset = document.offsetAt(position);

        const doc = this.model.documents.get().get(uri);
        const project = this.model.project.get();

        if (!doc) {
            return null;
        }

        // Check if we're on a $definition reference
        const text = document.getText();
        const defName = getDefinitionNameAtOffset(text, offset);
        if (defName) {
            const defInfo = project.getDefinitionInfo(defName);
            if (defInfo) {
                const targetUri = vscode.Uri.parse(defInfo.uri);
                const targetVsDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === defInfo.uri);
                if (targetVsDoc) {
                    const pos = targetVsDoc.positionAt(defInfo.nameRange.start);
                    const endPos = targetVsDoc.positionAt(defInfo.nameRange.endExclusive);
                    return new vscode.Location(targetUri, new vscode.Range(pos, endPos));
                }
            }
        }

        const fragment = doc.getFragmentAt(offset);
        if (!fragment) {
            return null;
        }

        try {
            const resolved = project.resolve(doc, fragment);
            const service = getLanguageServiceForInstructions(resolved.instructions);
            const adapter = new ResolvedDocumentAdapter(resolved, service);
            const relatedInfo = adapter.getRelatedElements(new DocumentOffset(uri, offset));

            if (!relatedInfo || relatedInfo.elements.length === 0) {
                return null;
            }

            // Find all declaration elements
            const declarations = relatedInfo.elements.filter(el => el.kind === 'declaration');

            if (declarations.length === 0) {
                return null;
            }

            // Get the current element (reference) to determine the origin selection range
            // This controls what VS Code underlines when hovering for go-to-definition
            const currentElement = relatedInfo.elements[relatedInfo.currentIndex];
            let originSelectionRange: vscode.Range | undefined;
            if (currentElement && currentElement.location.uri === uri) {
                const originStart = document.positionAt(currentElement.location.offset);
                const originEnd = document.positionAt(currentElement.location.offset + currentElement.length);
                originSelectionRange = new vscode.Range(originStart, originEnd);
            }

            // Convert to VS Code LocationLinks (includes origin selection range for proper underlining)
            const locationLinks: vscode.LocationLink[] = [];
            for (const decl of declarations) {
                const targetUri = vscode.Uri.parse(decl.location.uri);

                // Get the VS Code document to convert offset to position
                const targetVsDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === decl.location.uri);
                if (targetVsDoc) {
                    const pos = targetVsDoc.positionAt(decl.location.offset);
                    const endPos = targetVsDoc.positionAt(decl.location.offset + decl.length);
                    const targetRange = new vscode.Range(pos, endPos);

                    locationLinks.push({
                        originSelectionRange,
                        targetUri,
                        targetRange,
                        targetSelectionRange: targetRange,
                    });
                }
            }

            return locationLinks.length > 0 ? locationLinks : null;
        } catch (e) {
            console.error('[Definition] Error:', e);
            return null;
        }
    }
}

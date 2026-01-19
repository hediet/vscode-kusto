import * as vscode from 'vscode';
import { Disposable } from '../../utils/disposables';
import { MutableProject } from '../../language/workspace/mutableProject';
import { ResolvedDocumentAdapter, SourceTextProvider } from '../../language/akusto/resolvedDocumentAdapter';
import { getDefinitionNameAtOffset } from '../../language/akusto/definitionInfo';
import { DocumentOffset } from '../../language/common/documentOffset';
import { getLanguageServiceForInstructions } from '../languageServiceResolver';

/**
 * Source text provider that reads from the MutableProject's documents.
 * This includes both open documents and loaded dependency files.
 */
class VsCodeSourceTextProvider implements SourceTextProvider {
    constructor(private readonly model: MutableProject) { }

    getSourceText(uri: string): string | undefined {
        const doc = this.model.documents.get().get(uri);
        return doc?.text;  // AkustoDocument has .text property
    }
}

/**
 * Provides hover information for Kusto documents.
 */
export class HoverProvider extends Disposable implements vscode.HoverProvider {
    private readonly sourceTextProvider: SourceTextProvider;

    constructor(private readonly model: MutableProject) {
        super();

        this.sourceTextProvider = new VsCodeSourceTextProvider(model);

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
        const startTime = performance.now();
        const uri = document.uri.toString();
        const offset = document.offsetAt(position);

        const doc = this.model.documents.get().get(uri);
        const project = this.model.project.get();

        // DEBUG: Log the state
        console.log(`[Hover DEBUG] URI: ${uri}`);
        console.log(`[Hover DEBUG] doc exists: ${!!doc}`);
        console.log(`[Hover DEBUG] documents in project: ${Array.from(this.model.documents.get().keys()).join(', ')}`);

        if (!doc) {
            return null;
        }

        // Check if we're hovering over a $definition reference
        const text = document.getText();
        const defName = getDefinitionNameAtOffset(text, offset);
        console.log(`[Hover DEBUG] offset: ${offset}, defName: ${defName}`);
        if (defName) {
            const allDefs = project.getDefinitionInfos();
            console.log(`[Hover DEBUG] All definitions: ${Array.from(allDefs.keys()).join(', ')}`);
            const defInfo = project.getDefinitionInfo(defName);
            console.log(`[Hover DEBUG] Found defInfo: ${!!defInfo}`);
            if (defInfo) {
                const contents = new vscode.MarkdownString();
                contents.appendCodeblock(defName, 'kusto');
                if (defInfo.documentation) {
                    contents.appendMarkdown('\n\n' + defInfo.documentation);
                }
                return new vscode.Hover(contents);
            }
        }

        const fragment = doc.getFragmentAt(offset);
        if (!fragment) {
            return null;
        }

        try {
            const resolveStart = performance.now();
            const resolved = project.resolve(doc, fragment);
            const resolveTime = performance.now() - resolveStart;

            const serviceStart = performance.now();
            const service = getLanguageServiceForInstructions(resolved.instructions);
            const serviceTime = performance.now() - serviceStart;

            const hoverStart = performance.now();
            const adapter = new ResolvedDocumentAdapter(resolved, service, this.sourceTextProvider);
            const hover = adapter.getHover(new DocumentOffset(uri, offset));
            const hoverTime = performance.now() - hoverStart;

            const totalTime = performance.now() - startTime;
            if (totalTime > 100) {
                console.log(`[Hover] Slow: ${totalTime.toFixed(0)}ms (resolve: ${resolveTime.toFixed(0)}ms, service: ${serviceTime.toFixed(0)}ms, hover: ${hoverTime.toFixed(0)}ms)`);
            }

            if (!hover) {
                return null;
            }

            return new vscode.Hover(new vscode.MarkdownString(hover.contents));
        } catch (e) {
            console.error('[Hover] Error:', e);
            return null;
        }
    }
}

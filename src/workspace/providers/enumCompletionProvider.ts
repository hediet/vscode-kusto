import * as vscode from 'vscode';
import { Disposable } from '../../utils/disposables';
import { MutableProject } from '../../language/workspace/mutableProject';
import { detectComparisonContext, extractEnumVariants } from '../../language/akusto/enumParser';
import { extractDocumentation } from '../../language/akusto/resolvedDocumentAdapter';
import { DocumentOffset } from '../../language/common/documentOffset';
import { getLanguageServiceForInstructions } from '../languageServiceResolver';

/**
 * Provides enum value completions when typing `column == "`.
 * 
 * This provider detects when the user is typing a string comparison against
 * a column, looks up the column's documentation for `@enum-variant` annotations,
 * and provides completions for the enum values.
 * 
 * Example:
 * ```kql
 * // status code
 * // @enum-variant "pending" Is still pending
 * // @enum-variant "active" Currently active
 * | extend status = tostring(Properties["status"])
 * | where status == "  // <-- triggers completion for "pending", "active"
 * ```
 */
export class EnumCompletionProvider extends Disposable implements vscode.CompletionItemProvider {

    constructor(private readonly model: MutableProject) {
        super();

        // Register completion provider with " as trigger character
        this._register(vscode.languages.registerCompletionItemProvider(
            [{ language: 'kusto' }, { pattern: '**/*.kql' }, { pattern: '**/*.csl' }],
            this,
            '"' // Trigger on opening quote
        ));
    }

    private _getSourceText(uri: string): string | undefined {
        const doc = this.model.documents.get().get(uri);
        return doc?.text;
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.CompletionItem[] | null {
        const uri = document.uri.toString();
        const offset = document.offsetAt(position);
        const text = document.getText();

        // Detect if we're in a comparison context: identifier == "
        const context = detectComparisonContext(text, offset);
        if (!context) {
            return null;
        }

        // Get current document and project state
        const doc = this.model.documents.get().get(uri);
        const project = this.model.project.get();

        if (!doc) {
            return null;
        }

        // Find the fragment containing the identifier
        const fragment = doc.getFragmentAt(context.identifierOffset);
        if (!fragment) {
            return null;
        }

        try {
            // Resolve the fragment
            const resolved = project.resolve(doc, fragment);
            const service = getLanguageServiceForInstructions(resolved.instructions);

            // Get the mapped offset for the identifier in the resolved document
            const identifierDocOffset = new DocumentOffset(uri, context.identifierOffset);
            const virtualOffset = resolved.sourceMap.fromDocumentOffset(identifierDocOffset, true);

            if (virtualOffset === undefined) {
                return null;
            }

            // Use getRelatedElements to find the column definition
            const relatedInfo = service.getRelatedElements(resolved.virtualText, virtualOffset);
            if (!relatedInfo) {
                return null;
            }

            // Look for a declaration element
            const declaration = relatedInfo.elements.find(el => el.kind === 'declaration');
            if (!declaration) {
                return null;
            }

            // Map the declaration back to source and extract documentation
            const declLocation = resolved.sourceMap.toDocumentOffset(declaration.start);
            if (!declLocation) {
                return null;
            }

            const sourceText = this._getSourceText(declLocation.uri);
            if (!sourceText) {
                return null;
            }

            // Extract documentation from the declaration site
            const documentation = extractDocumentation(sourceText, declLocation.offset);
            if (!documentation) {
                return null;
            }

            // Extract enum variants from the documentation
            const variants = extractEnumVariants(documentation);
            if (!variants || variants.length === 0) {
                return null;
            }

            // Filter by typed prefix
            const prefix = context.typedPrefix.toLowerCase();
            const filteredVariants = variants.filter(v =>
                v.value.toLowerCase().startsWith(prefix)
            );

            // Create completion items
            return filteredVariants.map((variant, i) => {
                const item = new vscode.CompletionItem(variant.value, vscode.CompletionItemKind.EnumMember);

                // Insert just the value - user already typed the opening quote
                item.insertText = variant.value;

                // Replace from after the opening quote to cursor position
                const startPos = document.positionAt(context.valueOffset);
                item.range = new vscode.Range(startPos, position);

                // Sort by order in enum definition
                item.sortText = String(i).padStart(4, '0');

                // Detail shows the description inline in completion list
                item.detail = variant.description;

                // Documentation panel shows column info and full description
                const docParts = [`From column \`${context.identifier}\``];
                if (variant.description) {
                    docParts.push('', variant.description);
                }
                item.documentation = new vscode.MarkdownString(docParts.join('\n'));

                return item;
            });
        } catch (e) {
            console.error('EnumCompletionProvider: Error getting completions:', e);
            return null;
        }
    }
}

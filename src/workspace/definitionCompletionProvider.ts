import * as vscode from 'vscode';
import { Disposable } from '../utils/disposables';
import { MutableProject } from '../language/workspace/mutableProject';

/**
 * Provides completions for $-prefixed definitions.
 * Triggers when the user types '$' or '.' (for nested names like $events.debug.xxx).
 * This is isolated from the main Kusto completion provider for easier iteration.
 */
export class DefinitionCompletionProvider extends Disposable implements vscode.CompletionItemProvider {
    constructor(private readonly model: MutableProject) {
        super();

        // Register completion provider with '$' and '.' as trigger characters
        // '.' is needed for nested names like $events.debug.xxx
        this._register(vscode.languages.registerCompletionItemProvider(
            [{ language: 'kusto' }, { pattern: '**/*.kql' }, { pattern: '**/*.csl' }],
            this,
            '$', '.' // trigger on $ and . characters
        ));
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        const startTime = performance.now();

        // Find the $ prefix start position
        const lineText = document.lineAt(position).text;
        const textBeforeCursor = lineText.substring(0, position.character);
        const dollarMatch = textBeforeCursor.match(/\$([a-zA-Z0-9_.]*)?$/);

        if (!dollarMatch) {
            return [];
        }

        const uri = document.uri.toString();
        const offset = document.offsetAt(position);

        const docStartTime = performance.now();
        const currentDoc = this.model.documents.get().get(uri);
        const project = this.model.project.get();
        const docTime = performance.now() - docStartTime;

        if (!currentDoc) {
            return [];
        }

        try {
            // Get all global definitions with full info from the project
            const globalStartTime = performance.now();
            const definitionInfos = project.getDefinitionInfos();
            const globalTime = performance.now() - globalStartTime;

            // Get local definitions visible from this position (includes chapter-local)
            const localStartTime = performance.now();
            const localDefs = currentDoc.getVisibleDefinitions(offset);
            const localTime = performance.now() - localStartTime;

            // Merge definitions (local takes precedence)
            const allDefs = new Map<string, { source: string; isLocal: boolean }>(); // name -> source info

            for (const [name, _info] of definitionInfos) {
                allDefs.set(name, { source: 'definition', isLocal: false });
            }

            for (const [name, _fragment] of localDefs) {
                allDefs.set(name, { source: 'local definition', isLocal: true });
            }

            // The partial text including $ that's already been typed
            const typedPrefix = '$' + (dollarMatch[1] || '');
            const partialText = dollarMatch[1] || '';

            // Create completion items
            const items: vscode.CompletionItem[] = [];

            for (const [name, { source, isLocal }] of allDefs) {
                // The definition name starts with $
                if (!name.startsWith('$')) {
                    continue;
                }

                // Only suggest names that start with what's been typed
                if (!name.startsWith(typedPrefix)) {
                    continue;
                }

                // The label shows the full name including $
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);

                // Get definition info for documentation
                const defInfo = definitionInfos.get(name);

                // Description showing where it comes from
                item.detail = isLocal ? '(local definition)' : '(definition)';

                // Add documentation if available
                if (defInfo?.documentation) {
                    item.documentation = new vscode.MarkdownString(defInfo.documentation);
                }

                // Calculate the range to replace - from the $ to current cursor
                const dollarStartCol = position.character - (partialText.length + 1); // +1 for $
                const replaceRange = new vscode.Range(
                    position.line, dollarStartCol,
                    position.line, position.character
                );

                // Insert the full name including $
                item.insertText = name;
                item.range = replaceRange;

                // Filter text helps VS Code match what the user types
                item.filterText = name;

                // Sort definitions before other completions
                item.sortText = `0_${name}`;

                items.push(item);
            }

            const totalTime = performance.now() - startTime;
            if (totalTime > 50) {
                console.log(`[DefCompletions] Slow: ${totalTime.toFixed(0)}ms (docs: ${docTime.toFixed(0)}ms, global: ${globalTime.toFixed(0)}ms, local: ${localTime.toFixed(0)}ms) - ${items.length} matches for "${typedPrefix}"`);
            }

            return items;
        } catch (e) {
            console.error('DefinitionCompletionProvider: Error getting completions:', e);
            return [];
        }
    }
}

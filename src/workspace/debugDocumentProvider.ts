import * as vscode from 'vscode';
import { autorun, observableValue, ISettableObservable } from '@vscode/observables';
import { Disposable } from '../utils/disposables';
import { MutableProject } from '../language/workspace/mutableProject';
import { AkustoDocument } from '../language/akusto/akustoDocument';
import { DocumentOffset } from '../language/common/documentOffset';
import { ResolvedDocumentAdapter } from '../language/akusto/resolvedDocumentAdapter';
import { getLanguageServiceForInstructions } from './languageServiceResolver';

const DEBUG_SCHEME = 'kusto-debug';

/**
 * Provides a virtual document showing debug information:
 * - AST at cursor position
 * - Resolved Kusto document with cursor position marker
 */
export class DebugDocumentProvider extends Disposable implements vscode.TextDocumentContentProvider {
    private readonly _onDidChange = this._register(new vscode.EventEmitter<vscode.Uri>());
    readonly onDidChange = this._onDidChange.event;

    /** Observable tracking the active source document URI */
    private readonly _activeUri: ISettableObservable<string | undefined>;
    /** Observable tracking the cursor offset in the active document */
    private readonly _activeOffset: ISettableObservable<number>;

    constructor(private readonly project: MutableProject) {
        super();

        // Initialize observables
        this._activeUri = observableValue('DebugDocumentProvider.activeUri', undefined);
        this._activeOffset = observableValue('DebugDocumentProvider.activeOffset', 0);

        // Register content provider
        this._register(vscode.workspace.registerTextDocumentContentProvider(DEBUG_SCHEME, this));

        // Register command
        this._register(vscode.commands.registerCommand('kusto.debug.showAstAndResolved', () => this._showDebugDocument()));

        // Listen to selection changes in the debug document's source
        this._register(vscode.window.onDidChangeTextEditorSelection(e => {
            const activeUri = this._activeUri.get();
            if (activeUri && this._normalizeUri(e.textEditor.document.uri.toString()) === activeUri) {
                const newOffset = e.textEditor.document.offsetAt(e.selections[0].active);
                if (newOffset !== this._activeOffset.get()) {
                    this._activeOffset.set(newOffset, undefined, undefined);
                }
            }
        }));

        // Listen to document changes
        this._register(vscode.workspace.onDidChangeTextDocument(e => {
            const activeUri = this._activeUri.get();
            if (activeUri && this._normalizeUri(e.document.uri.toString()) === activeUri) {
                // Document content changed, trigger refresh
                this._onDidChange.fire(this._createDebugUri());
            }
        }));

        // Auto-refresh when project or cursor state changes
        this._register(autorun(reader => {
            /** @description Update debug document when project or cursor changes */
            this.project.project.read(reader);
            this._activeUri.read(reader);
            this._activeOffset.read(reader);
            this._onDidChange.fire(this._createDebugUri());
        }));
    }

    provideTextDocumentContent(_uri: vscode.Uri): string {
        // Read current state from observables
        const sourceUri = this._activeUri.get();
        const offset = this._activeOffset.get();

        if (!sourceUri) {
            return '# Kusto Debug View\n\n⚠️ No active Kusto document. Run the command from a .kql file.';
        }

        return this._generateDebugContent(sourceUri, offset);
    }

    private _showDebugDocument(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'kusto') {
            vscode.window.showWarningMessage('Please open a Kusto document first');
            return;
        }

        const normalizedUri = this._normalizeUri(editor.document.uri.toString());
        this._activeUri.set(normalizedUri, undefined, undefined);
        this._activeOffset.set(editor.document.offsetAt(editor.selection.active), undefined, undefined);

        const debugUri = this._createDebugUri();
        vscode.workspace.openTextDocument(debugUri).then(doc => {
            vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: true,
                preview: false,
            });
        });
    }

    private _createDebugUri(): vscode.Uri {
        return vscode.Uri.parse(`${DEBUG_SCHEME}:AST and Resolved Document.md`);
    }

    /** Normalize URI to match the format used in MutableProject */
    private _normalizeUri(uri: string): string {
        return uri.replace(/\\/g, '/');
    }

    /** Find document in project, handling potential case differences on Windows */
    private _findDocument(project: import('../language/akusto/akustoProject').AkustoProject, uri: string): AkustoDocument | undefined {
        // Try exact match first
        const exact = project.documents.get(uri);
        if (exact) {
            return exact;
        }
        // On Windows, try case-insensitive match
        const lowerUri = uri.toLowerCase();
        for (const [docUri, doc] of project.documents) {
            if (docUri.toLowerCase() === lowerUri) {
                return doc;
            }
        }
        return undefined;
    }

    private _generateDebugContent(sourceUriStr: string, offset: number): string {
        const lines: string[] = [];
        const project = this.project.project.get();
        const doc = this._findDocument(project, sourceUriStr);

        lines.push('# Kusto Debug View\n');
        lines.push(`**Source URI:** \`${sourceUriStr}\`\n`);
        lines.push(`**Cursor Offset:** ${offset}\n`);

        // Debug: show available documents
        const availableDocs = Array.from(project.documents.keys());
        lines.push(`**Available Documents:** ${availableDocs.length}\n`);
        for (const docUri of availableDocs) {
            const isMatch = docUri === sourceUriStr;
            lines.push(`- \`${docUri}\`${isMatch ? ' ✅' : ''}\n`);
        }

        if (!doc) {
            lines.push('\n## ⚠️ Document not found in project\n');
            lines.push('\nThe document may not be loaded yet. Try saving the file or re-opening it.\n');
            return lines.join('\n');
        }

        // Get position information
        const vscodeDoc = vscode.workspace.textDocuments.find(d =>
            this._normalizeUri(d.uri.toString()) === sourceUriStr
        );
        if (vscodeDoc) {
            const pos = vscodeDoc.positionAt(offset);
            lines.push(`**Cursor Position:** Line ${pos.line + 1}, Column ${pos.character + 1}\n`);
        }

        // Find AST node at cursor
        lines.push('\n---\n');
        lines.push('## AST at Cursor\n');
        lines.push(this._generateAstSection(doc, offset));

        // Find fragment at cursor
        const fragment = doc.getFragmentAt(offset);
        if (!fragment) {
            lines.push('\n---\n');
            lines.push('## ⚠️ No fragment at cursor position\n');
            lines.push('The cursor is not within a code fragment (might be in whitespace, comment, or instruction).\n');
            return lines.join('\n');
        }

        lines.push('\n---\n');
        lines.push('## Fragment at Cursor\n');
        lines.push(`**Range:** ${fragment.range.start} - ${fragment.range.endExclusive}\n`);
        if (fragment.exportedName) {
            lines.push(`**Exported Name:** \`${fragment.exportedName}\`\n`);
        }
        if (fragment.referencedNames.length > 0) {
            lines.push(`**Referenced Names:** ${fragment.referencedNames.map(n => `\`${n}\``).join(', ')}\n`);
        }
        lines.push('\n```kusto\n');
        lines.push(fragment.text);
        lines.push('\n```\n');

        // Resolve the document
        lines.push('\n---\n');
        lines.push('## Resolved Kusto Document\n');
        try {
            const resolved = project.resolve(doc, fragment);

            // Find the actual URI used in the source map for this document
            const actualSourceUri = resolved.sourceMap.segments.find(s =>
                s.sourceUri.toLowerCase() === sourceUriStr.toLowerCase()
            )?.sourceUri ?? sourceUriStr;

            const docOffset = new DocumentOffset(actualSourceUri, offset);
            const virtualOffset = resolved.sourceMap.fromDocumentOffset(docOffset, true);

            lines.push(`**Virtual Text Length:** ${resolved.virtualText.length}\n`);
            if (virtualOffset !== undefined) {
                lines.push(`**Mapped Virtual Offset:** ${virtualOffset}\n`);

                // Show position info in virtual document
                const virtualLines = resolved.virtualText.split('\n');
                let charCount = 0;
                let virtualLine = 0;
                let virtualColumn = 0;
                for (let i = 0; i < virtualLines.length; i++) {
                    if (charCount + virtualLines[i].length >= virtualOffset) {
                        virtualLine = i;
                        virtualColumn = virtualOffset - charCount;
                        break;
                    }
                    charCount += virtualLines[i].length + 1; // +1 for newline
                }
                lines.push(`**Virtual Position:** Line ${virtualLine + 1}, Column ${virtualColumn + 1}\n`);
            } else {
                lines.push('**⚠️ Could not map cursor to virtual document**\n');
            }

            if (resolved.instructions.length > 0) {
                lines.push(`\n**Instructions:** ${resolved.instructions.length}\n`);
                for (const instr of resolved.instructions) {
                    lines.push(`- \`${instr.type}\`: ${JSON.stringify(instr.value)}\n`);
                }
            }

            // Show the virtual text with cursor marker
            lines.push('\n### Virtual Document Text\n');
            if (virtualOffset !== undefined) {
                lines.push('(📍 marks cursor position)\n');
                lines.push('\n```kusto\n');
                // Insert cursor marker at the virtual offset
                const before = resolved.virtualText.substring(0, virtualOffset);
                const after = resolved.virtualText.substring(virtualOffset);
                lines.push(before + '📍' + after);
                lines.push('\n```\n');
            } else {
                lines.push('\n```kusto\n');
                lines.push(resolved.virtualText);
                lines.push('\n```\n');
            }

            // Show source map segments
            lines.push('\n---\n');
            lines.push('## Source Map Segments\n');
            lines.push('| Virtual Range | Source URI | Source Range |\n');
            lines.push('|--------------|------------|---------------|\n');
            for (const segment of resolved.sourceMap.segments) {
                const vRange = `${segment.virtualRange.start}-${segment.virtualRange.endExclusive}`;
                const sourceFile = segment.sourceUri.split('/').pop() || segment.sourceUri;
                const sRange = `${segment.sourceRange.start}-${segment.sourceRange.endExclusive}`;
                const isCurrentSegment = virtualOffset !== undefined &&
                    segment.virtualRange.contains(virtualOffset);
                const marker = isCurrentSegment ? ' 👈' : '';
                lines.push(`| ${vRange} | ${sourceFile} | ${sRange}${marker} |\n`);
            }

            // Go to Definition / Related Elements
            lines.push('\n---\n');
            lines.push('## Go to Definition (Related Elements)\n');
            try {
                const service = getLanguageServiceForInstructions(resolved.instructions);
                const adapter = new ResolvedDocumentAdapter(resolved, service);
                const relatedInfo = adapter.getRelatedElements(docOffset);

                if (!relatedInfo || relatedInfo.elements.length === 0) {
                    lines.push('\n**No related elements found at cursor position**\n');
                    lines.push('(This means Go to Definition won\'t work here)\n');
                } else {
                    lines.push(`\n**Current Index:** ${relatedInfo.currentIndex}\n`);
                    lines.push(`**Total Elements:** ${relatedInfo.elements.length}\n`);
                    lines.push('\n| # | Kind | URI | Offset | Length |\n');
                    lines.push('|---|------|-----|--------|--------|\n');
                    for (let i = 0; i < relatedInfo.elements.length; i++) {
                        const el = relatedInfo.elements[i];
                        const marker = i === relatedInfo.currentIndex ? ' 👈' : '';
                        const fileName = el.location.uri.split('/').pop() || el.location.uri;
                        lines.push(`| ${i}${marker} | ${el.kind} | ${fileName} | ${el.location.offset} | ${el.length} |\n`);
                    }

                    // Highlight declarations
                    const declarations = relatedInfo.elements.filter(e => e.kind === 'declaration');
                    if (declarations.length > 0) {
                        lines.push('\n### Declarations Found\n');
                        for (const decl of declarations) {
                            lines.push(`- **${decl.location.uri.split('/').pop()}** at offset ${decl.location.offset}\n`);
                        }
                    } else {
                        lines.push('\n**⚠️ No declarations found** (Go to Definition will return null)\n');
                    }
                }
            } catch (e) {
                lines.push(`\n### ❌ Error getting related elements\n`);
                lines.push(`\`\`\`\n${e}\n\`\`\`\n`);
            }
        } catch (e) {
            lines.push(`\n### ❌ Resolution Error\n`);
            lines.push(`\`\`\`\n${e}\n\`\`\`\n`);
        }

        // Full AST dump
        lines.push('\n---\n');
        lines.push('## Full Document AST\n');
        lines.push('\n```\n');
        lines.push(doc.ast.dump());
        lines.push('\n```\n');

        return lines.join('\n');
    }

    private _generateAstSection(doc: AkustoDocument, offset: number): string {
        const lines: string[] = [];
        const node = doc.ast.findNodeAt(offset);

        if (!node) {
            lines.push('**No AST node found at cursor position**\n');
            return lines.join('\n');
        }

        lines.push(`**Node Type:** \`${node.constructor.name}\`\n`);
        lines.push(`**Node Range:** ${node.range.start} - ${node.range.endExclusive}\n`);

        lines.push('\n### Node Details\n');
        lines.push('\n```\n');
        lines.push(node.dump());
        lines.push('\n```\n');

        // Check if we're inside a chapter
        const chapter = doc.ast.findChapterAt(offset);
        if (chapter) {
            lines.push(`\n**Inside Chapter:** \`${chapter.title}\`\n`);
            lines.push(`**Chapter Range:** ${chapter.range.start} - ${chapter.range.endExclusive}\n`);
        }

        // Check for instruction at cursor
        const instruction = doc.ast.findInstructionAt(offset);
        if (instruction) {
            lines.push(`\n**At Instruction:** \`:${instruction.expression}\`\n`);
        }

        return lines.join('\n');
    }
}

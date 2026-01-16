import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { autorun } from '@vscode/observables';
import { Disposable } from '../utils/disposables';
import {
    QueryHistoryModel,
    QueryExecution,
    getExecutionFullData,
} from './queryHistoryModel';

/**
 * Content provider for readonly ejected JSON documents.
 */
class EjectedJsonContentProvider implements vscode.TextDocumentContentProvider {
    private _content = '';
    private _onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChangeEmitter.event;

    provideTextDocumentContent(_uri: vscode.Uri): string {
        return this._content;
    }

    update(uri: vscode.Uri, content: string) {
        this._content = content;
        this._onDidChangeEmitter.fire(uri);
    }

    dispose() {
        this._onDidChangeEmitter.dispose();
    }
}

/**
 * Provider for the Kusto Results webview panel in the bottom panel area.
 * 
 * This is a pure view - it just displays the query history model.
 * Query execution is handled by QueryService.
 */
export class ResultsViewProvider extends Disposable implements vscode.WebviewViewProvider {
    public static readonly viewType = 'kusto.resultsView';
    public static readonly ejectedScheme = 'kusto-json';

    private _view?: vscode.WebviewView;
    private readonly _devServerUrl: string | undefined;
    private _ejectedUri?: vscode.Uri;
    private _ejectedContentProvider: EjectedJsonContentProvider;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _historyModel: QueryHistoryModel
    ) {
        super();
        // Use dev server URL from environment variable if set
        this._devServerUrl = process.env.KUSTO_VIEW_DEV_SERVER_URL;
        if (this._devServerUrl) {
            console.log(`Kusto Results: Using dev server at ${this._devServerUrl}`);
        }

        // Register content provider for readonly ejected documents
        this._ejectedContentProvider = new EjectedJsonContentProvider();
        this._register(vscode.workspace.registerTextDocumentContentProvider(
            ResultsViewProvider.ejectedScheme,
            this._ejectedContentProvider
        ));

        // Listen for editor close events
        this._register(vscode.window.onDidChangeVisibleTextEditors(editors => {
            if (this._ejectedUri && !editors.some(e => e.document.uri.toString() === this._ejectedUri?.toString())) {
                this._ejectedUri = undefined;
                this._view?.webview.postMessage({ type: 'ejectedEditorClosed' });
            }
        }));

        // Sync history state to webview using autorun
        const disposable = autorun(reader => {
            const executions = this._historyModel.executions.read(reader);
            const selectedId = this._historyModel.selectedId.read(reader);
            this._syncHistoryToWebview(executions, selectedId);
        });
        this._register({ dispose: () => disposable.dispose() });

        // Also sync when individual execution outcomes change
        this._historyModel.setOnExecutionChanged(() => {
            const executions = this._historyModel.executions.get();
            const selectedId = this._historyModel.selectedId.get();
            this._syncHistoryToWebview(executions, selectedId);
        });
    }

    private _syncHistoryToWebview(executions: readonly QueryExecution[], selectedId: string | null): void {
        if (!this._view) return;

        // Use the model's serialization which gives lightweight data
        const state = this._historyModel.getSerializedState();

        this._view.webview.postMessage({
            type: 'historySync',
            data: state
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview'),
            ],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Send initial history state
        const executions = this._historyModel.executions.get();
        const selectedId = this._historyModel.selectedId.get();
        this._syncHistoryToWebview(executions, selectedId);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            async message => {
                if (message.type === 'cancel') {
                    // Cancel the execution directly
                    const execution = this._historyModel.getExecution(message.queryId);
                    execution?.cancel();
                } else if (message.type === 'ejectToEditor') {
                    await this._openEjectedEditor(message.json);
                } else if (message.type === 'updateEjectedEditor') {
                    await this._updateEjectedEditor(message.json);
                } else if (message.type === 'selectHistoryItem') {
                    this._historyModel.setSelectedId(message.id);
                } else if (message.type === 'deleteHistoryItem') {
                    this._historyModel.deleteExecution(message.id);
                } else if (message.type === 'clearHistory') {
                    this._historyModel.clearAll();
                } else if (message.type === 'requestFullData') {
                    // Request full result data for a specific execution
                    const execution = this._historyModel.getExecution(message.id);
                    if (execution) {
                        const fullData = getExecutionFullData(execution);
                        this._view?.webview.postMessage({
                            type: 'fullData',
                            id: message.id,
                            data: fullData,
                        });
                    }
                }
            },
            null,
            (this as unknown as { _disposables: vscode.Disposable[] })._disposables || [],
        );
    }

    private async _openEjectedEditor(json: string) {
        // Create a unique URI for this ejected document
        this._ejectedUri = vscode.Uri.parse(`${ResultsViewProvider.ejectedScheme}:Kusto Selection.json`);
        this._ejectedContentProvider.update(this._ejectedUri, json);

        const doc = await vscode.workspace.openTextDocument(this._ejectedUri);
        await vscode.languages.setTextDocumentLanguage(doc, 'json');
        await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: true,
            preserveFocus: true,
        });
    }

    private async _updateEjectedEditor(json: string) {
        if (!this._ejectedUri) return;
        this._ejectedContentProvider.update(this._ejectedUri, json);
    }

    /**
     * Reveal the results panel
     */
    public reveal(): void {
        if (this._view) {
            this._view.show?.(true);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        // In dev mode, load from Vite dev server for hot reload
        if (this._devServerUrl) {
            return this._getDevHtml();
        }

        // Production: load from bundled files
        return this._getProductionHtml(webview);
    }

    private _getDevHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kusto Results</title>
</head>
<body>
    <div id="root"></div>
    <script type="module">
        import RefreshRuntime from '${this._devServerUrl}/@react-refresh'
        RefreshRuntime.injectIntoGlobalHook(window)
        window.$RefreshReg$ = () => {}
        window.$RefreshSig$ = () => (type) => type
        window.__vite_plugin_react_preamble_installed__ = true
    </script>
    <script type="module" src="${this._devServerUrl}/src/main.tsx"></script>
</body>
</html>`;
    }

    private _getProductionHtml(webview: vscode.Webview): string {
        // Get paths to built webview assets
        const distPath = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview');

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(distPath, 'index.js')
        );

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(distPath, 'index.css')
        );

        // Check if CSS file exists (Vite might not generate it if all CSS is in JS)
        const cssExists = fs.existsSync(path.join(distPath.fsPath, 'index.css'));

        // Generate nonce for CSP
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
    ${cssExists ? `<link href="${styleUri}" rel="stylesheet">` : ''}
    <title>Kusto Results</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

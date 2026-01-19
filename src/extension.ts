import '@kusto/language-service-next/bridge.js';
import { ExtensionContext, window } from "vscode";
import { Disposable } from "./utils/disposables";
import {
    VsCodeWatchableFileSystem,
    DiagnosticsProvider,
    CompletionProvider,
    DefinitionCompletionProvider,
    EnumCompletionProvider,
    DefinitionProvider,
    HoverProvider,
    CodeLensProvider,
    QueryRunner,
    DebugDocumentProvider,
    SemanticTokensProvider,
    ResultsViewProvider,
    RunQueryTool,
    QueryHistoryModel,
} from "./workspace";
import { MutableProject } from "./language/workspace/mutableProject";


export class Extension extends Disposable {
    private readonly fileSystem: VsCodeWatchableFileSystem;
    private readonly project: MutableProject;
    private readonly historyModel: QueryHistoryModel;

    constructor(context: ExtensionContext) {
        super();

        // Create the VS Code file system (tracks open documents + file changes)
        this.fileSystem = new VsCodeWatchableFileSystem();
        this._register(this.fileSystem);

        // Create the project model (observable-based, uses file system for watching)
        this.project = new MutableProject(this.fileSystem);
        this._register(this.project);

        // Create the query history model
        this.historyModel = new QueryHistoryModel();

        // Auto-add root documents when Kusto files are opened
        this._register(this.fileSystem.onDidOpenKustoDocument(doc => {
            this.project.addRoot(doc.uri.toString());
        }));

        this._register(this.fileSystem.onDidCloseKustoDocument(doc => {
            this.project.removeRoot(doc.uri.toString());
        }));

        // Initialize with already-open Kusto documents
        for (const doc of this.fileSystem.getOpenKustoDocuments()) {
            this.project.addRoot(doc.uri.toString());
        }

        // Create results view provider for webview panel
        const resultsProvider = new ResultsViewProvider(context.extensionUri, this.historyModel);
        this._register(resultsProvider);
        this._register(
            window.registerWebviewViewProvider(ResultsViewProvider.viewType, resultsProvider)
        );

        // Create query runner and connect to results provider and history model
        const queryRunner = new QueryRunner(this.project);
        queryRunner.setResultsProvider(resultsProvider);
        queryRunner.setHistoryModel(this.historyModel);
        this._register(queryRunner);

        // Create chat tool for running queries from AI
        const runQueryTool = new RunQueryTool(this.project);
        runQueryTool.setResultsProvider(resultsProvider);
        runQueryTool.setHistoryModel(this.historyModel);
        this._register(runQueryTool);

        // Register providers (they use autorun for reactive updates)
        this._register(new DiagnosticsProvider(this.project));
        this._register(new CompletionProvider(this.project));
        this._register(new DefinitionCompletionProvider(this.project));
        this._register(new EnumCompletionProvider(this.project));
        this._register(new DefinitionProvider(this.project));
        this._register(new HoverProvider(this.project));
        this._register(new CodeLensProvider(this.project));
        this._register(new DebugDocumentProvider(this.project));
        this._register(new SemanticTokensProvider(this.project));
    }
}

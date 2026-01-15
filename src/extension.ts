import { ExtensionContext } from "vscode";
import { Disposable } from "./utils/disposables";
import {
    VsCodeWatchableFileSystem,
    DiagnosticsProvider,
    CompletionProvider,
    HoverProvider,
    CodeLensProvider,
    QueryRunner,
} from "./workspace";
import { MutableProject } from "./language/workspace/mutableProject";

export class Extension extends Disposable {
    private readonly fileSystem: VsCodeWatchableFileSystem;
    private readonly project: MutableProject;

    constructor(context: ExtensionContext) {
        super();

        // Create the VS Code file system (tracks open documents + file changes)
        this.fileSystem = new VsCodeWatchableFileSystem();
        this._register(this.fileSystem);

        // Create the project model (observable-based, uses file system for watching)
        this.project = new MutableProject(this.fileSystem);
        this._register(this.project);

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

        // Register providers (they use autorun for reactive updates)
        this._register(new DiagnosticsProvider(this.project));
        this._register(new CompletionProvider(this.project));
        this._register(new HoverProvider(this.project));
        this._register(new CodeLensProvider(this.project));
        this._register(new QueryRunner(this.project));
    }
}

import { ExtensionContext } from "vscode";
import { Disposable } from "./utils/disposables";
import { KustoLanguageServicePoc } from "./KustoLanguageServicePoc";

export class Extension extends Disposable {

    constructor(context: ExtensionContext) {
        super();

        // Initialize the Kusto Language Service POC
        this._register(new KustoLanguageServicePoc());
    }
}

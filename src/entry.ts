import { ExtensionContext } from "vscode";
import { Extension } from "./extension";

export function activate(context: ExtensionContext) {
    context.subscriptions.push(new Extension(context));
}

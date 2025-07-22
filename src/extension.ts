import * as vscode from "vscode";
import { registerOpenWebviewCommand } from "./commands/openWebview";
import { registerViewTasksCommand } from "./commands/viewTasks";
import { registerViewBacklogsCommand } from "./commands/viewBacklogs";

export function activate(context: vscode.ExtensionContext) {
  registerOpenWebviewCommand(context);
  registerViewTasksCommand(context);
  registerViewBacklogsCommand(context);
}

// this method is called when your extension is deactivated
export function deactivate() {}


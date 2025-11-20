import * as vscode from 'vscode';

export function registerShowSprintCalendarCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.showSprintCalendar', async (item: any) => {
      const filePath = item?.filePath;
      if (!filePath) {
        vscode.window.showErrorMessage('Sprint file not found for this item.');
        return;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
        const text = Buffer.from(bytes).toString('utf8');
        const iso = /(\d{4})-(\d{2})-(\d{2})/g;
        const dmy = /(\d{2})-(\d{2})-(\d{4})/g;
        const dates: Date[] = [];
        let m: RegExpExecArray | null;
        while ((m = iso.exec(text)) && dates.length < 2) {
          dates.push(new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
        }
        if (dates.length < 2) {
          while ((m = dmy.exec(text)) && dates.length < 2) {
            dates.push(new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10)));
          }
        }
        if (dates.length < 2) {
          vscode.window.showInformationMessage('No sprint date range found in sprint file.');
          return;
        }
        const [start, end] = dates[0] <= dates[1] ? [dates[0], dates[1]] : [dates[1], dates[0]];
        const days: string[] = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yyyy = d.getFullYear();
          days.push(`${dd}-${mm}-${yyyy}`);
        }
        await vscode.window.showQuickPick(days, {
          title: 'Sprint Days',
          canPickMany: false
        });
      } catch (e) {
        vscode.window.showErrorMessage('Failed to read sprint file dates.');
      }
    })
  );
}

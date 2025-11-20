let vscodeApi: any;

export function acquireVsCodeApiOnce(): any {
  if (!vscodeApi) {
    // This function is injected by VS Code
    if (typeof (window as any).acquireVsCodeApi === "function") {
      vscodeApi = (window as any).acquireVsCodeApi();
    } else {
      // Mock for dev server
      vscodeApi = {
        postMessage: (msg: any) => {
          
        },
      };
    }
  }
  return vscodeApi;
}
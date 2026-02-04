import { contextBridge, ipcRenderer } from "electron";

// Expose safe APIs to renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  // Platform detection
  platform: process.platform,
  isElectron: true,

  // Native dialogs
  dialog: {
    selectDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:selectDirectory"),

    selectFile: (
      filters?: Array<{ name: string; extensions: string[] }>
    ): Promise<string | null> =>
      ipcRenderer.invoke("dialog:selectFile", filters),

    showMessage: (options: {
      type: string;
      message: string;
      detail?: string;
    }): Promise<{ response: number }> =>
      ipcRenderer.invoke("dialog:showMessage", options),
  },

  // Shell operations
  shell: {
    openExternal: (url: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("shell:openExternal", url),

    showItemInFolder: (path: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("shell:showItemInFolder", path),
  },

  // App info
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke("app:getVersion"),

    getPath: (name: string): Promise<string> =>
      ipcRenderer.invoke("app:getPath", name),
  },
});

// Type declarations for the exposed API
declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      isElectron: boolean;
      dialog: {
        selectDirectory: () => Promise<string | null>;
        selectFile: (
          filters?: Array<{ name: string; extensions: string[] }>
        ) => Promise<string | null>;
        showMessage: (options: {
          type: string;
          message: string;
          detail?: string;
        }) => Promise<{ response: number }>;
      };
      shell: {
        openExternal: (url: string) => Promise<{ success: boolean }>;
        showItemInFolder: (path: string) => Promise<{ success: boolean }>;
      };
      app: {
        getVersion: () => Promise<string>;
        getPath: (name: string) => Promise<string>;
      };
    };
  }
}

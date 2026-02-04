import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } from "electron";
import path from "path";
import { startNextServer } from "./next-server";
import { createMainWindow } from "./window";
import { createApplicationMenu } from "./menu";

// Load environment variables from .env file (for production)
if (app.isPackaged) {
  const envPath = path.join(process.resourcesPath, ".env");
  try {
    const fs = require("fs");
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf8");
      envContent.split("\n").forEach((line: string) => {
        const match = line.match(/^([^=:#]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim().replace(/^["']|["']$/g, "");
          process.env[key] = value;
        }
      });
      console.log("Loaded environment variables from .env");
    }
  } catch (error) {
    console.error("Failed to load .env file:", error);
  }
}

// Set app name immediately at module load
app.setName("Bud Studio");
process.title = "Bud Studio";

let mainWindow: BrowserWindow | null = null;

async function initialize(): Promise<void> {
  console.log("Initializing Bud Studio Desktop...");

  // Create application menu first (important for macOS menu bar name)
  createApplicationMenu();
  console.log("Application menu created");

  // Set dock icon on macOS
  if (process.platform === "darwin") {
    const iconPath = path.join(__dirname, "../../resources/icon.png");
    const icon = nativeImage.createFromPath(iconPath);
    app.dock.setIcon(icon);
    console.log(`Dock icon set from: ${iconPath}`);
  }

  // Start embedded Next.js server
  const port = await startNextServer();
  console.log(`Next.js server started on port ${port}`);

  // Re-create menu after Next.js starts (in case it was overridden)
  createApplicationMenu();
  console.log("Application menu re-created after Next.js start");

  // Register IPC handlers
  registerIPCHandlers();

  // Create main window
  mainWindow = createMainWindow(port);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIPCHandlers(): void {
  // Dialog: Select directory
  ipcMain.handle("dialog:selectDirectory", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
    });

    return result.canceled ? null : result.filePaths[0];
  });

  // Dialog: Select file
  ipcMain.handle(
    "dialog:selectFile",
    async (
      event,
      filters?: Array<{ name: string; extensions: string[] }>
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return null;

      const result = await dialog.showOpenDialog(win, {
        properties: ["openFile"],
        filters,
      });

      return result.canceled ? null : result.filePaths[0];
    }
  );

  // Dialog: Show message
  ipcMain.handle(
    "dialog:showMessage",
    async (
      event,
      options: { type: string; message: string; detail?: string }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return null;

      return dialog.showMessageBox(win, {
        type: options.type as "none" | "info" | "error" | "question" | "warning",
        message: options.message,
        detail: options.detail,
      });
    }
  );

  // Shell: Open external URL
  ipcMain.handle("shell:openExternal", async (_, url: string) => {
    await shell.openExternal(url);
    return { success: true };
  });

  // Shell: Show item in folder
  ipcMain.handle("shell:showItemInFolder", async (_, path: string) => {
    shell.showItemInFolder(path);
    return { success: true };
  });

  // App: Get version
  ipcMain.handle("app:getVersion", async () => {
    return app.getVersion();
  });

  // App: Get path
  ipcMain.handle("app:getPath", async (_, name: string) => {
    return app.getPath(
      name as
        | "home"
        | "appData"
        | "userData"
        | "temp"
        | "desktop"
        | "documents"
        | "downloads"
    );
  });
}

// App lifecycle
app.whenReady().then(initialize);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    initialize();
  }
});

// Handle certificate errors for local development
app.on(
  "certificate-error",
  (event, _webContents, _url, _error, _certificate, callback) => {
    // In development, ignore certificate errors for localhost
    if (process.env.NODE_ENV === "development") {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  }
);

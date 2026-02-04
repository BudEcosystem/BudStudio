import { BrowserWindow, shell, nativeImage } from "electron";
import path from "path";

export function createMainWindow(port: number): BrowserWindow {
  // Load the app icon
  const iconPath = path.join(__dirname, "../../resources/icon.png");
  const icon = nativeImage.createFromPath(iconPath);

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "Bud Studio",
    icon: icon,
    titleBarStyle: "hiddenInset", // macOS native feel
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Load the app
  const url = `http://127.0.0.1:${port}`;
  console.log(`Loading URL: ${url}`);
  win.loadURL(url);

  // Open DevTools in development
  if (process.env.NODE_ENV === "development") {
    win.webContents.openDevTools({ mode: "detach" });
  }

  // Helper function to check if URL is internal
  const isInternalUrl = (url: string): boolean => {
    return (
      url.startsWith(`http://127.0.0.1:${port}`) ||
      url.startsWith(`http://localhost:${port}`)
    );
  };

  // Handle external links - open in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Allow internal navigation (both localhost and 127.0.0.1)
    if (isInternalUrl(url)) {
      return { action: "allow" };
    }

    // Open external URLs in default browser
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Handle navigation to external URLs
  win.webContents.on("will-navigate", (event, url) => {
    if (!isInternalUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Override page title changes to maintain app name
  win.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  // Show window when ready
  win.once("ready-to-show", () => {
    win.show();
  });

  return win;
}

# Bud Studio Desktop App

Electron-based desktop application for Bud Studio that embeds the Next.js frontend.

## Prerequisites

1. Node.js 20+
2. Access to an Onyx backend (local or remote)

## Development

### Configuration

Create/edit `.env` file in the desktop directory:

```env
# Backend API URL (point to your Onyx backend)
INTERNAL_URL=https://chat.pnap.bud.studio

# Development mode
NODE_ENV=development
```

**Note**: The `.env` file is already created with default values pointing to the Bud Studio Kubernetes cluster.

### Quick Start

1. **Install dependencies** (first time only):
   ```bash
   npm install
   ```

2. **Configure backend URL** (if needed):
   Edit `.env` to point to your Onyx backend

3. **Run the desktop app** (starts both Next.js and Electron):
   ```bash
   npm run dev
   ```

   This will:
   - Load configuration from `.env`
   - Check if Next.js is already running on port 3000
   - If not, start the Next.js dev server from `../web` with proper backend URL
   - Wait for Next.js to be ready
   - Build the Electron TypeScript
   - Launch the Electron app

   Press `Ctrl+C` to stop both processes.

### Manual Mode

If you prefer to run Next.js separately:

1. **Start Next.js** (in another terminal):
   ```bash
   cd ../web
   npm run dev
   ```

2. **Run Electron only**:
   ```bash
   npm run build
   NODE_ENV=development npx electron .
   ```

### What to Expect

- The Electron window will open and load `http://127.0.0.1:3000`
- You should see the Onyx UI inside the desktop app
- DevTools will open automatically in development mode
- The `window.electronAPI` object will be available in the console

### Testing the Electron API

Open DevTools (Cmd+Option+I) and run:
```javascript
// Check if running in Electron
console.log('Is Electron:', window.electronAPI?.isElectron);

// Get platform
console.log('Platform:', window.electronAPI?.platform);

// Test native directory picker
window.electronAPI?.dialog.selectDirectory().then(console.log);
```

## Building for Distribution

1. **Build the Next.js standalone output**:
   ```bash
   cd ../web
   npm run build
   ```

2. **Package the desktop app**:
   ```bash
   npm run package:mac    # macOS
   npm run package:win    # Windows
   npm run package:linux  # Linux
   ```

   Output will be in the `release/` directory.

## Project Structure

```
desktop/
├── src/
│   ├── main/           # Electron main process
│   │   ├── index.ts    # App entry point & IPC handlers
│   │   ├── window.ts   # Window management
│   │   └── next-server.ts  # Next.js server embedding
│   └── preload/        # Context bridge for renderer
│       └── index.ts    # Exposes electronAPI to window
├── dist/               # Compiled JavaScript
├── release/            # Packaged app output
└── resources/          # App icons
```

## Current Limitations (POC)

- Development mode requires the web frontend running separately
- No agent tools implemented yet (filesystem, bash, etc.)
- No auto-update functionality
- Icons are placeholder (need real icons)

## Next Steps

After validating the POC:
1. Implement agent tools in `src/main/agent/`
2. Add agent UI components to the web frontend
3. Create proper app icons
4. Add auto-update support
5. Test cross-platform builds

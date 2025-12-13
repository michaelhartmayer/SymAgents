# SymAgents

A lightweight tool to automatically manage `AGENTS.md` symlinks across your project based on configuration patterns.

Ideally used to ensure that specific folders (like React Components) always have the latest context or instructions available via an `AGENTS.md` file, without duplicating content.

## Features

- **Watch Mode**: Automatically detects new directories matching your patterns and creates symlinks. Cleanly removes them on exit.
- **Run Once**: Perform a one-time scan and link operation.
- **Remove**: Remove all symlinks created by the tool.
- **Global & Distributed Configs**: Support for a global configuration in `.agents` or distributed `agents.config.json` files.

## Installation

```bash
npm install @michaelhartmayer/sym-agents
```

## Configuration

Create a `agents.config.json` (or `.js`, `.yml`) in your project root, `.agents/` directory, or any subfolder.

```json
{
  "include": [
    "**/components/[A-Z]*"
  ],
  "exclude": [
    "**/node_modules/**"
  ],
  "agentFile": "./AGENTS.md"
}
```

- `include`: Array of glob patterns to match directories where `AGENTS.md` should be linked.
- `exclude`: Array of glob patterns to exclude.
- `agentFile`: Path to the `AGENTS.md` file (relative to config file location). Defaults to `AGENTS.md` in the same directory as the config.

## Quick Start Workflow

Here is a common pattern to strictly prescribe `AGENTS.md` context to specific folder types (e.g., React Components):

1. **Create a global agents folder**:
   ```bash
   mkdir .agents
   ```

2. **Create a context-specific folder**:
   ```bash
   mkdir .agents/react-components
   ```

3. **Add a config file**:
   Create `.agents/react-components/agents.config.json`:
   ```json
   {
     "include": [
       "**/components/[A-Z]*",
       "**/components/**/[A-Z]*" // Matches PascalCase folders deep in components
     ],
     "exclude": [
       "**/node_modules/**",
       "**/dist/**",
       "**/.git/**"
     ]
   }
   ```

4. **Add your Context**:
   Create `.agents/react-components/AGENTS.md` with your specific instructions.

5. **Run the watcher**:
   ```bash
   npx sym-agents
   ```

Now, any time you (or your agent) create a new folder matching the pattern (e.g. `src/components/MyNewComponent`), the `AGENTS.md` will be automatically symlinked into it. Stopping the process removes the symlinks.

## Usage

### CLI

```bash
# Watch mode (default)
npx sym-agents

# Run once
npx sym-agents --once

# Remove symlinks
npx sym-agents --remove
```

### NPM Machine

You can add it to your `package.json` scripts:

```json
{
  "scripts": {
    "agents": "sym-agents",
    "agents:once": "sym-agents --once",
    "agents:remove": "sym-agents --remove"
  }
}
```

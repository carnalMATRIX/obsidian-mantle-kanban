# Mantle Kanban

> [!CAUTION]
> **Status: Beta (v1.0.0)**  
> This plugin is currently in Alpha. Features and UI are subject to change.

Mantle Kanban is a professional-grade Kanban board for Obsidian. It provides a highly visual and interactive way to organize projects, track progress across different stages, and manage tasks with drag-and-drop simplicity.

## Features
- **Visual Task Management**: Drag and drop cards between columns to update status.
- **Rich Card Previews**: See Markdown content, links, and metadata directly on the cards.
- **Interactive Background**: Features a unique, interactive dot-pattern background that reacts to mouse movement.
- **Zenith Optimized**: Deeply integrated with the [Zenith theme](https://github.com/carnalMATRIX/obsidian-mantle-zenith), utilizing its palette and typography for a premium feel.

## Installation

### Manual Installation
1. Download the `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create a folder named `mantle-kanban` in your vault's `.obsidian/plugins/` directory.
3. Move the downloaded files into that folder.
4. Restart Obsidian and enable **Mantle Kanban** in **Settings > Community plugins**.

## Development

To modify this plugin:
1. Navigate to this directory in your terminal.
2. Install dependencies: `npm install`
3. Build the plugin: `npm run build`
4. For active development, use: `npm run dev`

This plugin is built with TypeScript and esbuild.

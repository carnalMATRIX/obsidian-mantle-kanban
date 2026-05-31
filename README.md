# Mantle Kanban

Mantle Kanban is a professional-grade visual Kanban board for Obsidian. It provides a highly interactive way to organize projects, track tasks across different stages, and manage notes with drag-and-drop simplicity.

---

## 🎨 Cohesive Styling

Mantle Kanban is designed to integrate with the **Project Mantle** core ecosystem. While it runs on any theme, it is optimized to merge with the **Zenith theme**, adopting its color variables, button styles, rounded panels, and interactive glows.

---

## ✨ Key Features

* **Drag-and-Drop Column Management:** Easily move cards between columns to update task statuses instantly.
* **Rich Markdown Previews:** Cards render Markdown content, links, images, and frontmatter metadata directly on the board.
* **Interactive Backgrounds:** Features a unique, responsive dot-pattern background that reacts dynamically to mouse movement.
* **Sub-task Support:** Track checklists and progress bar percentages directly on the card covers.

---

## 📥 Installation

### Method A: Via Obsidian Community Directory (Recommended)
1. Go to **Settings** > **Community plugins** > **Browse**.
2. Search for **Mantle Kanban**.
3. Click **Install**, then click **Enable**.

### Method B: Via BRAT (Beta Reviewer's Auto-update Tester)
1. Install the **BRAT** plugin from Obsidian's community store.
2. In BRAT settings, click **Add Beta plugin** and enter:
   `https://github.com/carnalMATRIX/obsidian-mantle-kanban`
3. Click **Add Plugin** to download and auto-update.

### Method C: Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub Release](https://github.com/carnalMATRIX/obsidian-mantle-kanban/releases).
2. Inside your vault, navigate to `.obsidian/plugins/`.
3. Create a folder named `mantle-kanban` and paste the three downloaded files inside.
4. Restart Obsidian, go to **Settings** > **Community plugins**, and enable **Mantle Kanban**.

---

## 🔍 Troubleshooting

### Columns or cards are not displaying
* **Markdown Formatting:** Ensure that your Kanban board file's frontmatter has the correct Kanban metadata keys. If you opened a regular Markdown file as a Kanban board, make sure it matches the layout expectations.
* **Toggling Views:** If the board displays as raw markdown text, click the three dots in the top right corner of the note and select **Open as Kanban board**.

### Drag-and-drop is lagging or unresponsive
* **Workspace Reload:** Reload the UI (`Cmd+R` or `Ctrl+R`) to clear memory lag.
* **Hardware Acceleration:** Ensure hardware acceleration is enabled under Obsidian's advanced settings to handle background animations smoothly.

---

## 🛠️ Development

If you wish to modify or customize this plugin locally:
1. Clone this repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the compiler in watch mode:
   ```bash
   npm run dev
   ```
4. Build minified production code:
   ```bash
   npm run build
   ```

---

## 📄 License

Copyright (c) 2026 Ryan Bakker. Released under a **Personal Use License**. Non-commercial, personal use only. Redistribution or modification for distribution is strictly prohibited. See the `LICENSE` file for full terms.

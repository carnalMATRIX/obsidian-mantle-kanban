import { Plugin, TFile, TFolder, WorkspaceLeaf, MarkdownView, setIcon, TAbstractFile } from "obsidian";
import { KanbanView } from "./view";
import { KANBAN_VIEW_TYPE } from "./types";
import { Logger } from "./logger";
import { MantleKanbanSettings, DEFAULT_SETTINGS, MantleKanbanSettingTab } from "./settings";

export default class MantleKanban extends Plugin {
  private switchingLeaves: Set<string> = new Set();
  private logger = new Logger("Mantle Kanban");
  settings!: MantleKanbanSettings;

  async onload() {
    this.logger.info("Initializing plugin...");
    
    await this.loadSettings();
    this.addSettingTab(new MantleKanbanSettingTab(this.app, this));
    
    try {
      this.registerView(
        KANBAN_VIEW_TYPE,
        (leaf) => new KanbanView(leaf, this)
      );

      // Add ribbon icon
      this.addRibbonIcon("square-kanban", "Create New Kanban Board", () => {
        const activeFile = this.app.workspace.getActiveFile();
        const folder = activeFile?.parent || this.app.vault.getRoot();
        if (folder instanceof TFolder) {
          this.createKanbanBoard(folder);
        }
      });

      // Robust view enforcement
      this.registerEvent(
        this.app.workspace.on("file-open", (file) => this.handleFileOpen(file))
      );

      this.registerEvent(
        this.app.workspace.on("active-leaf-change", (leaf) => this.handleLeafChange(leaf))
      );

      // Metadata change detection (if user adds frontmatter manually)
      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          if (this.isKanbanFile(file)) {
            this.handleFileOpen(file);
          }
        })
      );

      // Track file rename events to keep board settings path in sync
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          if (file instanceof TFile && file.extension === "md") {
            if (this.settings.boardSettings && this.settings.boardSettings[oldPath]) {
              this.settings.boardSettings[file.path] = this.settings.boardSettings[oldPath];
              delete this.settings.boardSettings[oldPath];
              this.saveSettings();
            }
          }
        })
      );

      // Track file delete events to clean up board settings
      this.registerEvent(
        this.app.vault.on("delete", (file) => {
          if (file instanceof TFile && file.extension === "md") {
            if (this.settings.boardSettings && this.settings.boardSettings[file.path]) {
              delete this.settings.boardSettings[file.path];
              this.saveSettings();
            }
          }
        })
      );

      // Add command to manually switch
      this.addCommand({
        id: "open-as-kanban",
        name: "Open current file as Kanban board",
        checkCallback: (checking: boolean) => {
          const leaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
          if (leaf) {
            if (!checking) {
              this.switchToKanbanView(leaf);
            }
            return true;
          }
          return false;
        }
      });

      // Add context menu item for folders and files
      this.registerEvent(
        this.app.workspace.on("file-menu", (menu, file) => {
          if (file instanceof TFolder) {
            menu.addItem((item) => {
              item
                .setTitle("New Kanban Board")
                .setIcon("square-kanban")
                .onClick(async () => {
                  await this.createKanbanBoard(file);
                });
            });
          } else if (file instanceof TFile && file.extension === "md") {
            if (this.isKanbanFile(file)) {
              menu.addItem((item) => {
                item
                  .setTitle("Open as Kanban Board")
                  .setIcon("square-kanban")
                  .onClick(() => {
                    const leaf = this.app.workspace.getLeaf(false);
                    this.switchToKanbanView(leaf, file);
                  });
              });
            } else {
              menu.addItem((item) => {
                item
                  .setTitle("Convert to Kanban Board")
                  .setIcon("square-kanban")
                  .onClick(async () => {
                    await this.convertToKanban(file);
                  });
              });
            }
          }
        })
      );

      this.logger.info("Plugin successfully loaded");
    } catch (e) {
      this.logger.error("Failed to load plugin", e);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.boardSettings = this.settings.boardSettings || {};
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private isKanbanFile(file: TAbstractFile | null): boolean {
    if (!(file instanceof TFile) || file.extension !== "md") return false;
    
    // Check cache first (fast)
    const cache = this.app.metadataCache.getFileCache(file);
    if (cache?.frontmatter?.["kanban-plugin"] === "basic") {
      return true;
    }

    // Fallback: check if the file was recently marked as kanban but cache hasn't updated
    // This is a bit speculative but helps with stability during saves
    return false;
  }

  private handleFileOpen(file: TFile | null) {
    if (!file || file.extension !== "md") return;

    if (this.isKanbanFile(file)) {
      this.app.workspace.iterateAllLeaves((leaf) => {
        // Only switch if it's a MarkdownView and NOT already switching
        if (leaf.view instanceof MarkdownView && leaf.view.file === file) {
          const leafId = (leaf as any).id;
          if (!this.switchingLeaves.has(leafId)) {
            this.switchToKanbanView(leaf);
          }
        }
      });
    }
  }

  private handleLeafChange(leaf: WorkspaceLeaf | null) {
    if (!leaf || !(leaf.view instanceof MarkdownView)) return;

    const file = leaf.view.file;
    if (file && this.isKanbanFile(file)) {
      this.addSwitchButton(leaf.view);
      
      const leafId = (leaf as any).id;
      if (!this.switchingLeaves.has(leafId)) {
        this.switchToKanbanView(leaf);
      }
    }
  }

  private addSwitchButton(view: MarkdownView) {
    const container = view.containerEl.querySelector(".view-actions");
    if (!container || container.querySelector(".kanban-switch-button")) return;

    const btn = view.addAction("square-kanban", "Open as Kanban Board", () => {
      this.switchToKanbanView(view.leaf);
    });
    btn.addClass("kanban-switch-button");
  }

  private async switchToKanbanView(leaf: WorkspaceLeaf, file?: TFile) {
    const targetFile = file || (leaf.view as any).file;
    if (!targetFile) return;

    // Avoid redundant switches or loops
    const leafId = (leaf as any).id;
    if (this.switchingLeaves.has(leafId)) return;
    this.switchingLeaves.add(leafId);

    const isActive = (this.app.workspace as any).activeLeaf === leaf;

    try {
      await leaf.setViewState({
        type: KANBAN_VIEW_TYPE,
        active: isActive,
        state: { file: targetFile.path }
      });
    } finally {
      this.switchingLeaves.delete(leafId);
    }
  }

  async convertToKanban(file: TFile) {
    await this.app.vault.process(file, (content) => {
      if (content.startsWith("---")) {
        return content.replace("---", "---\nkanban-plugin: basic");
      }
      return `---\nkanban-plugin: basic\n---\n\n${content}`;
    });
    this.handleFileOpen(file);
  }

  async createKanbanBoard(folder: TFolder) {
    const fileName = "New Kanban Board.md";
    let path = `${folder.path}/${fileName}`;
    
    let i = 1;
    while (await this.app.vault.adapter.exists(path)) {
      path = `${folder.path}/New Kanban Board ${i}.md`;
      i++;
    }

    const content = `---\nkanban-plugin: basic\n---\n\n## Todo\n\n## In Progress\n\n## Done\n`;
    const file = await this.app.vault.create(path, content);
    
    const leaf = this.app.workspace.getLeaf(false);
    if (leaf) {
      await leaf.openFile(file);
      await this.switchToKanbanView(leaf, file);
    }
  }
}

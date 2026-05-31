import {
  TextFileView,
  TFile,
  setIcon,
  MarkdownRenderer,
  WorkspaceLeaf,
  Modal,
  TFolder,
  MetadataCache,
  EventRef,
  Menu,
} from "obsidian";
import {
  KANBAN_VIEW_TYPE,
  KanbanData,
  KanbanColumn,
  KanbanCard,
  Priority,
  SortType,
  SortOrder,
  BoardFilter,
} from "./types";
import { parseMarkdown, stringifyMarkdown } from "./parser";
import { DotPatternManager } from "./background";
import {
  InputModal,
  CardModal,
  BoardSettingsModal,
  ColumnColorModal,
  KanbanIconPickerModal,
} from "./modal";
import MantleKanban from "./main";
import { formatDate } from "./utils";
// @ts-ignore
import { IconPickerModal } from "../../mantle-icons/src/IconPickerModal";
import { icons, createElement } from "lucide";

// CodeMirror imports for Markdown editor view
import {
  EditorView,
  keymap,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  highlightActiveLine,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
  history,
  historyKeymap,
  defaultKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { indentOnInput, bracketMatching } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";

export class KanbanView extends TextFileView {
  private kanbanData!: KanbanData;
  private boardEl!: HTMLElement;
  private backgroundManager!: DotPatternManager;
  private isSaving = false;
  private draggingCardId: string | null = null;
  private draggingColumnId: string | null = null;
  private metadataEvent!: EventRef;
  private plugin: MantleKanban;

  // New view modes & editors state
  private currentViewMode: "kanban" | "list" | "markdown" = "kanban";
  private markdownEditorView: EditorView | null = null;
  private collapsedColumns: Set<string> = new Set();
  private headerEl!: HTMLElement;
  private bodyEl!: HTMLElement;

  // Search & Filter State
  private searchQuery = "";
  private isSearchExpanded = false;
  private boardFilter!: BoardFilter;
  private isFilterPopoverOpen = false;

  constructor(leaf: WorkspaceLeaf, plugin: MantleKanban) {
    super(leaf);
    this.plugin = plugin;
  }

  getShowCardContent(): boolean {
    if (!this.file) return this.plugin.settings.showCardContent;
    const boardSettings = this.plugin.settings.boardSettings?.[this.file.path];
    if (boardSettings?.showCardContent !== undefined) {
      return boardSettings.showCardContent;
    }
    return this.plugin.settings.showCardContent;
  }

  getClearFiltersOnExit(): boolean {
    if (!this.file) return this.plugin.settings.clearFiltersOnExit;
    const boardSettings = this.plugin.settings.boardSettings?.[this.file.path];
    if (boardSettings?.clearFiltersOnExit !== undefined) {
      return boardSettings.clearFiltersOnExit;
    }
    return this.plugin.settings.clearFiltersOnExit;
  }

  getRemovePriorityOnCompleted(): boolean {
    if (!this.file) return this.plugin.settings.removePriorityOnCompleted;
    const boardSettings = this.plugin.settings.boardSettings?.[this.file.path];
    if (boardSettings?.removePriorityOnCompleted !== undefined) {
      return boardSettings.removePriorityOnCompleted;
    }
    return this.plugin.settings.removePriorityOnCompleted;
  }

  getViewType(): string {
    return KANBAN_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename || "Kanban";
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("kanban-view-container");

    // Initialize background
    this.backgroundManager = new DotPatternManager(this.contentEl);

    // Initialize board container
    this.boardEl = this.contentEl.createDiv("kanban-board");

    // Create persistent header and body containers to avoid rebuilding editor on every render
    this.headerEl = this.boardEl.createDiv("kanban-board-header");
    this.bodyEl = this.boardEl.createDiv({
      cls: "kanban-board-body",
      attr: {
        style:
          "flex: 1; display: flex; flex-direction: column; overflow: hidden;",
      },
    });

    // Listen for metadata changes (for icons)
    this.metadataEvent = this.app.metadataCache.on("changed", (file) => {
      if (file === this.file && !this.isSaving) {
        this.render();
      }
    });

    // Listen for file renames to update the header
    this.registerEvent(
      this.app.vault.on("rename", (file) => {
        if (file === this.file) {
          this.render();
        }
      }),
    );
  }

  async onClose() {
    this.backgroundManager?.destroy();
    if (this.metadataEvent) {
      this.app.metadataCache.offref(this.metadataEvent);
    }
    if (this.markdownEditorView) {
      this.markdownEditorView.destroy();
      this.markdownEditorView = null;
    }
  }

  clear(): void {
    if (this.markdownEditorView) {
      this.markdownEditorView.destroy();
      this.markdownEditorView = null;
    }
  }

  setViewData(data: string, clear: boolean): void {
    if (clear) {
      this.clear();
    }
    this.kanbanData = parseMarkdown(data);

    // Load view mode from metadata
    if (this.kanbanData.metadata && this.kanbanData.metadata["view-mode"]) {
      const savedMode = this.kanbanData.metadata["view-mode"];
      if (
        savedMode === "kanban" ||
        savedMode === "list" ||
        savedMode === "markdown"
      ) {
        this.currentViewMode = savedMode;
      }
    } else {
      this.currentViewMode = "kanban";
    }

    // Load board-wide filter from metadata
    this.boardFilter = this.kanbanData.metadata?.["board-filter"] || {
      columns: ["all"],
      priorities: [],
      sortType: "none",
      sortOrder: "asc",
    };

    // Respect session-only filters setting
    if (this.getClearFiltersOnExit()) {
      this.boardFilter = {
        columns: ["all"],
        priorities: [],
        sortType: "none",
        sortOrder: "asc",
      };
      for (const column of this.kanbanData.columns) {
        column.filter = undefined;
      }
    }

    // Sync editor data if it's open and data changed externally
    if (this.currentViewMode === "markdown" && this.markdownEditorView) {
      const currentDoc = this.markdownEditorView.state.doc.toString();
      if (currentDoc !== data) {
        this.markdownEditorView.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: data },
        });
      }
    }

    if (this.file) {
      this.render();
    } else {
      setTimeout(() => {
        if (this.file) this.render();
      }, 0);
    }
  }

  getViewData(): string {
    if (this.currentViewMode === "markdown" && this.markdownEditorView) {
      return this.markdownEditorView.state.doc.toString();
    }
    if (!this.kanbanData) return "";

    // Save view mode in metadata
    if (!this.kanbanData.metadata) this.kanbanData.metadata = {};
    this.kanbanData.metadata["view-mode"] = this.currentViewMode;

    // Save board-wide filter in metadata
    if (this.getClearFiltersOnExit()) {
      if (this.kanbanData.metadata) {
        delete this.kanbanData.metadata["board-filter"];
      }
    } else {
      if (!this.kanbanData.metadata) this.kanbanData.metadata = {};
      this.kanbanData.metadata["board-filter"] = this.boardFilter;
    }

    return stringifyMarkdown(this.kanbanData, {
      clearFiltersOnExit: this.getClearFiltersOnExit(),
    } as any);
  }

  private async saveBoard() {
    if (this.isSaving || !this.file) return;
    this.isSaving = true;
    try {
      await this.requestSave();
    } finally {
      // Small delay to prevent immediate re-render from metadata change event
      setTimeout(() => {
        this.isSaving = false;
      }, 500);
    }
  }

  private render() {
    if (!this.file || !this.kanbanData) return;

    if (!this.headerEl) {
      this.headerEl = this.boardEl.createDiv("kanban-board-header");
    }
    if (!this.bodyEl) {
      this.bodyEl = this.boardEl.createDiv({
        cls: "kanban-board-body",
        attr: {
          style:
            "flex: 1; display: flex; flex-direction: column; overflow: hidden;",
        },
      });
    }

    this.renderHeader();
    this.renderBoardBody();
  }

  private renderBoardBody() {
    if (this.currentViewMode === "markdown") {
      this.backgroundManager?.hide();
      this.renderMarkdownView();
    } else {
      if (this.markdownEditorView) {
        this.markdownEditorView.destroy();
        this.markdownEditorView = null;
      }
      this.bodyEl.empty();
      if (this.currentViewMode === "kanban") {
        this.backgroundManager?.show();
        this.renderKanbanView();
      } else if (this.currentViewMode === "list") {
        this.backgroundManager?.hide();
        this.renderListView();
      }
    }

    if (this.isFilterPopoverOpen) {
      this.renderFilterPopover();
    } else {
      const popover = this.boardEl.querySelector(".kanban-filter-popover");
      if (popover) popover.remove();
    }
  }

  private renderHeader() {
    this.headerEl.empty();

    const titleWrapper = this.headerEl.createDiv("kanban-board-title-wrapper");
    const titleH2 = titleWrapper.createEl("h2");

    // Icon Logic
    const cache = this.app.metadataCache.getFileCache(this.file!);
    const iconName = this.kanbanData.metadata?.icon || cache?.frontmatter?.icon;

    if (iconName) {
      const iconEl = titleH2.createDiv("kanban-board-icon");
      const pascalKey = iconName
        .split("-")
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join("");
      // @ts-ignore
      const lucideIcon = icons[pascalKey];
      if (lucideIcon) {
        iconEl.appendChild(createElement(lucideIcon));
      } else {
        setIcon(
          iconEl,
          iconName.startsWith("lucide-") ? iconName : "lucide-" + iconName,
        );
      }
    } else {
      const placeholder = titleH2.createDiv("kanban-board-icon-placeholder");
      setIcon(placeholder, "plus-circle");
    }

    titleH2.createSpan({ text: this.getDisplayText() });
    titleWrapper.onclick = () => {
      // @ts-ignore
      new IconPickerModal(this.app, this.file!).open();
    };

    const rightContainer = this.headerEl.createDiv({
      cls: "kanban-header-right",
      attr: { style: "display: flex; align-items: center;" },
    });

    // View Switcher (Monday.com style capsule buttons)
    const switcherEl = rightContainer.createDiv("kanban-view-switcher");

    const views: {
      mode: typeof KanbanView.prototype.currentViewMode;
      label: string;
      icon: string;
    }[] = [
      { mode: "kanban", label: "Kanban", icon: "square-kanban" },
      { mode: "list", label: "List", icon: "list" },
      { mode: "markdown", label: "Markdown", icon: "code" },
    ];

    for (const v of views) {
      const tabEl = switcherEl.createDiv(
        `kanban-view-switcher-tab${this.currentViewMode === v.mode ? " is-active" : ""}`,
      );
      setIcon(tabEl, v.icon);
      tabEl.createSpan({ text: v.label });
      tabEl.onclick = () => {
        if (this.currentViewMode === v.mode) return;

        // If switching AWAY from markdown, parse current text editor content
        if (this.currentViewMode === "markdown" && this.markdownEditorView) {
          const docText = this.markdownEditorView.state.doc.toString();
          this.kanbanData = parseMarkdown(docText);
        }

        this.currentViewMode = v.mode;
        if (!this.kanbanData.metadata) this.kanbanData.metadata = {};
        this.kanbanData.metadata["view-mode"] = v.mode;

        this.render();
        this.saveBoard();
      };
    }

    const actionsEl = rightContainer.createDiv("kanban-header-actions");

    // Only show "Add List" in Kanban and List view
    if (this.currentViewMode !== "markdown") {
      const addColBtn = actionsEl.createEl("button", {
        cls: "kanban-header-btn",
        text: "+ Add List",
      });
      setIcon(addColBtn, "plus");
      addColBtn.addEventListener("click", () => this.addList());
    }

    // Filter button (Feature 5)
    if (this.currentViewMode !== "markdown") {
      const filterBtn = actionsEl.createEl("button", {
        cls:
          "kanban-header-btn kanban-filter-btn" +
          (this.hasActiveFilters() ? " is-active" : ""),
        attr: { "aria-label": "Board Filter" },
      });
      setIcon(filterBtn, "filter");
      filterBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.isFilterPopoverOpen = !this.isFilterPopoverOpen;
        this.renderBoardBody();
      });
    }

    // Search bar (Feature 2)
    if (this.currentViewMode !== "markdown") {
      const searchWrapper = actionsEl.createDiv("kanban-search-wrapper");
      const searchContainer = searchWrapper.createDiv(
        "kanban-search-container",
      );
      if (this.isSearchExpanded) {
        searchContainer.addClass("is-expanded");
      }

      const searchToggleBtn = searchContainer.createEl("button", {
        cls: "kanban-header-btn kanban-search-toggle-btn",
        attr: { "aria-label": "Search board" },
      });
      setIcon(searchToggleBtn, "search");

      const searchInput = searchContainer.createEl("input", {
        cls: "kanban-search-input",
        attr: {
          type: "text",
          placeholder: "Search cards...",
          value: this.searchQuery,
        },
      });

      searchToggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.isSearchExpanded = !this.isSearchExpanded;
        searchContainer.toggleClass("is-expanded", this.isSearchExpanded);
        if (this.isSearchExpanded) {
          searchInput.focus();
        } else {
          this.searchQuery = "";
          searchInput.value = "";
          this.renderBoardBody();
        }
      });

      searchInput.addEventListener("input", () => {
        this.searchQuery = searchInput.value;
        this.renderBoardBody();
      });

      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          this.isSearchExpanded = false;
          searchContainer.removeClass("is-expanded");
          this.searchQuery = "";
          searchInput.value = "";
          searchInput.blur();
          this.renderBoardBody();
        }
      });

      searchInput.addEventListener("click", (e) => e.stopPropagation());
    }

    // Render the settings cog button in the header actions container
    const settingsBtn = actionsEl.createEl("button", {
      cls: "kanban-header-btn kanban-settings-btn",
      attr: { "aria-label": "Kanban Board Settings" },
    });
    setIcon(settingsBtn, "settings");
    settingsBtn.addEventListener("click", () => {
      if (this.file) {
        new BoardSettingsModal(
          this.app,
          this.file,
          this.plugin,
          this.kanbanData,
          () => {
            this.render();
          },
        ).open();
      }
    });
  }

  private renderColumnIcon(column: KanbanColumn, container: HTMLElement) {
    if (!this.plugin.settings.useMantleIcons || !column.icon) return;

    const iconEl = container.createDiv("kanban-column-icon");
    const pascalKey = column.icon
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("");

    // @ts-ignore
    const lucideIcon = icons[pascalKey];
    if (lucideIcon) {
      iconEl.empty();
      const svg = createElement(lucideIcon);
      iconEl.appendChild(svg);
    } else {
      // Fallback: try with lucide- prefix or as is
      setIcon(
        iconEl,
        column.icon.startsWith("lucide-")
          ? column.icon
          : "lucide-" + column.icon,
      );
    }
  }
  private renderKanbanView() {
    const columnsEl = this.bodyEl.createDiv("kanban-columns-container");
    columnsEl.style.display = "flex";
    columnsEl.style.gap = "24px";
    columnsEl.style.height = "100%";
    columnsEl.style.alignItems = "flex-start";

    for (const column of this.kanbanData.columns) {
      this.renderKanbanList(column, columnsEl);
    }
  }

  private renderListView() {
    const listViewEl = this.bodyEl.createDiv("kanban-list-view");

    // Monday.com primary column color accents
    const colors = [
      "#579BFC",
      "#00C875",
      "#FDAB3D",
      "#E2445C",
      "#A25DDC",
      "#00D2D2",
      "#FF642E",
    ];

    this.kanbanData.columns.forEach((column, index) => {
      const color = colors[index % colors.length];
      this.renderListGroup(column, listViewEl, color);
    });
  }

  private renderMarkdownView() {
    const mdViewEl = this.bodyEl.createDiv("kanban-markdown-view");
    const editorContainer = mdViewEl.createDiv("kanban-markdown-editor-container");

    const markdownText = stringifyMarkdown(this.kanbanData, {
      clearFiltersOnExit: this.getClearFiltersOnExit(),
    } as any);

    this.markdownEditorView = new EditorView({
      state: EditorState.create({
        doc: markdownText,
        extensions: [
          history(),
          highlightSpecialChars(),
          drawSelection(),
          dropCursor(),
          highlightActiveLine(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          rectangularSelection(),
          highlightSelectionMatches(),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...lintKeymap,
            indentWithTab,
          ]),
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.isSaving) {
              this.saveBoard();
            }
          })
        ],
      }),
      parent: editorContainer,
    });
  }

  private renderListGroup(
    column: KanbanColumn,
    container: HTMLElement,
    color: string,
  ) {
    const groupEl = container.createDiv("kanban-list-group");
    groupEl.dataset.id = column.id;

    const isCollapsed = this.collapsedColumns.has(column.id);
    if (isCollapsed) {
      groupEl.addClass("is-collapsed");
    }

    // List Group Header
    const headerEl = groupEl.createDiv("kanban-list-group-header");
    if (column.color) {
      groupEl.addClass(`kanban-color-${column.color}`);
    } else {
      headerEl.style.borderLeft = `6px solid ${color}`;
    }

    const toggleEl = headerEl.createDiv("kanban-list-group-toggle");
    setIcon(toggleEl, "chevron-down");

    const titleEl = headerEl.createEl("h3");
    this.renderColumnIcon(column, titleEl);
    const titleTextSpan = titleEl.createSpan({ text: column.title });
    titleEl.createSpan({
      cls: "kanban-list-group-count",
      text: `${column.cards.length}`,
    });

    // Double click / click to edit list title
    titleTextSpan.addEventListener("click", (e) => {
      e.stopPropagation();
      this.editListTitle(column, titleTextSpan);
    });

    // Toggle collapse on header click
    headerEl.onclick = () => {
      if (this.collapsedColumns.has(column.id)) {
        this.collapsedColumns.delete(column.id);
        groupEl.removeClass("is-collapsed");
      } else {
        this.collapsedColumns.add(column.id);
        groupEl.addClass("is-collapsed");
      }
    };

    // More actions button for list group
    const actionsEl = headerEl.createDiv("kanban-list-group-actions");
    const listMoreBtn = actionsEl.createDiv("kanban-list-group-action-btn");
    setIcon(listMoreBtn, "more-vertical");
    listMoreBtn.onclick = (e) => {
      e.stopPropagation();
      this.openColumnActionsMenu(column, e);
    };

    // Table Container
    const tableContainerEl = groupEl.createDiv("kanban-list-table-container");
    const tableEl = tableContainerEl.createDiv("kanban-list-table");

    // Table Header
    const tableHeaderEl = tableEl.createDiv("kanban-list-table-header");
    if (!column.color) tableHeaderEl.style.borderLeft = "6px solid transparent";

    tableHeaderEl.createDiv("kanban-list-table-header-cell cell-drag");
    tableHeaderEl.createDiv("kanban-list-table-header-cell cell-checkbox");
    tableHeaderEl
      .createDiv("kanban-list-table-header-cell cell-task")
      .setText("Task");
    tableHeaderEl
      .createDiv("kanban-list-table-header-cell cell-link")
      .setText("Link");
    tableHeaderEl
      .createDiv("kanban-list-table-header-cell cell-priority")
      .setText("Priority");
    tableHeaderEl
      .createDiv("kanban-list-table-header-cell cell-deadline")
      .setText("Due Date");
    tableHeaderEl
      .createDiv("kanban-list-table-header-cell cell-created")
      .setText("Created");
    tableHeaderEl
      .createDiv("kanban-list-table-header-cell cell-actions")
      .setText("Actions");

    // Drag over group to handle moving cards to column
    tableEl.addEventListener("dragover", (e) => {
      if (this.draggingCardId) {
        e.preventDefault();
        tableEl.addClass("drag-over");
      }
    });
    tableEl.addEventListener("dragleave", () => {
      tableEl.removeClass("drag-over");
    });
    tableEl.addEventListener("drop", (e) => {
      if (this.draggingCardId) {
        e.preventDefault();
        tableEl.removeClass("drag-over");
        this.moveCard(this.draggingCardId, column.id);
      }
    });

    const filteredCards = this.getFilteredCards(column);
    for (const card of filteredCards) {
      this.renderListRow(card, tableEl, column);
    }

    this.renderListAddRow(column, tableEl);
  }

  private renderListRow(
    card: KanbanCard,
    container: HTMLElement,
    column: KanbanColumn,
  ) {
    const rowEl = container.createDiv("kanban-list-row");
    rowEl.draggable = true;
    rowEl.dataset.id = card.id;

    // 1. Drag Handle
    const dragCell = rowEl.createDiv("kanban-list-cell cell-drag");
    setIcon(dragCell, "grip-vertical");

    // 2. Checkbox
    const checkCell = rowEl.createDiv("kanban-list-cell cell-checkbox");
    const checkEl = checkCell.createEl("input", { type: "checkbox" });
    checkEl.checked = card.completed;
    checkEl.onclick = (e) => {
      e.stopPropagation();
      card.completed = checkEl.checked;
      this.saveBoard();
    };

    // 3. Task Title
    const taskCell = rowEl.createDiv("kanban-list-cell cell-task");
    taskCell.setText(card.title);
    taskCell.onclick = (e) => {
      e.stopPropagation();
      this.editCard(card);
    };

    // 4. Link
    const linkCell = rowEl.createDiv("kanban-list-cell cell-link");
    if (card.linkedFile) {
      setIcon(linkCell, "link");
      linkCell.onclick = (e) => {
        e.stopPropagation();
        this.app.workspace.openLinkText(card.linkedFile!, this.file!.path);
      };
    } else {
      const span = linkCell.createSpan({ text: "-" });
      span.style.color = "var(--text-muted)";
      span.style.opacity = "0.5";
    }

    // 5. Priority
    const priorityCell = rowEl.createDiv("kanban-list-cell cell-priority");
    if (card.priority) {
      priorityCell.createSpan({
        cls: `kanban-priority-${card.priority}`,
        text: card.priority,
      });
    } else {
      const span = priorityCell.createSpan({ text: "-" });
      span.style.color = "var(--text-muted)";
      span.style.opacity = "0.5";
    }
    priorityCell.onclick = (e) => {
      e.stopPropagation();
      this.showPriorityMenu(card, e);
    };

    // 6. Due Date
    const deadlineCell = rowEl.createDiv("kanban-list-cell cell-deadline");
    if (card.deadline) {
      deadlineCell.createSpan({
        text: this.getFormattedDeadline(card.deadline),
      });
    } else {
      const span = deadlineCell.createSpan({ text: "-" });
      span.style.color = "var(--text-muted)";
      span.style.opacity = "0.5";
    }
    deadlineCell.onclick = (e) => {
      e.stopPropagation();
      this.showDatePicker(card, deadlineCell);
    };

    // 7. Created Date
    const createdCell = rowEl.createDiv("kanban-list-cell cell-created");
    const dateStr = new Date(card.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    createdCell.setText(dateStr);

    // 8. Actions (More)
    const actionsCell = rowEl.createDiv("kanban-list-cell cell-actions");
    const moreBtn = actionsCell.createDiv("kanban-list-btn-action action-more");
    setIcon(moreBtn, "more-vertical");
    moreBtn.setAttribute("aria-label", "More actions");
    moreBtn.onclick = (e) => {
      e.stopPropagation();
      this.showCardContextMenu(card, column, e);
    };
  }
  private renderListAddRow(column: KanbanColumn, container: HTMLElement) {
    const rowEl = container.createDiv("kanban-list-add-row");

    if (column.color) {
      rowEl.style.setProperty(
        "--column-color",
        `var(--kanban-color-${column.color})`,
      );
    }

    const input = rowEl.createEl("input", {
      cls: "kanban-list-add-input",
      attr: {
        placeholder: "+ Add Item",
      },
    });

    input.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        const title = input.value.trim();
        const newCard: KanbanCard = {
          id: Math.random().toString(36).substring(2, 9),
          title: title,
          content: "",
          completed: false,
          createdAt: Date.now(),
        };
        column.cards.push(newCard);
        await this.saveBoard();
        this.render();
      }
    });
  }
  private renderKanbanList(column: KanbanColumn, container: HTMLElement) {
    const colEl = container.createDiv("kanban-column");
    colEl.dataset.id = column.id;
    colEl.draggable = true;
    if (column.color) {
      colEl.addClass(`kanban-color-${column.color}`);
    }

    // Column Drag and Drop
    colEl.addEventListener("dragstart", (e) => {
      if ((e.target as HTMLElement).closest(".kanban-card")) return;
      this.draggingColumnId = column.id;
      colEl.addClass("is-dragging");
      e.dataTransfer?.setData("column-id", column.id);
    });

    colEl.addEventListener("dragend", () => {
      this.draggingColumnId = null;
      colEl.removeClass("is-dragging");
    });

    colEl.addEventListener("dragover", (e) => {
      if (this.draggingColumnId && this.draggingColumnId !== column.id) {
        e.preventDefault();
        const rect = colEl.getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        if (e.clientX < midpoint) {
          colEl.style.borderLeft = "4px solid var(--interactive-accent)";
          colEl.style.borderRight = "";
        } else {
          colEl.style.borderRight = "4px solid var(--interactive-accent)";
          colEl.style.borderLeft = "";
        }
      }
    });

    colEl.addEventListener("dragleave", () => {
      colEl.style.borderLeft = "";
      colEl.style.borderRight = "";
    });

    colEl.addEventListener("drop", (e) => {
      if (this.draggingColumnId && this.draggingColumnId !== column.id) {
        e.preventDefault();
        colEl.style.borderLeft = "";
        colEl.style.borderRight = "";
        const rect = colEl.getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        const targetIndex = this.kanbanData.columns.indexOf(column);
        const insertIndex =
          e.clientX < midpoint ? targetIndex : targetIndex + 1;
        this.moveList(this.draggingColumnId, insertIndex);
      }
    });

    // List Header
    const headerEl = colEl.createDiv("kanban-column-header");
    const titleEl = headerEl.createEl("h3");
    this.renderColumnIcon(column, titleEl);
    titleEl.createSpan({ text: column.title });
    titleEl.addEventListener("click", () =>
      this.editListTitle(column, titleEl),
    );

    const actionsEl = headerEl.createDiv("kanban-column-actions");

    const addCardBtn = actionsEl.createDiv("kanban-action-btn");
    setIcon(addCardBtn, "plus");
    addCardBtn.setAttribute("aria-label", "Add Card");
    addCardBtn.addEventListener("click", () => this.addCard(column));

    const moreBtn = actionsEl.createDiv("kanban-action-btn");
    setIcon(moreBtn, "more-vertical");
    moreBtn.setAttribute("aria-label", "List Options");
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openColumnActionsMenu(column, e);
    });

    // Card List
    const cardListEl = colEl.createDiv("kanban-card-list");

    cardListEl.addEventListener("dragover", (e) => {
      if (this.draggingCardId) {
        e.preventDefault();
        cardListEl.addClass("drag-over");
      }
    });

    cardListEl.addEventListener("dragleave", () => {
      cardListEl.removeClass("drag-over");
    });

    cardListEl.addEventListener("drop", (e) => {
      if (this.draggingCardId) {
        e.preventDefault();
        cardListEl.removeClass("drag-over");
        this.moveCard(this.draggingCardId, column.id);
      }
    });

    const filteredCards = this.getFilteredCards(column);
    for (const card of filteredCards) {
      this.renderCard(card, cardListEl, column);
    }
  }
  private openFilterMenu(column: KanbanColumn, e: MouseEvent) {
    const menu = new Menu();
    const filter = column.filter || {
      sortType: "none",
      sortOrder: "asc",
      priorities: [],
    };

    menu.addItem((item) => {
      const isNone = filter.sortType === "none";
      item
        .setTitle(isNone ? "✓ None (Default)" : "None (Default)")
        .setIcon(isNone ? "check" : "sort-asc")
        .onClick(() => {
          column.filter = { ...filter, sortType: "none" };
          this.render();
          this.saveBoard();
        });
    });

    menu.addSeparator();

    const sortOptions: { type: SortType; label: string; icon: string }[] = [
      { type: "alphabetical", label: "Alphabetical", icon: "type" },
      { type: "deadline", label: "Due Date", icon: "calendar" },
      { type: "created", label: "Date Created", icon: "clock" },
      { type: "priority", label: "Priority", icon: "flag" },
    ];

    for (const opt of sortOptions) {
      menu.addItem((item) => {
        const isCurrent = filter.sortType === opt.type;
        const label = `${opt.label} (${filter.sortOrder === "asc" ? "Asc" : "Desc"})`;
        item
          .setTitle(isCurrent ? `✓ ${label}` : label)
          .setIcon(isCurrent ? "check" : opt.icon)
          .onClick(() => {
            if (isCurrent) {
              // Toggle order if already selected
              column.filter = {
                ...filter,
                sortOrder: filter.sortOrder === "asc" ? "desc" : "asc",
              };
            } else {
              column.filter = { ...filter, sortType: opt.type };
            }
            this.render();
            this.saveBoard();
          });
      });
    }

    menu.addSeparator();

    // Priority Filter (Multiselect)
    const priorities: Priority[] = ["critical", "high", "medium", "low"];
    for (const p of priorities) {
      menu.addItem((item) => {
        const isActive = filter.priorities.includes(p);
        const label = `Priority: ${p.charAt(0).toUpperCase() + p.slice(1)}`;
        item
          .setTitle(isActive ? `✓ ${label}` : label)
          .setIcon(isActive ? "check-square" : "square")
          .onClick(() => {
            let newPriorities = [...filter.priorities];
            if (isActive) {
              newPriorities = newPriorities.filter((x) => x !== p);
            } else {
              newPriorities.push(p);
            }
            column.filter = { ...filter, priorities: newPriorities };
            this.render();
            this.saveBoard();
          });
      });
    }

    if (
      filter.priorities.length > 0 ||
      (filter.sortType && filter.sortType !== "none")
    ) {
      menu.addSeparator();
      menu.addItem((item) => {
        item
          .setTitle("Clear All Filters")
          .setIcon("x-circle")
          .onClick(() => {
            column.filter = undefined;
            this.render();
            this.saveBoard();
          });
      });
    }

    menu.showAtMouseEvent(e);
  }

  private getFilteredCards(column: KanbanColumn): KanbanCard[] {
    let cards = [...column.cards];

    // 1. Filter by search query
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      cards = cards.filter(
        (c) =>
          c.title.toLowerCase().includes(query) ||
          c.content.toLowerCase().includes(query),
      );
    }

    // 2. Filter by board-wide filters
    if (this.boardFilter) {
      const isFilteredColumn =
        this.boardFilter.columns.includes("all") ||
        this.boardFilter.columns.includes(column.id) ||
        this.boardFilter.columns.length === 0;

      if (isFilteredColumn) {
        // Filter by Priority
        if (this.boardFilter.priorities.length > 0) {
          cards = cards.filter(
            (c) =>
              c.priority && this.boardFilter.priorities.includes(c.priority),
          );
        }

        // Filter out cards without the sort key (existing logic compatibility)
        if (this.boardFilter.sortType === "deadline") {
          cards = cards.filter((c) => !!c.deadline);
        } else if (this.boardFilter.sortType === "priority") {
          cards = cards.filter((c) => !!c.priority);
        } else if (this.boardFilter.sortType === "created") {
          cards = cards.filter((c) => !!c.createdAt);
        }

        // Sort
        if (this.boardFilter.sortType && this.boardFilter.sortType !== "none") {
          const order = this.boardFilter.sortOrder === "asc" ? 1 : -1;
          const priorityMap: Record<Priority, number> = {
            critical: 4,
            high: 3,
            medium: 2,
            low: 1,
          };

          cards.sort((a, b) => {
            switch (this.boardFilter.sortType) {
              case "alphabetical":
                return a.title.localeCompare(b.title) * order;
              case "deadline":
                return (
                  (a.deadline || "").localeCompare(b.deadline || "") * order
                );
              case "created":
                return (a.createdAt - b.createdAt) * order;
              case "priority":
                return (
                  (priorityMap[a.priority!] - priorityMap[b.priority!]) * order
                );
              default:
                return 0;
            }
          });
        }
      }
    }

    return cards;
  }

  private renderCard(
    card: KanbanCard,
    container: HTMLElement,
    column: KanbanColumn,
  ) {
    const cardEl = container.createDiv("kanban-card");
    cardEl.draggable = true;
    cardEl.dataset.id = card.id;

    cardEl.addEventListener("dragstart", (e) => {
      this.draggingCardId = card.id;
      e.dataTransfer?.setData("card-id", card.id);
      cardEl.addClass("is-dragging");
      e.stopPropagation();
    });

    cardEl.addEventListener("dragend", () => {
      this.draggingCardId = null;
      cardEl.removeClass("is-dragging");
    });

    cardEl.addEventListener("dragover", (e) => {
      if (this.draggingCardId && this.draggingCardId !== card.id) {
        e.preventDefault();
        e.stopPropagation();
        const rect = cardEl.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (e.clientY < midpoint) {
          cardEl.style.borderTop = "2px solid var(--interactive-accent)";
          cardEl.style.borderBottom = "";
        } else {
          cardEl.style.borderBottom = "2px solid var(--interactive-accent)";
          cardEl.style.borderTop = "";
        }
      }
    });

    cardEl.addEventListener("dragleave", () => {
      cardEl.style.borderTop = "";
      cardEl.style.borderBottom = "";
    });

    cardEl.addEventListener("drop", (e) => {
      if (this.draggingCardId && this.draggingCardId !== card.id) {
        e.preventDefault();
        e.stopPropagation();
        cardEl.style.borderTop = "";
        cardEl.style.borderBottom = "";
        const rect = cardEl.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const targetIndex = column.cards.indexOf(card);
        const insertIndex =
          e.clientY < midpoint ? targetIndex : targetIndex + 1;
        this.moveCard(this.draggingCardId, column.id, insertIndex);
      }
    });

    cardEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showCardContextMenu(card, column, e);
    });

    // Card Title
    const titleEl = cardEl.createDiv("kanban-card-title");
    titleEl.textContent = card.title;
    if (this.searchQuery) {
      this.highlightTextNodes(titleEl, this.searchQuery);
    }
    cardEl.addEventListener("click", () => this.editCard(card));

    // Metadata Tags
    if (card.priority || card.deadline || card.linkedFile) {
      const metaEl = cardEl.createDiv("kanban-card-meta");

      if (card.priority) {
        const priorityEl = metaEl.createSpan({
          cls: `kanban-priority-${card.priority}`,
        });
        setIcon(priorityEl, "flag");
        priorityEl.appendText(` ${card.priority}`);
        priorityEl.onclick = (e) => {
          e.stopPropagation();
          this.showPriorityMenu(card, e);
        };
      }

      if (card.deadline) {
        const deadlineEl = metaEl.createSpan("kanban-deadline");
        setIcon(deadlineEl, "calendar");
        deadlineEl.appendText(` ${this.getFormattedDeadline(card.deadline)}`);
        deadlineEl.onclick = (e) => {
          e.stopPropagation();
          this.showDatePicker(card, deadlineEl);
        };
      }

      if (card.linkedFile) {
        const linkEl = metaEl.createSpan("kanban-link");
        setIcon(linkEl, "link");
        linkEl.addEventListener("click", (e) => {
          e.stopPropagation();
          this.app.workspace.openLinkText(card.linkedFile!, this.file!.path);
        });
      }
    }

    // Preview content
    if (card.content && this.file && this.getShowCardContent()) {
      const previewEl = cardEl.createDiv("kanban-card-preview");

      previewEl.addClass("is-autohide-scrollbar");

      let scrollTimeout: any;
      previewEl.addEventListener("scroll", () => {
        previewEl.addClass("is-scrolling");
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          previewEl.removeClass("is-scrolling");
        }, 1500); // Hide after 1.5s of inactivity
      });

      MarkdownRenderer.renderMarkdown(
        card.content,
        previewEl,
        this.file.path,
        this,
      );
      if (this.searchQuery) {
        this.highlightTextNodes(previewEl, this.searchQuery);
      }
    }
  }

  private addList() {
    new InputModal(this.app, "Add List", "List Title", "", (title) => {
      if (!title) return;
      this.kanbanData.columns.push({
        id: Math.random().toString(36).substring(2, 9),
        title,
        cards: [],
      });
      this.render();
      this.saveBoard();
    }).open();
  }

  private deleteList(column: KanbanColumn) {
    if (!confirm(`Delete list "${column.title}"?`)) return;
    this.kanbanData.columns = this.kanbanData.columns.filter(
      (c) => c !== column,
    );
    this.render();
    this.saveBoard();
  }

  private editListTitle(column: KanbanColumn, el: HTMLElement) {
    new InputModal(
      this.app,
      "Edit List Title",
      "List Title",
      column.title,
      (newTitle) => {
        if (newTitle && newTitle !== column.title) {
          column.title = newTitle;
          el.textContent = newTitle;
          this.saveBoard();
        }
      },
    ).open();
  }

  private addCard(column: KanbanColumn) {
    const emptyCard: KanbanCard = {
      id: Math.random().toString(36).substring(2, 9),
      title: "",
      content: "",
      completed: false,
      createdAt: Date.now(),
    };

    new CardModal(
      this.app,
      emptyCard,
      (newCard) => {
        if (!newCard.title) return;
        this.checkRemovePriorityOnCompleted(newCard, column);
        column.cards.push(newCard);
        this.render();
        this.saveBoard();
      },
      undefined,
      true,
      () => {
        setTimeout(() => this.addCard(column), 50);
      },
    ).open();
  }

  private moveCard(
    cardId: string,
    targetColumnId: string,
    targetIndex?: number,
  ) {
    let sourceColumn: KanbanColumn | undefined;
    let card: KanbanCard | undefined;

    for (const col of this.kanbanData.columns) {
      const foundIndex = col.cards.findIndex((c) => c.id === cardId);
      if (foundIndex !== -1) {
        sourceColumn = col;
        card = col.cards[foundIndex];
        col.cards.splice(foundIndex, 1);
        break;
      }
    }

    if (sourceColumn && card) {
      const targetColumn = this.kanbanData.columns.find(
        (c) => c.id === targetColumnId,
      );
      if (targetColumn) {
        this.checkRemovePriorityOnCompleted(card, targetColumn);
        if (targetIndex !== undefined) {
          targetColumn.cards.splice(targetIndex, 0, card);
        } else {
          targetColumn.cards.push(card);
        }
        this.render();
        this.saveBoard();
      }
    }
  }

  private moveList(columnId: string, targetIndex: number) {
    const currentIndex = this.kanbanData.columns.findIndex(
      (c) => c.id === columnId,
    );
    if (currentIndex === -1) return;

    const column = this.kanbanData.columns[currentIndex];
    this.kanbanData.columns.splice(currentIndex, 1);

    const adjustedIndex =
      targetIndex > currentIndex ? targetIndex - 1 : targetIndex;
    this.kanbanData.columns.splice(adjustedIndex, 0, column);

    this.render();
    this.saveBoard();
  }

  private editCard(card: KanbanCard) {
    new CardModal(
      this.app,
      card,
      (updatedCard) => {
        Object.assign(card, updatedCard);
        this.render();
        this.saveBoard();
      },
      () => this.convertCardToFile(card),
    ).open();
  }

  private async convertCardToFile(card: KanbanCard) {
    if (card.linkedFile) return;

    const fileName = `${card.title}.md`.replace(/[\\\/:\*\?"<>\|]/g, "");
    const folderPath = this.file?.parent?.path || "";
    let filePath = `${folderPath}/${fileName}`;

    let i = 1;
    while (await this.app.vault.adapter.exists(filePath)) {
      filePath = `${folderPath}/${card.title} ${i}.md`;
      i++;
    }

    const content = card.content || "";
    await this.app.vault.create(filePath, content);
    card.linkedFile = filePath;
    this.render();
    this.saveBoard();
  }

  private showPriorityMenu(card: KanbanCard, e: MouseEvent) {
    const menu = new Menu();
    const priorities: (Priority | "none")[] = [
      "critical",
      "high",
      "medium",
      "low",
      "none",
    ];

    priorities.forEach((p) => {
      menu.addItem((item) => {
        const isCurrent =
          (p === "none" && !card.priority) ||
          (p !== "none" && card.priority === p);
        item
          .setTitle(
            p === "none" ? "None" : p.charAt(0).toUpperCase() + p.slice(1),
          )
          .setIcon(isCurrent ? "check" : "flag")
          .onClick(() => {
            if (p === "none") {
              delete card.priority;
            } else {
              card.priority = p;
            }
            this.render();
            this.saveBoard();
          });
      });
    });

    menu.showAtMouseEvent(e);
  }

  private showDatePicker(card: KanbanCard, trigger?: HTMLElement) {
    const existing = document.body.querySelector(".zenith-datepicker-popover");
    if (existing) {
      existing.remove();
    }

    let currentDate = new Date();
    if (card.deadline) {
      const parts = card.deadline.split("-");
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const d = parseInt(parts[2], 10);
        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
          currentDate = new Date(y, m, d);
        }
      }
    }

    let viewYear = currentDate.getFullYear();
    let viewMonth = currentDate.getMonth();

    const popover = document.createElement("div");
    popover.addClass("zenith-datepicker-popover");
    document.body.appendChild(popover);

    const positionPopover = () => {
      if (!trigger) {
        popover.style.top = "50%";
        popover.style.left = "50%";
        popover.style.transform = "translate(-50%, -50%)";
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const popoverWidth = 280;
      const popoverHeight = 310;

      let left = rect.left + (rect.width - popoverWidth) / 2;
      let top = rect.top - popoverHeight - 8;

      if (left < 10) left = 10;
      if (left + popoverWidth > window.innerWidth - 10) {
        left = window.innerWidth - popoverWidth - 10;
      }

      if (top < 10) {
        top = rect.bottom + 8;
      }

      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
    };

    positionPopover();

    const onResizeOrScroll = () => {
      positionPopover();
    };
    window.addEventListener("resize", onResizeOrScroll);
    window.addEventListener("scroll", onResizeOrScroll, true);

    const clickOutsideHandler = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        !popover.contains(target) &&
        (!trigger || !trigger.contains(target))
      ) {
        closePicker();
      }
    };

    const escKeyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePicker();
      }
    };

    const closePicker = () => {
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
      document.removeEventListener("mousedown", clickOutsideHandler, true);
      document.removeEventListener("keydown", escKeyHandler, true);
      popover.addClass("zdp-fade-out");
      setTimeout(() => popover.remove(), 150);
    };

    setTimeout(() => {
      document.addEventListener("mousedown", clickOutsideHandler, true);
      document.addEventListener("keydown", escKeyHandler, true);
    }, 10);

    const renderCalendar = () => {
      popover.empty();

      const headerEl = popover.createDiv("zdp-header");

      const prevBtn = headerEl.createEl("button", {
        cls: "zdp-btn zdp-nav-btn prev",
      });
      setIcon(prevBtn, "chevron-left");
      prevBtn.onclick = (ev) => {
        ev.stopPropagation();
        viewMonth--;
        if (viewMonth < 0) {
          viewMonth = 11;
          viewYear--;
        }
        renderCalendar();
      };

      const titleEl = headerEl.createDiv("zdp-title");
      const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];
      titleEl.setText(`${monthNames[viewMonth]} ${viewYear}`);

      const nextBtn = headerEl.createEl("button", {
        cls: "zdp-btn zdp-nav-btn next",
      });
      setIcon(nextBtn, "chevron-right");
      nextBtn.onclick = (ev) => {
        ev.stopPropagation();
        viewMonth++;
        if (viewMonth > 11) {
          viewMonth = 0;
          viewYear++;
        }
        renderCalendar();
      };

      const weekdaysEl = popover.createDiv("zdp-weekdays");
      const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
      weekdays.forEach((day) => {
        weekdaysEl.createDiv({ text: day, cls: "zdp-weekday" });
      });

      const daysGridEl = popover.createDiv("zdp-days-grid");

      const firstDay = new Date(viewYear, viewMonth, 1);
      const startDayOfWeek = firstDay.getDay();

      const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();

      const prevMonthTotalDays = new Date(viewYear, viewMonth, 0).getDate();
      for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const dayVal = prevMonthTotalDays - i;
        daysGridEl.createDiv({
          text: dayVal.toString(),
          cls: "zdp-day zdp-day-sibling-month",
        });
      }

      const today = new Date();
      const currentDeadlineStr = card.deadline;

      for (let day = 1; day <= totalDays; day++) {
        const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const dayEl = daysGridEl.createDiv({
          text: day.toString(),
          cls: "zdp-day zdp-day-current",
        });

        if (currentDeadlineStr === dateStr) {
          dayEl.addClass("is-selected");
        }

        if (
          today.getDate() === day &&
          today.getMonth() === viewMonth &&
          today.getFullYear() === viewYear
        ) {
          dayEl.addClass("is-today");
        }

        dayEl.onclick = (ev) => {
          ev.stopPropagation();
          card.deadline = dateStr;
          this.render();
          this.saveBoard();
          closePicker();
        };
      }

      const filledCells = startDayOfWeek + totalDays;
      const cellsToFill = 42 - filledCells;
      for (let i = 1; i <= cellsToFill; i++) {
        daysGridEl.createDiv({
          text: i.toString(),
          cls: "zdp-day zdp-day-sibling-month",
        });
      }

      const footerEl = popover.createDiv("zdp-footer");

      const todayBtn = footerEl.createEl("button", {
        cls: "zdp-btn zdp-footer-btn",
        text: "Today",
      });
      todayBtn.onclick = (ev) => {
        ev.stopPropagation();
        const t = new Date();
        const dateStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
        card.deadline = dateStr;
        this.render();
        this.saveBoard();
        closePicker();
      };

      const clearBtn = footerEl.createEl("button", {
        cls: "zdp-btn zdp-footer-btn zdp-clear-btn",
        text: "Clear",
      });
      clearBtn.onclick = (ev) => {
        ev.stopPropagation();
        card.deadline = undefined;
        this.render();
        this.saveBoard();
        closePicker();
      };
    };

    renderCalendar();
  }

  private checkRemovePriorityOnCompleted(
    card: KanbanCard,
    column: KanbanColumn,
  ) {
    if (column.title.toLowerCase() === "completed") {
      const removePriority = this.getRemovePriorityOnCompleted();
      if (removePriority) {
        delete card.priority;
      }
    }
  }

  private hasActiveFilters(): boolean {
    if (!this.boardFilter) return false;
    const hasPriorities = this.boardFilter.priorities.length > 0;
    const hasSorting = this.boardFilter.sortType !== "none";
    return hasPriorities || hasSorting;
  }

  private renderFilterPopover() {
    let popover = this.boardEl.querySelector(
      ".kanban-filter-popover",
    ) as HTMLElement;
    if (!popover) {
      popover = this.boardEl.createDiv("kanban-filter-popover");

      const clickOutsideHandler = (e: MouseEvent) => {
        const btn = this.boardEl.querySelector(".kanban-filter-btn");
        if (
          !popover.contains(e.target as Node) &&
          (!btn || !btn.contains(e.target as Node))
        ) {
          this.isFilterPopoverOpen = false;
          popover.remove();
          document.removeEventListener("click", clickOutsideHandler);
        }
      };
      setTimeout(() => {
        document.addEventListener("click", clickOutsideHandler);
      }, 0);
    } else {
      popover.empty();
    }

    popover.onclick = (e) => e.stopPropagation();

    // Section 1: Columns
    popover.createEl("h4", { text: "Apply Filter To Columns" });
    const colsContainer = popover.createDiv(
      "kanban-filter-section columns-section",
    );

    const allActive =
      this.boardFilter.columns.includes("all") ||
      this.boardFilter.columns.length === 0;
    const allPill = colsContainer.createDiv(
      "kanban-filter-pill" + (allActive ? " is-active" : ""),
    );
    allPill.createSpan({ text: "All Columns" });
    allPill.onclick = () => {
      this.boardFilter.columns = ["all"];
      this.renderBoardBody();
      this.saveBoard();
    };

    this.kanbanData.columns.forEach((col) => {
      const isColActive =
        !allActive && this.boardFilter.columns.includes(col.id);
      const colPill = colsContainer.createDiv(
        "kanban-filter-pill" + (isColActive ? " is-active" : ""),
      );
      colPill.createSpan({ text: col.title });
      colPill.onclick = () => {
        if (allActive) {
          this.boardFilter.columns = [col.id];
        } else {
          if (isColActive) {
            this.boardFilter.columns = this.boardFilter.columns.filter(
              (id) => id !== col.id,
            );
            if (this.boardFilter.columns.length === 0) {
              this.boardFilter.columns = ["all"];
            }
          } else {
            this.boardFilter.columns.push(col.id);
          }
        }
        this.renderBoardBody();
        this.saveBoard();
      };
    });

    // Section 2: Priorities
    popover.createEl("h4", { text: "Filter by Priority" });
    const priorityContainer = popover.createDiv(
      "kanban-filter-section priority-section",
    );
    const priorities: Priority[] = ["critical", "high", "medium", "low"];

    priorities.forEach((p) => {
      const isPActive = this.boardFilter.priorities.includes(p);
      const pPill = priorityContainer.createDiv(
        `kanban-filter-pill priority-${p}` + (isPActive ? " is-active" : ""),
      );
      pPill.createSpan({ text: p.charAt(0).toUpperCase() + p.slice(1) });
      pPill.onclick = () => {
        if (isPActive) {
          this.boardFilter.priorities = this.boardFilter.priorities.filter(
            (x) => x !== p,
          );
        } else {
          this.boardFilter.priorities.push(p);
        }
        this.renderBoardBody();
        this.saveBoard();
      };
    });

    // Section 3: Sorting
    popover.createEl("h4", { text: "Sort Cards By" });
    const sortContainer = popover.createDiv(
      "kanban-filter-section sort-section",
    );

    const sortOptions: { type: SortType; label: string; icon: string }[] = [
      { type: "none", label: "Default", icon: "refresh-cw" },
      { type: "alphabetical", label: "Alphabetical", icon: "type" },
      { type: "deadline", label: "Due Date", icon: "calendar" },
      { type: "created", label: "Date Created", icon: "clock" },
      { type: "priority", label: "Priority", icon: "flag" },
    ];

    sortOptions.forEach((opt) => {
      const isSortActive = this.boardFilter.sortType === opt.type;
      const sortPill = sortContainer.createDiv(
        "kanban-filter-pill" + (isSortActive ? " is-active" : ""),
      );
      setIcon(sortPill, opt.icon);
      const labelText =
        opt.type === "none"
          ? "Default"
          : `${opt.label} (${this.boardFilter.sortOrder === "asc" ? "Asc" : "Desc"})`;
      sortPill.createSpan({ text: labelText });
      sortPill.onclick = () => {
        if (opt.type === "none") {
          this.boardFilter.sortType = "none";
        } else if (isSortActive) {
          this.boardFilter.sortOrder =
            this.boardFilter.sortOrder === "asc" ? "desc" : "asc";
        } else {
          this.boardFilter.sortType = opt.type;
        }
        this.renderBoardBody();
        this.saveBoard();
      };
    });

    // Section 4: Clear Button
    if (this.hasActiveFilters()) {
      popover.createEl("hr");
      const clearBtn = popover.createEl("button", {
        cls: "kanban-filter-clear-btn",
        text: "Clear All Filters",
      });
      clearBtn.onclick = () => {
        this.boardFilter = {
          columns: ["all"],
          priorities: [],
          sortType: "none",
          sortOrder: "asc",
        };
        this.renderBoardBody();
        this.saveBoard();
      };
    }
  }

  private openColumnActionsMenu(column: KanbanColumn, e: MouseEvent) {
    const menu = new Menu();

    if (this.plugin.settings.useMantleIcons) {
      menu.addItem((item) => {
        item
          .setTitle("Set List Icon")
          .setIcon("image")
          .onClick(() => {
            new KanbanIconPickerModal(this.app, (selectedIcon) => {
              column.icon = selectedIcon;
              this.render();
              this.saveBoard();
            }).open();
          });
      });
    }

    menu.addItem((item) => {
      item
        .setTitle("Set List Colour")
        .setIcon("palette")
        .onClick(() => {
          new ColumnColorModal(this.app, column, (selectedColor) => {
            column.color = selectedColor;
            this.render();
            this.saveBoard();
          }).open();
        });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle("Archive list")
        .setIcon("archive")
        .onClick(() => {
          if (
            confirm(
              `Archive all cards in list "${column.title}" and archive the list?`,
            )
          ) {
            this.archiveList(column);
          }
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Duplicate list")
        .setIcon("copy")
        .onClick(() => {
          this.duplicateList(column);
        });
    });

    menu.addSeparator();

    const otherColumns = this.kanbanData.columns.filter(
      (c) => c.id !== column.id,
    );
    if (otherColumns.length > 0) {
      otherColumns.forEach((otherCol) => {
        menu.addItem((item) => {
          item
            .setTitle(`Move all cards to "${otherCol.title}"`)
            .setIcon("arrow-right-left")
            .onClick(() => {
              otherCol.cards.push(...column.cards);
              otherCol.cards.forEach((card) =>
                this.checkRemovePriorityOnCompleted(card, otherCol),
              );
              column.cards = [];
              this.render();
              this.saveBoard();
            });
        });
      });
    }

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle("Delete all cards in list")
        .setIcon("trash")
        .onClick(() => {
          if (
            confirm(`Permanently delete all cards in list "${column.title}"?`)
          ) {
            column.cards = [];
            this.render();
            this.saveBoard();
          }
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Delete list")
        .setIcon("trash-2")
        .onClick(() => {
          this.deleteList(column);
        });
    });

    menu.showAtMouseEvent(e);
  }

  private showCardContextMenu(
    card: KanbanCard,
    column: KanbanColumn,
    e: MouseEvent,
  ) {
    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle("Edit Card")
        .setIcon("pencil")
        .onClick(() => {
          this.editCard(card);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Archive Card")
        .setIcon("archive")
        .onClick(() => {
          this.archiveCard(card, column);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Duplicate Card")
        .setIcon("copy")
        .onClick(() => {
          this.duplicateCard(card, column);
        });
    });

    menu.addSeparator();

    const otherColumns = this.kanbanData.columns.filter(
      (c) => c.id !== column.id,
    );
    if (otherColumns.length > 0) {
      otherColumns.forEach((otherCol) => {
        menu.addItem((item) => {
          item
            .setTitle(`Move to "${otherCol.title}"`)
            .setIcon("arrow-right-left")
            .onClick(() => {
              column.cards = column.cards.filter((c) => c.id !== card.id);
              otherCol.cards.push(card);
              this.render();
              this.saveBoard();
            });
        });
      });
    }

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle("Delete Card")
        .setIcon("trash-2")
        .onClick(() => {
          if (confirm(`Delete card "${card.title}"?`)) {
            column.cards = column.cards.filter((c) => c !== card);
            this.render();
            this.saveBoard();
          }
        });
    });

    menu.showAtMouseEvent(e);
  }

  private archiveCard(card: KanbanCard, column: KanbanColumn) {
    if (!this.kanbanData.metadata) this.kanbanData.metadata = {};
    if (!this.kanbanData.metadata["archived-cards"])
      this.kanbanData.metadata["archived-cards"] = [];

    const archivedCard: any = {
      ...card,
      originalColumnId: column.id,
      originalColumnTitle: column.title,
    };
    this.kanbanData.metadata["archived-cards"].push(archivedCard);
    column.cards = column.cards.filter((c) => c.id !== card.id);

    this.render();
    this.saveBoard();
  }

  private archiveColumnCards(column: KanbanColumn) {
    if (!this.kanbanData.metadata) this.kanbanData.metadata = {};
    if (!this.kanbanData.metadata["archived-cards"])
      this.kanbanData.metadata["archived-cards"] = [];

    for (const card of column.cards) {
      const archivedCard: any = {
        ...card,
        originalColumnId: column.id,
        originalColumnTitle: column.title,
      };
      this.kanbanData.metadata["archived-cards"].push(archivedCard);
    }
    column.cards = [];

    this.render();
    this.saveBoard();
  }

  private archiveList(column: KanbanColumn) {
    if (!this.kanbanData.metadata) this.kanbanData.metadata = {};
    if (!this.kanbanData.metadata["archived-cards"])
      this.kanbanData.metadata["archived-cards"] = [];

    // Archive all cards first
    column.cards.forEach((card) => {
      const archivedCard: any = {
        ...card,
        originalColumnId: column.id,
        originalColumnTitle: column.title,
      };
      this.kanbanData.metadata!["archived-cards"].push(archivedCard);
    });

    if (!this.kanbanData.metadata["archived-columns"])
      this.kanbanData.metadata["archived-columns"] = [];

    this.kanbanData.metadata["archived-columns"].push({
      ...column,
      cards: [], // Cards are already archived
      archivedAt: Date.now(),
    });

    this.kanbanData.columns = this.kanbanData.columns.filter(
      (c) => c.id !== column.id,
    );
    this.render();
    this.saveBoard();
  }

  private duplicateList(column: KanbanColumn) {
    const newColumn: KanbanColumn = {
      ...column,
      id: Math.random().toString(36).substring(2, 9),
      title: `${column.title} (Copy)`,
      cards: column.cards.map((card) => ({
        ...card,
        id: Math.random().toString(36).substring(2, 9),
      })),
    };
    const index = this.kanbanData.columns.indexOf(column);
    this.kanbanData.columns.splice(index + 1, 0, newColumn);
    this.render();
    this.saveBoard();
  }

  private duplicateCard(card: KanbanCard, column: KanbanColumn) {
    const newCard: KanbanCard = {
      ...card,
      id: Math.random().toString(36).substring(2, 9),
      title: `${card.title} (Copy)`,
      createdAt: Date.now(),
    };
    const index = column.cards.indexOf(card);
    column.cards.splice(index + 1, 0, newCard);
    this.render();
    this.saveBoard();
  }

  private highlightTextNodes(el: HTMLElement, query: string) {
    if (!query) return;
    const regex = new RegExp(`(${this.escapeRegExp(query)})`, "gi");

    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes: Text[] = [];
    let node;
    while ((node = walk.nextNode())) {
      nodes.push(node as Text);
    }

    for (const textNode of nodes) {
      const parent = textNode.parentNode;
      if (!parent) continue;
      if (
        parent.nodeName === "MARK" ||
        (parent as HTMLElement).classList.contains("kanban-search-highlight")
      )
        continue;

      const text = textNode.nodeValue || "";
      if (regex.test(text)) {
        const fragment = document.createDocumentFragment();
        const parts = text.split(regex);
        for (const part of parts) {
          if (part.toLowerCase() === query.toLowerCase()) {
            const mark = document.createElement("mark");
            mark.className = "kanban-search-highlight";
            mark.textContent = part;
            fragment.appendChild(mark);
          } else {
            fragment.appendChild(document.createTextNode(part));
          }
        }
        parent.replaceChild(fragment, textNode);
      }
    }
  }

  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  getDateFormat(): string {
    if (this.file) {
      const boardSettings =
        this.plugin.settings.boardSettings?.[this.file.path];
      if (boardSettings?.dateFormat && boardSettings.dateFormat !== "default") {
        return boardSettings.dateFormat;
      }
    }
    return this.plugin.settings.dateFormat || "YYYY-MM-DD";
  }

  getFormattedDeadline(deadline?: string): string {
    if (!deadline) return "";
    const format = this.getDateFormat();
    return formatDate(deadline, format);
  }
}

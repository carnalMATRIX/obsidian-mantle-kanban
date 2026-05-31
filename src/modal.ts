import {
  App,
  Modal,
  TextComponent,
  ButtonComponent,
  DropdownComponent,
  setIcon,
  TFile,
  Platform,
  FuzzySuggestModal,
  FuzzyMatch,
} from "obsidian";
import { KanbanCard, Priority, KanbanColumn } from "./types";
import MantleKanban from "./main";
import { formatDate } from "./utils";
import { icons, createElement } from "lucide";

const ALL_ICONS = Object.keys(icons);

export function getKeyLabel(
  key: "mod" | "shift" | "alt" | "ctrl" | "enter" | "esc",
): string {
  const isMac = Platform.isMacOS || Platform.isIosApp;

  const macMap = {
    mod: "⌘",
    shift: "⇧",
    alt: "⌥",
    ctrl: "⌃",
    enter: "Return",
    esc: "Esc",
  };

  const winMap = {
    mod: "Ctrl",
    shift: "Shift",
    alt: "Alt",
    ctrl: "Ctrl",
    enter: "Enter",
    esc: "Esc",
  };

  return isMac ? macMap[key] : winMap[key];
}
import {
  EditorView,
  keymap,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  highlightActiveLine,
} from "@codemirror/view";
import { EditorState, Extension } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";

export class InputModal extends Modal {
  private result: string | null = null;
  private onSubmit: (result: string | null) => void;
  private title: string;
  private placeholder: string;
  private value: string;

  constructor(
    app: App,
    title: string,
    placeholder: string,
    value: string,
    onSubmit: (result: string | null) => void,
  ) {
    super(app);
    this.title = title;
    this.placeholder = placeholder;
    this.value = value;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("kanban-input-modal");
    contentEl.createEl("h2", { text: this.title });

    const fieldContainer = contentEl.createDiv("kanban-modal-field-container");
    const textInput = new TextComponent(fieldContainer)
      .setPlaceholder(this.placeholder)
      .setValue(this.value);

    textInput.inputEl.style.width = "100%";

    const btnContainer = contentEl.createDiv("kanban-modal-buttons");

    new ButtonComponent(btnContainer).setButtonText("Cancel").onClick(() => {
      this.close();
    });

    new ButtonComponent(btnContainer)
      .setButtonText("Submit")
      .setCta()
      .onClick(() => {
        this.result = textInput.getValue();
        this.close();
      });

    textInput.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.result = textInput.getValue();
        this.close();
      }
    });

    textInput.inputEl.focus();
  }

  onClose() {
    this.onSubmit(this.result);
    this.contentEl.empty();
  }
}

export class CardModal extends Modal {
  private card: KanbanCard;
  private onSubmit: (card: KanbanCard) => void;
  private onConvert?: () => void;
  private isNew: boolean;
  private editorView!: EditorView;

  private onAddAndCreateNew?: () => void;

  constructor(
    app: App,
    card: KanbanCard,
    onSubmit: (card: KanbanCard) => void,
    onConvert?: () => void,
    isNew: boolean = false,
    onAddAndCreateNew?: () => void,
  ) {
    super(app);
    this.card = { ...card };
    this.onSubmit = onSubmit;
    this.onConvert = onConvert;
    this.isNew = isNew;
    this.onAddAndCreateNew = onAddAndCreateNew;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("kanban-card-modal");
    contentEl.createEl("h2", {
      text: this.isNew ? "Add New Card" : "Edit Card",
    });

    // Title
    const titleContainer = contentEl.createDiv("kanban-modal-field-container");
    titleContainer.createEl("label", { text: "Title" });
    const titleInput = new TextComponent(titleContainer)
      .setValue(this.card.title)
      .setPlaceholder("Enter card title...")
      .onChange((val) => (this.card.title = val));
    titleInput.inputEl.focus();

    // Prevent default Enter behavior inside title input to handle quick submission
    titleInput.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey && this.isNew && this.onAddAndCreateNew) {
          this.submitAndCreateNew();
        } else {
          this.onSubmit(this.card);
          this.close();
        }
      }
    });

    // Add keydown listener on the modal root to support quick actions (Enter and Shift+Enter)
    contentEl.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".cm-editor")) return; // ignore typing in markdown description editor

      if (e.key === "Enter") {
        if (target.tagName === "BUTTON" || target.tagName === "TEXTAREA")
          return;
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey && this.isNew && this.onAddAndCreateNew) {
          this.submitAndCreateNew();
        } else {
          this.onSubmit(this.card);
          this.close();
        }
      }
    });

    // Content Editor
    const contentContainer = contentEl.createDiv(
      "kanban-modal-field-container",
    );
    contentContainer.createEl("label", { text: "Content" });

    // Toolbar
    const toolbar = contentContainer.createDiv("kanban-formatting-toolbar");
    this.createToolbarBtn(toolbar, "bold", "**", "**", "Bold");
    this.createToolbarBtn(toolbar, "italic", "_", "_", "Italic");
    this.createToolbarBtn(toolbar, "underline", "<u>", "</u>", "Underline");
    this.createToolbarBtn(toolbar, "list", "- ", "", "Bullet List");
    this.createToolbarBtn(toolbar, "check-square", "- [ ] ", "", "Task List");

    const editorContainer = contentContainer.createDiv(
      "kanban-editor-container",
    );

    this.editorView = new EditorView({
      state: EditorState.create({
        doc: this.card.content,
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
            {
              key: "Mod-b",
              run: () => {
                this.applyFormatting("**", "**");
                return true;
              },
            },
            {
              key: "Mod-i",
              run: () => {
                this.applyFormatting("_", "_");
                return true;
              },
            },
            {
              key: "Mod-u",
              run: () => {
                this.applyFormatting("<u>", "</u>");
                return true;
              },
            },
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...lintKeymap,
            indentWithTab,
          ]),
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.card.content = update.state.doc.toString();
            }
          }),
          this.getTheme(),
        ],
      }),
      parent: editorContainer,
    });

    // Priority & Deadline (Side by side)
    const row1 = contentEl.createDiv({
      cls: "kanban-modal-row",
      attr: { style: "display: flex; gap: 20px;" },
    });

    const priorityContainer = row1.createDiv("kanban-modal-field-container");
    priorityContainer.style.flex = "1";
    priorityContainer.createEl("label", { text: "Priority" });
    new DropdownComponent(priorityContainer)
      .addOption("none", "None")
      .addOption("low", "Low")
      .addOption("medium", "Medium")
      .addOption("high", "High")
      .addOption("critical", "Critical")
      .setValue(this.card.priority || "none")
      .onChange((val) => {
        this.card.priority = val === "none" ? undefined : (val as Priority);
      });

    const deadlineContainer = row1.createDiv("kanban-modal-field-container");
    deadlineContainer.style.flex = "1";
    deadlineContainer.createEl("label", { text: "Deadline" });
    const deadlineInput = deadlineContainer.createEl("input", {
      type: "date",
      value: this.card.deadline || "",
      cls: "kanban-date-input",
    });
    deadlineInput.style.width = "100%";
    deadlineInput.addEventListener("change", () => {
      this.card.deadline = deadlineInput.value || undefined;
    });

    // Linked File Actions
    const linkContainer = contentEl.createDiv("kanban-modal-field-container");
    linkContainer.createEl("label", { text: "Linked Document" });

    if (this.card.linkedFile) {
      const well = linkContainer.createDiv("kanban-link-well");

      const info = well.createDiv("kanban-link-info");
      setIcon(info, "file-text");
      info.createSpan({ text: this.card.linkedFile });

      const removeBtn = well.createDiv("kanban-link-action-btn");
      setIcon(removeBtn, "trash-2");
      removeBtn.setAttribute("aria-label", "Remove Link");
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        this.card.linkedFile = undefined;
        this.onOpen(); // Re-render
      };
    } else if (this.onConvert && !this.isNew) {
      const convertBtn = new ButtonComponent(linkContainer)
        .setButtonText("Convert to Markdown File")
        .setClass("kanban-modal-convert-btn")
        .onClick(() => {
          this.onConvert?.();
          this.close();
        });
      convertBtn.buttonEl.style.width = "100%";
    } else if (this.isNew) {
      const info = linkContainer.createDiv({
        cls: "kanban-modal-info-text",
        text: "Create card first to link a file.",
      });
      info.style.fontSize = "0.85em";
      info.style.color = "var(--text-muted)";
      info.style.fontStyle = "italic";
    }

    // Buttons
    const btnContainer = contentEl.createDiv("kanban-modal-buttons");

    const cancelBtn = new ButtonComponent(btnContainer)
      .setButtonText(" Cancel")
      .onClick(() => this.close());
    const cancelKbdGroup = cancelBtn.buttonEl.createSpan("kanban-kbd-group");
    const cancelKbd = cancelKbdGroup.createEl("kbd", {
      text: getKeyLabel("esc"),
    });
    cancelKbd.addClass("plugin-kbd-style");
    cancelBtn.buttonEl.prepend(cancelKbdGroup);

    if (this.isNew && this.onAddAndCreateNew) {
      const addCreateBtn = btnContainer.createEl("button", {
        cls: "mod-secondary kanban-modal-btn-with-icon",
      });
      const addCreateKbdGroup = addCreateBtn.createSpan("kanban-kbd-group");
      const shiftKbd = addCreateKbdGroup.createEl("kbd", {
        text: getKeyLabel("shift"),
      });
      shiftKbd.addClass("plugin-kbd-style");
      const enterKbd = addCreateKbdGroup.createEl("kbd", {
        text: getKeyLabel("enter"),
      });
      enterKbd.addClass("plugin-kbd-style");
      addCreateBtn.createSpan({ text: " Add & Create" });
      addCreateBtn.onclick = () => this.submitAndCreateNew();
    }

    const submitBtn = btnContainer.createEl("button", {
      cls: "mod-cta kanban-modal-btn-with-icon",
    });
    const submitKbdGroup = submitBtn.createSpan("kanban-kbd-group");
    const submitKbd = submitKbdGroup.createEl("kbd", {
      text: getKeyLabel("enter"),
    });
    submitKbd.addClass("plugin-kbd-style");
    submitBtn.createSpan({
      text: this.isNew ? " Add Card" : " Save Changes",
    });
    submitBtn.onclick = () => {
      this.onSubmit(this.card);
      this.close();
    };
  }

  private submitAndCreateNew() {
    this.onSubmit(this.card);
    this.close();
    if (this.onAddAndCreateNew) {
      this.onAddAndCreateNew();
    }
  }

  onClose() {
    this.editorView?.destroy();
    this.contentEl.empty();
  }

  private getTheme(): Extension {
    const isDark = document.body.classList.contains("theme-dark");
    const accentColor = isDark ? "#b39ddb" : "#d81b60"; // Indigo (Dark) / Red (Light) matching tabs

    return EditorView.theme({
      "&": {
        height: "200px",
        backgroundColor: "var(--background-primary)",
        border: "1px solid var(--background-modifier-border)",
        borderRadius: "0 0 8px 8px",
        fontSize: "0.95em",
      },
      "&.cm-focused": {
        outline: "none",
        borderColor: "var(--interactive-accent)",
      },
      ".cm-content": {
        fontFamily: "var(--font-text)",
        padding: "10px",
        caretColor: accentColor,
        lineHeight: "1.4",
      },
      ".cm-line": {
        padding: "0 10px",
        margin: "0",
      },
      ".cm-content p": {
        margin: "0",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeft: `2px solid ${accentColor}`,
      },
      ".cm-activeLine": {
        backgroundColor: isDark
          ? "rgba(179, 157, 219, 0.05)"
          : "rgba(216, 27, 96, 0.05)",
      },
      ".cm-gutters": {
        display: "none",
      },
      // Styling for Markdown elements when they are revealed
      ".cm-m-strong": { fontWeight: "bold" },
      ".cm-m-em": { fontStyle: "italic" },
      ".cm-m-header": { color: "var(--text-accent)", fontWeight: "bold" },
    });
  }

  private applyFormatting(prefix: string, suffix: string) {
    const selection = this.editorView.state.selection.main;
    const slice = this.editorView.state.sliceDoc(selection.from, selection.to);
    const insert = prefix + slice + suffix;

    this.editorView.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: {
        anchor: selection.from + prefix.length,
        head: selection.to + prefix.length,
      },
    });
    this.editorView.focus();
  }

  private createToolbarBtn(
    parent: HTMLElement,
    icon: string,
    prefix: string,
    suffix: string,
    tooltip: string,
  ) {
    const btn = parent.createDiv("kanban-toolbar-btn");
    setIcon(btn, icon);
    btn.setAttribute("aria-label", tooltip);

    btn.onclick = () => {
      this.applyFormatting(prefix, suffix);
    };
  }
}

export class BoardSettingsModal extends Modal {
  private file: TFile;
  private plugin: MantleKanban;
  private kanbanData: any;
  private onSave: () => void;

  constructor(
    app: App,
    file: TFile,
    plugin: MantleKanban,
    kanbanData: any,
    onSave: () => void,
  ) {
    super(app);
    this.file = file;
    this.plugin = plugin;
    this.kanbanData = kanbanData;
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("kanban-settings-modal");
    contentEl.createEl("h2", { text: `Board Settings: ${this.file.basename}` });

    // Retrieve current board settings
    const currentSettings =
      this.plugin.settings.boardSettings[this.file.path] || {};

    let showCardVal: string = "default";
    if (currentSettings.showCardContent === true) showCardVal = "true";
    if (currentSettings.showCardContent === false) showCardVal = "false";

    let clearFiltersVal: string = "default";
    if (currentSettings.clearFiltersOnExit === true) clearFiltersVal = "true";
    if (currentSettings.clearFiltersOnExit === false) clearFiltersVal = "false";

    let removePriorityVal: string = "default";
    if (currentSettings.removePriorityOnCompleted === true)
      removePriorityVal = "true";
    if (currentSettings.removePriorityOnCompleted === false)
      removePriorityVal = "false";

    // Show Card Content Setting
    const showCardContainer = contentEl.createDiv(
      "kanban-modal-field-container",
    );
    showCardContainer.createEl("label", { text: "Show card content" });
    const showCardDropdown = new DropdownComponent(showCardContainer)
      .addOption(
        "default",
        `Default (${this.plugin.settings.showCardContent ? "Show" : "Hide"})`,
      )
      .addOption("true", "Show")
      .addOption("false", "Hide")
      .setValue(showCardVal);

    // Clear Filters Setting
    const clearFiltersContainer = contentEl.createDiv(
      "kanban-modal-field-container",
    );
    clearFiltersContainer.createEl("label", { text: "Clear filters on exit" });
    const clearFiltersDropdown = new DropdownComponent(clearFiltersContainer)
      .addOption(
        "default",
        `Default (${this.plugin.settings.clearFiltersOnExit ? "Yes" : "No"})`,
      )
      .addOption("true", "Yes")
      .addOption("false", "No")
      .setValue(clearFiltersVal);

    // Remove Priority On Completed Setting
    const removePriorityContainer = contentEl.createDiv(
      "kanban-modal-field-container",
    );
    removePriorityContainer.createEl("label", {
      text: "Remove priority on completed",
    });
    const removePriorityDropdown = new DropdownComponent(
      removePriorityContainer,
    )
      .addOption(
        "default",
        `Default (${this.plugin.settings.removePriorityOnCompleted ? "Yes" : "No"})`,
      )
      .addOption("true", "Yes")
      .addOption("false", "No")
      .setValue(removePriorityVal);

    // Date Format Setting
    const today = new Date();
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const defaultFormatLabel = this.plugin.settings.dateFormat || "YYYY-MM-DD";

    const currentDateFormat = currentSettings.dateFormat || "default";
    const dateFormatContainer = contentEl.createDiv(
      "kanban-modal-field-container",
    );
    dateFormatContainer.createEl("label", { text: "Date format" });
    const dateFormatDropdown = new DropdownComponent(dateFormatContainer)
      .addOption(
        "default",
        `Default (e.g. ${formatDate(todayISO, defaultFormatLabel)})`,
      )
      .addOption(
        "DD/MM/YYYY",
        `DD/MM/YYYY (e.g. ${formatDate(todayISO, "DD/MM/YYYY")})`,
      )
      .addOption(
        "MM/DD/YYYY",
        `MM/DD/YYYY (e.g. ${formatDate(todayISO, "MM/DD/YYYY")})`,
      )
      .addOption(
        "DD.MM.YYYY",
        `DD.MM.YYYY (e.g. ${formatDate(todayISO, "DD.MM.YYYY")})`,
      )
      .addOption(
        "YYYY/MM/DD",
        `YYYY/MM/DD (e.g. ${formatDate(todayISO, "YYYY/MM/DD")})`,
      )
      .addOption(
        "MMM D, YYYY",
        `MMM D, YYYY (e.g. ${formatDate(todayISO, "MMM D, YYYY")})`,
      )
      .addOption(
        "D MMM YYYY",
        `D MMM YYYY (e.g. ${formatDate(todayISO, "D MMM YYYY")})`,
      )
      .addOption(
        "MMMM D, YYYY",
        `MMMM D, YYYY (e.g. ${formatDate(todayISO, "MMMM D, YYYY")})`,
      )
      .addOption(
        "D MMMM YYYY",
        `D MMMM YYYY (e.g. ${formatDate(todayISO, "D MMMM YYYY")})`,
      )
      .addOption(
        "ddd DD MMM",
        `ddd DD MMM (e.g. ${formatDate(todayISO, "ddd DD MMM")})`,
      )
      .setValue(currentDateFormat);

    // View Archived Cards Button
    const archiveContainer = contentEl.createDiv(
      "kanban-modal-field-container",
    );
    archiveContainer.createEl("label", { text: "Archived Items" });

    const archiveBtnsRow = archiveContainer.createDiv({
      attr: {
        style: "display: flex; gap: 10px; width: 100%; margin-top: 4px;",
      },
    });

    const viewArchiveBtn = new ButtonComponent(archiveBtnsRow)
      .setButtonText("View Archived Cards")
      .onClick(() => {
        new ArchivedCardsModal(
          this.app,
          this.file,
          this.plugin,
          this.kanbanData,
          () => {
            this.onSave();
          },
        ).open();
      });
    viewArchiveBtn.buttonEl.style.flex = "1";

    const archiveAllBtn = new ButtonComponent(archiveBtnsRow)
      .setButtonText("Archive All Board Cards")
      .onClick(() => {
        if (
          confirm("Are you sure you want to archive all cards on the board?")
        ) {
          if (!this.kanbanData.metadata) this.kanbanData.metadata = {};
          if (!this.kanbanData.metadata["archived-cards"])
            this.kanbanData.metadata["archived-cards"] = [];

          for (const column of this.kanbanData.columns) {
            for (const card of column.cards) {
              const archivedCard: any = {
                ...card,
                originalColumnId: column.id,
                originalColumnTitle: column.title,
              };
              this.kanbanData.metadata["archived-cards"].push(archivedCard);
            }
            column.cards = [];
          }
          this.onSave();
          this.close();
        }
      });
    archiveAllBtn.buttonEl.style.flex = "1";
    archiveAllBtn.buttonEl.style.color = "var(--text-error)";

    // Buttons
    const btnContainer = contentEl.createDiv("kanban-modal-buttons");

    new ButtonComponent(btnContainer)
      .setButtonText("Cancel")
      .onClick(() => this.close());

    new ButtonComponent(btnContainer)
      .setButtonText("Save")
      .setCta()
      .onClick(async () => {
        const showCard = showCardDropdown.getValue();
        const clearFilters = clearFiltersDropdown.getValue();
        const removePriority = removePriorityDropdown.getValue();
        const dateFormat = dateFormatDropdown.getValue();

        const boardConfig: any = {};
        if (showCard === "true") boardConfig.showCardContent = true;
        else if (showCard === "false") boardConfig.showCardContent = false;

        if (clearFilters === "true") boardConfig.clearFiltersOnExit = true;
        else if (clearFilters === "false")
          boardConfig.clearFiltersOnExit = false;

        if (removePriority === "true")
          boardConfig.removePriorityOnCompleted = true;
        else if (removePriority === "false")
          boardConfig.removePriorityOnCompleted = false;

        if (dateFormat !== "default") {
          boardConfig.dateFormat = dateFormat;
        }

        if (Object.keys(boardConfig).length > 0) {
          this.plugin.settings.boardSettings[this.file.path] = boardConfig;
        } else {
          delete this.plugin.settings.boardSettings[this.file.path];
        }

        await this.plugin.saveSettings();
        this.onSave();
        this.close();
      });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class ArchivedCardsModal extends Modal {
  private file: TFile;
  private plugin: MantleKanban;
  private kanbanData: any;
  private onUpdate: () => void;

  constructor(
    app: App,
    file: TFile,
    plugin: MantleKanban,
    kanbanData: any,
    onUpdate: () => void,
  ) {
    super(app);
    this.file = file;
    this.plugin = plugin;
    this.kanbanData = kanbanData;
    this.onUpdate = onUpdate;
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("kanban-archived-cards-modal");
    contentEl.createEl("h2", { text: `Archived Cards: ${this.file.basename}` });

    const archivedCards: any[] =
      this.kanbanData.metadata?.["archived-cards"] || [];

    if (archivedCards.length === 0) {
      contentEl.createEl("p", {
        text: "No archived cards found on this board.",
        cls: "kanban-modal-empty-text",
      });
      return;
    }

    const cardsContainer = contentEl.createDiv("kanban-archived-cards-list");
    cardsContainer.style.maxHeight = "400px";
    cardsContainer.style.overflowY = "auto";
    cardsContainer.style.marginBottom = "20px";

    for (let i = 0; i < archivedCards.length; i++) {
      const card = archivedCards[i];
      const row = cardsContainer.createDiv("kanban-archived-card-row");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.padding = "8px 12px";
      row.style.borderBottom = "1px solid var(--background-modifier-border)";

      const info = row.createDiv("kanban-archived-card-info");
      info.createEl("strong", { text: card.title });
      if (card.originalColumnTitle) {
        info.createEl("span", {
          text: ` (from: ${card.originalColumnTitle})`,
          attr: { style: "font-size: 0.85em; color: var(--text-muted);" },
        });
      }

      const actions = row.createDiv("kanban-archived-card-actions");
      actions.style.display = "flex";
      actions.style.gap = "8px";

      // Restore button
      const restoreBtn = actions.createEl("button", {
        cls: "mod-secondary",
        text: "Restore",
      });
      setIcon(restoreBtn, "rotate-ccw");
      restoreBtn.onclick = () => {
        let targetCol = this.kanbanData.columns.find(
          (c: any) => c.id === card.originalColumnId,
        );
        if (!targetCol && card.originalColumnTitle) {
          targetCol = this.kanbanData.columns.find(
            (c: any) =>
              c.title.toLowerCase() === card.originalColumnTitle.toLowerCase(),
          );
        }
        if (!targetCol && this.kanbanData.columns.length > 0) {
          targetCol = this.kanbanData.columns[0];
        }

        if (targetCol) {
          const restoredCard: any = {
            id: card.id,
            title: card.title,
            content: card.content,
            completed: card.completed,
            createdAt: card.createdAt,
          };
          if (card.priority) restoredCard.priority = card.priority;
          if (card.deadline) restoredCard.deadline = card.deadline;
          if (card.linkedFile) restoredCard.linkedFile = card.linkedFile;

          targetCol.cards.push(restoredCard);
        }

        this.kanbanData.metadata["archived-cards"] = this.kanbanData.metadata[
          "archived-cards"
        ].filter((c: any) => c.id !== card.id);
        this.onUpdate();
        this.render();
      };

      // Delete button
      const deleteBtn = actions.createEl("button", {
        cls: "mod-warning",
        text: "Delete",
      });
      setIcon(deleteBtn, "trash-2");
      deleteBtn.onclick = () => {
        if (confirm(`Permanently delete archived card "${card.title}"?`)) {
          this.kanbanData.metadata["archived-cards"] = this.kanbanData.metadata[
            "archived-cards"
          ].filter((c: any) => c.id !== card.id);
          this.onUpdate();
          this.render();
        }
      };
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class ColumnColorModal extends Modal {
  private column: KanbanColumn;
  private onSelect: (color: string | undefined) => void;

  constructor(
    app: App,
    column: KanbanColumn,
    onSelect: (color: string | undefined) => void,
  ) {
    super(app);
    this.column = column;
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("kanban-color-picker-modal");
    contentEl.createEl("h2", { text: `Set Color: ${this.column.title}` });

    const colorsList = [
      // Shifting from standard purple to a deep, neon violet that matches your active state accents
      {
        name: "Mantle Purple",
        id: "purple",
        colorLight: "#c026d3",
        colorDark: "#d946ef",
      },

      // Shifting from standard pink to a vibrant magenta/rose to match the sidebar selection color
      {
        name: "Vibe Rose",
        id: "rose",
        colorLight: "#db2777",
        colorDark: "#fda4af",
      },

      // A muted, classy slate blue that integrates perfectly with the dark UI borders
      {
        name: "Steel Blue",
        id: "blue",
        colorLight: "#2563eb",
        colorDark: "#60a5fa",
      },

      // A glowing, cyber mint green instead of standard grass green—pops nicely on dark, looks crisp on cream
      {
        name: "Mint Green",
        id: "green",
        colorLight: "#059669",
        colorDark: "#34d399",
      },

      // Replacing harsh yellow/amber with a warm, rich gold/bronze that contrasts beautifully with the dark slate
      {
        name: "Zenith Gold",
        id: "gold",
        colorLight: "#b45309",
        colorDark: "#fbbf24",
      },

      // A moody, deep terracotta/crimson for alert states like "In Progress" or "Critical" tags
      {
        name: "Terracotta",
        id: "crimson",
        colorLight: "#dc2626",
        colorDark: "#fca5a5",
      },

      // An elegant lavender/indigo that bridges the gap between the purple accents and text elements
      {
        name: "Lavender",
        id: "lavender",
        colorLight: "#6d28d9",
        colorDark: "#c084fc",
      },

      // A deep cyber teal that provides a refreshing contrast to the dominant pink/purple theme accents
      {
        name: "Ocean Teal",
        id: "teal",
        colorLight: "#0891b2",
        colorDark: "#22d3ee",
      },
    ];

    const gridContainer = contentEl.createDiv("kanban-color-grid");
    gridContainer.style.display = "grid";
    gridContainer.style.gridTemplateColumns = "repeat(5, 1fr)";
    gridContainer.style.gap = "12px";
    gridContainer.style.margin = "20px 0";

    const isDark = document.body.classList.contains("theme-dark");

    colorsList.forEach((colorOpt) => {
      const colorBubble = gridContainer.createDiv("kanban-color-bubble");
      colorBubble.style.display = "flex";
      colorBubble.style.flexDirection = "column";
      colorBubble.style.alignItems = "center";
      colorBubble.style.cursor = "pointer";
      colorBubble.style.padding = "8px";
      colorBubble.style.borderRadius = "8px";
      colorBubble.style.transition = "background-color 0.2s";
      colorBubble.style.textAlign = "center";

      const circle = colorBubble.createDiv();
      circle.style.width = "32px";
      circle.style.height = "32px";
      circle.style.borderRadius = "50%";
      circle.style.backgroundColor = isDark
        ? colorOpt.colorDark
        : colorOpt.colorLight;
      circle.style.border =
        this.column.color === colorOpt.id
          ? "3px solid var(--interactive-accent)"
          : "1px solid var(--background-modifier-border)";
      circle.style.boxShadow =
        this.column.color === colorOpt.id
          ? "0 0 8px var(--interactive-accent)"
          : "none";

      const label = colorBubble.createSpan({ text: colorOpt.name });
      label.style.fontSize = "0.75em";
      label.style.marginTop = "6px";
      label.style.color = "var(--text-muted)";

      colorBubble.addEventListener("mouseenter", () => {
        colorBubble.style.backgroundColor = "var(--background-modifier-hover)";
      });
      colorBubble.addEventListener("mouseleave", () => {
        colorBubble.style.backgroundColor = "transparent";
      });

      colorBubble.addEventListener("click", () => {
        this.onSelect(colorOpt.id);
        this.close();
      });
    });

    const btnContainer = contentEl.createDiv("kanban-modal-buttons");

    new ButtonComponent(btnContainer)
      .setButtonText("Reset to Default")
      .onClick(() => {
        this.onSelect(undefined);
        this.close();
      });

    new ButtonComponent(btnContainer).setButtonText("Cancel").onClick(() => {
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class KanbanIconPickerModal extends FuzzySuggestModal<string> {
  onSelect: (iconName: string) => void;

  constructor(app: App, onSelect: (iconName: string) => void) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder("Search for a list icon...");
  }

  getItems(): string[] {
    return ALL_ICONS;
  }

  getItemText(item: string): string {
    return item.replace(/([a-z0-9])([A-Z])/g, "-$2").toLowerCase();
  }

  renderSuggestion(item: FuzzyMatch<string>, el: HTMLElement) {
    el.addClass("mantle-icon-suggestion");
    const iconDiv = el.createDiv({ cls: "suggestion-icon" });
    // @ts-ignore
    const svgElement = createElement(icons[item.item]);
    iconDiv.appendChild(svgElement);
    el.createDiv({ text: this.getItemText(item.item), cls: "suggestion-text" });
  }

  onChooseItem(item: string, evt: MouseEvent | KeyboardEvent) {
    this.onSelect(this.getItemText(item));
  }
}

import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import MantleKanban from "./main";
import { formatDate } from "./utils";

export interface BoardSettings {
  showCardContent?: boolean;
  clearFiltersOnExit?: boolean;
  removePriorityOnCompleted?: boolean;
  dateFormat?: string;
}

export interface MantleKanbanSettings {
  clearFiltersOnExit: boolean;
  showCardContent: boolean;
  removePriorityOnCompleted: boolean;
  dateFormat: string;
  useMantleIcons: boolean;
  boardSettings: Record<string, BoardSettings>;
}

export const DEFAULT_SETTINGS: MantleKanbanSettings = {
  clearFiltersOnExit: false,
  showCardContent: true,
  removePriorityOnCompleted: false,
  dateFormat: "YYYY-MM-DD",
  useMantleIcons: false,
  boardSettings: {},
};

export class MantleKanbanSettingTab extends PluginSettingTab {
  plugin: MantleKanban;

  constructor(app: App, plugin: MantleKanban) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("kanban-settings-tab");

    containerEl.createEl("h2", { text: "Mantle Kanban Settings" });

    // Check if Mantle Icons is enabled
    const isMantleIconsEnabled = (this.app as any).plugins.getPlugin(
      "mantle-icons",
    );

    if (!isMantleIconsEnabled) {
      const noticeEl = containerEl.createDiv("kanban-settings-notice info");
      setIcon(noticeEl, "info");
      noticeEl.createSpan({
        text: " Mantle Icons plugin is required for 'Use Mantle Icons'.",
      });
    }
    new Setting(containerEl)
      .setName("Use Mantle Icons")
      .setDesc(
        isMantleIconsEnabled
          ? "If enabled, you can assign custom icons from Mantle Icons to each list group."
          : "Mantle Icons plugin is not installed or enabled. Please install and enable it to use this feature.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useMantleIcons && isMantleIconsEnabled)
          .setDisabled(!isMantleIconsEnabled)
          .onChange(async (value) => {
            this.plugin.settings.useMantleIcons = value;
            await this.plugin.saveSettings();
            this.app.workspace.iterateAllLeaves((leaf) => {
              if (leaf.view.getViewType() === "mantle-kanban-view") {
                (leaf.view as any).render();
              }
            });
          }),
      );

    new Setting(containerEl)
      .setName("Show card content")
      .setDesc(
        "If enabled, the Markdown content/description of each card will be shown on the board.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showCardContent)
          .onChange(async (value) => {
            this.plugin.settings.showCardContent = value;
            await this.plugin.saveSettings();
            // Trigger a re-render of all open kanban views
            this.app.workspace.iterateAllLeaves((leaf) => {
              if (leaf.view.getViewType() === "mantle-kanban-view") {
                (leaf.view as any).render();
              }
            });
          }),
      );

    new Setting(containerEl)
      .setName("Clear filters on exit")
      .setDesc(
        "If enabled, all list filters and sorts will be cleared when you close Obsidian. Filters will not be saved to your Markdown files.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.clearFiltersOnExit)
          .onChange(async (value) => {
            this.plugin.settings.clearFiltersOnExit = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Remove priority on completed")
      .setDesc(
        "If enabled, cards placed in a 'Completed' or 'completed' list will automatically have their priority status removed.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.removePriorityOnCompleted)
          .onChange(async (value) => {
            this.plugin.settings.removePriorityOnCompleted = value;
            await this.plugin.saveSettings();
          }),
      );

    const today = new Date();
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    new Setting(containerEl)
      .setName("Date format")
      .setDesc(
        "The date format displayed in all instances of a date being shown for the plugin.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption(
            "YYYY-MM-DD",
            `Default (e.g. ${formatDate(todayISO, "YYYY-MM-DD")})`,
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
          .setValue(this.plugin.settings.dateFormat || "YYYY-MM-DD")
          .onChange(async (value) => {
            this.plugin.settings.dateFormat = value;
            await this.plugin.saveSettings();
            // Trigger a re-render of all open kanban views
            this.app.workspace.iterateAllLeaves((leaf) => {
              if (leaf.view.getViewType() === "mantle-kanban-view") {
                (leaf.view as any).render();
              }
            });
          }),
      );
  }
}

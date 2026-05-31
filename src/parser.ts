import { KanbanData, KanbanColumn, KanbanCard, Priority } from "./types";
import { parseYaml, stringifyYaml } from "obsidian";
import { MantleKanbanSettings } from "./settings";

export function parseMarkdown(markdown: string): KanbanData {
  const columns: KanbanColumn[] = [];
  let metadata: Record<string, any> = {};

  // Parse Frontmatter
  let contentStartIndex = 0;
  const trimmedMarkdown = markdown.trimStart();
  if (trimmedMarkdown.startsWith("---")) {
    const endHeaderIndex = trimmedMarkdown.indexOf("---", 3);
    if (endHeaderIndex !== -1) {
      const yamlContent = trimmedMarkdown.substring(3, endHeaderIndex).trim();
      try {
        metadata = parseYaml(yamlContent);
      } catch (e) {
        console.error("[Mantle Kanban] [ERROR] Failed to parse frontmatter YAML:", e);
      }
      // Calculate start index in ORIGINAL markdown to preserve exact offsets if needed
      contentStartIndex = markdown.indexOf("---", markdown.indexOf("---") + 3) + 3;
    }
  }

  const contentLines = markdown.substring(contentStartIndex).split("\n");
  let currentColumn: KanbanColumn | null = null;

  for (let i = 0; i < contentLines.length; i++) {
    const line = contentLines[i];
    const trimmedLine = line.trim();

    // Check for column header
    if (trimmedLine.startsWith("## ")) {
      const title = trimmedLine.substring(3).trim();
      currentColumn = {
        id: title.toLowerCase().replace(/\s+/g, "-") || Math.random().toString(36).substring(2, 9),
        title,
        cards: [],
      };
      columns.push(currentColumn);
      continue;
    }

    // Check for card (task list item)
    if (currentColumn && (trimmedLine.startsWith("- [ ]") || trimmedLine.startsWith("- [x]"))) {
      const isCompleted = trimmedLine.includes("- [x]");
      let text = trimmedLine.replace(/^[-*+]\s\[[ x]\]\s*/, "").trim();
      
      // Parse metadata markers
      let priority: Priority | undefined;
      let deadline: string | undefined;
      let linkedFile: string | undefined;
      let createdAt = Date.now();

      // Extract metadata (simple regex approach)
      const pMatch = text.match(/\^p-(low|medium|high|critical)/);
      if (pMatch) {
        priority = pMatch[1] as Priority;
        text = text.replace(pMatch[0], "").trim();
      }

      const dMatch = text.match(/\^d-(\d{4}-\d{2}-\d{2})/);
      if (dMatch) {
        deadline = dMatch[1];
        text = text.replace(dMatch[0], "").trim();
      }

      const cMatch = text.match(/\^c-(\d+)/);
      if (cMatch) {
        createdAt = parseInt(cMatch[1], 10);
        text = text.replace(cMatch[0], "").trim();
      }

      // Extract linked file [[Link]]
      const lMatch = text.match(/\[\[([^\]]+)\]\]/);
      if (lMatch) {
        linkedFile = lMatch[1];
        text = text.replace(lMatch[0], "").trim();
      }

      // Collect content (indented lines)
      let content = "";
      let j = i + 1;
      while (j < contentLines.length) {
        const nextLine = contentLines[j];
        const nextTrimmed = nextLine.trim();
        
        // Stop if we hit a new card or new column
        if (nextTrimmed.startsWith("- [ ]") || nextTrimmed.startsWith("- [x]") || nextTrimmed.startsWith("## ")) {
          break;
        }
        
        // If it's indented or empty, it's content
        if (nextLine.startsWith("  ") || nextTrimmed === "") {
          content += (nextLine.startsWith("  ") ? nextLine.substring(2) : nextLine) + "\n";
          j++;
        } else {
          // If it's not indented but also not a new card/column, maybe it's still content?
          // For robustness, if it's not a header or list item, we treat it as content
          content += nextLine + "\n";
          j++;
        }
      }
      i = j - 1;

      currentColumn.cards.push({
        id: Math.random().toString(36).substring(2, 9),
        title: text,
        content: content.trim(),
        priority,
        deadline,
        linkedFile,
        completed: isCompleted,
        createdAt
      });
    }
  }

  // Apply Column Settings from metadata
  if (metadata["column-settings"]) {
    for (const column of columns) {
      const colMeta = metadata["column-settings"][column.title];
      if (colMeta) {
        column.filter = colMeta.filter;
        column.color = colMeta.color;
        column.icon = colMeta.icon;
      }
    }
  }

  return { columns, metadata };
}

export function stringifyMarkdown(data: KanbanData, settings?: MantleKanbanSettings): string {
  const metadata = data.metadata || {};
  metadata["kanban-plugin"] = "basic";

  // Update column settings in metadata
  const columnSettings: Record<string, any> = metadata["column-settings"] || {};
  for (const column of data.columns) {
    const colConfig = columnSettings[column.title] || {};
    
    // Save color if set
    if (column.color) {
      colConfig.color = column.color;
    } else {
      delete colConfig.color;
    }

    // Save icon if set
    if (column.icon) {
      colConfig.icon = column.icon;
    } else {
      delete colConfig.icon;
    }

    // Save filter
    if (column.filter && !settings?.clearFiltersOnExit) {
      colConfig.filter = column.filter;
    } else {
      delete colConfig.filter;
    }

    if (Object.keys(colConfig).length > 0) {
      columnSettings[column.title] = colConfig;
    } else {
      delete columnSettings[column.title];
    }
  }
  if (Object.keys(columnSettings).length > 0) {
    metadata["column-settings"] = columnSettings;
  } else {
    delete metadata["column-settings"];
  }
  
  let markdown = `---\n${stringifyYaml(metadata)}---\n\n`;

  for (const column of data.columns) {
    markdown += `## ${column.title}\n`;
    for (const card of column.cards) {
      const status = card.completed ? "x" : " ";
      let title = card.title;
      
      let cardLine = `- [${status}] ${title}`;
      
      if (card.linkedFile && !title.includes(`[[${card.linkedFile}]]`)) {
        cardLine += ` [[${card.linkedFile}]]`;
      }
      
      if (card.priority) cardLine += ` ^p-${card.priority}`;
      if (card.deadline) cardLine += ` ^d-${card.deadline}`;
      cardLine += ` ^c-${card.createdAt}`;
      
      markdown += cardLine + "\n";
      
      if (card.content) {
        markdown += card.content.split("\n")
          .map(l => l.trim() === "" ? "" : `  ${l}`).join("\n") + "\n";
      }
    }
    markdown += "\n";
  }

  return markdown;
}

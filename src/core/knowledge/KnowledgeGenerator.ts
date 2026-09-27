import fs from "fs-extra";
import path from "path";

import { AQWRuntime } from "../runtime/AQWRuntimeConfig";
import { ProductMemory } from "../memory/ProductMemory";
import bundledKnowledge from "../employee/knowledge/gyansetu.json";

interface InventoryElement {
  tag?: string;
  text?: string;
  id?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  href?: string;
  visible?: boolean;
}

interface PageInventory {
  title?: string;
  requestedUrl?: string;
  finalUrl?: string;
  inputs?: InventoryElement[];
  buttons?: InventoryElement[];
  dropdowns?: InventoryElement[];
  tables?: unknown;
}

interface NavigationItem {
  text: string;
  href: string;
}

interface NavigationGroup {
  module: string;
  items: NavigationItem[];
}

export interface PageKnowledge {
  name: string;
  url: string;
  inputs: string[];
  buttons: string[];
  dropdowns: string[];
  tables: number;
}

export interface ModuleKnowledge {
  description: string;
  pageCount: number;
  pages: PageKnowledge[];
  keyControls: string[];
}

export type GeneratedKnowledge = Record<string, ModuleKnowledge>;

export interface KnowledgeGenerationResult {
  path: string;
  knowledge: GeneratedKnowledge;
}

const MAX_INPUTS = 10;
const MAX_BUTTONS = 15;
const MAX_DROPDOWNS = 8;
const MAX_KEY_CONTROLS = 20;

const NOISE_IDENTITIES = new Set([
  "text",
  "submit",
  "hidden",
  "button",
  "checkbox",
  "radio",
  "search",
]);

export class KnowledgeGenerator {
  /**
   * Derives per-module business knowledge from the discovery hierarchy and
   * page inventories, then writes it to the active product's memory at
   * memory/products/<productId>/knowledge.json.
   */
  async generate(): Promise<KnowledgeGenerationResult> {
    const productId = this.resolveProductId();

    const hierarchy = await this.loadNavigationHierarchy(productId);
    const inventories = await this.loadPageInventories(productId);
    const existing = this.loadExistingKnowledge(productId);

    const knowledge: GeneratedKnowledge = {};

    // Sidebar module buttons appear on every page; exclude them from the
    // aggregated key controls so page-specific actions surface instead.
    const moduleNames = new Set(
      hierarchy.map(group => group.module.toLowerCase())
    );

    for (const group of hierarchy) {
      const pages: PageKnowledge[] = [];
      const controlCounts = new Map<string, number>();

      for (const item of group.items) {
        if (!item.href) {
          continue;
        }

        const inventory = this.findInventory(inventories, item.href);

        if (!inventory) {
          continue;
        }

        const page = this.buildPageKnowledge(item, inventory);

        pages.push(page);
        this.tally(controlCounts, page.inputs);
        this.tally(
          controlCounts,
          page.buttons.filter(
            button => !moduleNames.has(button.toLowerCase())
          )
        );
        this.tally(controlCounts, page.dropdowns);
      }

      knowledge[group.module] = {
        description:
          this.existingDescription(existing, group.module) ??
          this.buildDescription(group.module, group.items, pages),
        pageCount: pages.length,
        pages,
        keyControls: this.topControls(controlCounts),
      };
    }

    const target = ProductMemory.knowledgePath(productId);

    fs.ensureDirSync(path.dirname(target));
    fs.writeJsonSync(target, knowledge, { spaces: 2 });

    return { path: target, knowledge };
  }

  private resolveProductId(): string {
    try {
      return AQWRuntime.resolve().productId;
    } catch {
      throw new Error(
        "Could not determine the active product. Run `npm run aqw` to " +
          "onboard a product first."
      );
    }
  }

  private async loadNavigationHierarchy(
    productId: string
  ): Promise<NavigationGroup[]> {
    const candidates = [
      path.join(
        ProductMemory.root(productId),
        "discovery",
        "navigation-hierarchy.json"
      ),
      path.resolve(
        process.cwd(),
        "knowledge/discovery/navigation-hierarchy.json"
      ),
    ];

    for (const candidate of candidates) {
      if (await fs.pathExists(candidate)) {
        const raw: unknown = await fs.readJson(candidate);

        if (Array.isArray(raw)) {
          return raw as NavigationGroup[];
        }
      }
    }

    throw new Error(
      "Navigation hierarchy not found. Run `npm run discover` " +
        "(and `npm run inventory`) before generating knowledge."
    );
  }

  private async loadPageInventories(
    productId: string
  ): Promise<PageInventory[]> {
    const directories = [
      path.join(ProductMemory.root(productId), "pages"),
      path.resolve(process.cwd(), "knowledge/pages"),
    ];

    const inventories: PageInventory[] = [];

    for (const directory of directories) {
      if (!(await fs.pathExists(directory))) {
        continue;
      }

      const files = (await fs.readdir(directory)).filter(file =>
        file.endsWith(".json")
      );

      for (const file of files) {
        try {
          inventories.push(
            await fs.readJson(path.join(directory, file))
          );
        } catch {
          // Skip unreadable inventory files.
        }
      }
    }

    return inventories;
  }

  private loadExistingKnowledge(
    productId: string
  ): Record<string, unknown> {
    const candidate = ProductMemory.knowledgePath(productId);

    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readJsonSync(candidate);

        if (raw && typeof raw === "object") {
          return raw;
        }
      } catch {
        // Fall through to the bundled seed.
      }
    }

    return bundledKnowledge as Record<string, unknown>;
  }

  private existingDescription(
    existing: Record<string, unknown>,
    module: string
  ): string | undefined {
    const value =
      existing[module] ?? (existing as any).modules?.[module];

    if (typeof value === "string") {
      return value;
    }

    if (value && typeof value === "object") {
      const description = (value as any).description;

      if (typeof description === "string" && description.trim()) {
        return description;
      }
    }

    return undefined;
  }

  private buildDescription(
    module: string,
    items: NavigationItem[],
    pages: PageKnowledge[]
  ): string {
    const names = [...new Set(pages.map(page => page.name).filter(Boolean))];
    const listing = names.slice(0, 12).join(", ");

    return (
      `${module} module: ${pages.length} of ${items.length} pages inventoried` +
      (listing ? `, including ${listing}` : "") +
      "."
    );
  }

  private buildPageKnowledge(
    item: NavigationItem,
    inventory: PageInventory
  ): PageKnowledge {
    const url = inventory.finalUrl || item.href;

    return {
      name: item.text?.trim() || this.pageNameFromUrl(url),
      url,
      inputs: this.identities(
        inventory.inputs,
        ["placeholder", "name", "id", "type"],
        MAX_INPUTS
      ),
      buttons: this.identities(
        inventory.buttons,
        ["text", "name", "id"],
        MAX_BUTTONS
      ),
      dropdowns: this.identities(
        inventory.dropdowns,
        ["name", "text", "id"],
        MAX_DROPDOWNS
      ),
      tables: Number(inventory.tables) || 0,
    };
  }

  private identities(
    elements: InventoryElement[] | undefined,
    fields: Array<keyof InventoryElement>,
    max: number
  ): string[] {
    if (!elements) {
      return [];
    }

    const seen = new Set<string>();
    const result: string[] = [];

    for (const element of elements) {
      if (element.visible === false) {
        continue;
      }

      const identity = fields
        .map(field => String(element[field] ?? "").trim())
        .find(value => value.length > 0);

      if (!identity) {
        continue;
      }

      const normalized = identity.toLowerCase();

      if (NOISE_IDENTITIES.has(normalized)) {
        continue;
      }

      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      result.push(identity.slice(0, 80));

      if (result.length >= max) {
        break;
      }
    }

    return result;
  }

  private tally(counts: Map<string, number>, values: string[]): void {
    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  private topControls(counts: Map<string, number>): string[] {
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_KEY_CONTROLS)
      .map(([control]) => control);
  }

  private findInventory(
    inventories: PageInventory[],
    href: string
  ): PageInventory | undefined {
    const exact = inventories.find(
      inventory =>
        inventory.finalUrl === href || inventory.requestedUrl === href
    );

    if (exact) {
      return exact;
    }

    const normalized = href.replace(/\/$/, "").split("#")[0];

    return inventories.find(
      inventory =>
        inventory.finalUrl?.replace(/\/$/, "").split("#")[0] ===
          normalized ||
        inventory.requestedUrl?.replace(/\/$/, "").split("#")[0] ===
          normalized
    );
  }

  private pageNameFromUrl(url: string): string {
    try {
      const segments = new URL(url).pathname
        .split("/")
        .filter(Boolean);

      return segments.at(-1) || "page";
    } catch {
      return "page";
    }
  }
}
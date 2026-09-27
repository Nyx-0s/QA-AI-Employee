import fs from "fs-extra";
import path from "path";
import type { AQWRuntimeConfig } from "../runtime/AQWRuntimeConfig";

const PRODUCTS_ROOT = path.resolve(
  process.cwd(),
  "memory",
  "products"
);

const ACTIVE_FILE = path.join(PRODUCTS_ROOT, ".active.json");

export class ProductMemory {
  static root(productId: string): string {
    return path.join(PRODUCTS_ROOT, productId);
  }

  static ensure(config: AQWRuntimeConfig): string {
    const root = this.root(config.productId);

    for (const directory of [
      root,
      path.join(root, "discovery"),
      path.join(root, "pages"),
      path.join(root, "api"),
      path.join(root, "workflows"),
      path.join(root, "baselines"),
      path.join(root, "runs")
    ]) {
      fs.ensureDirSync(directory);
    }

    const metadataPath = path.join(root, "product.json");

    const previous = fs.existsSync(metadataPath)
      ? fs.readJsonSync(metadataPath)
      : {};

    fs.writeJsonSync(
      metadataPath,
      {
        ...previous,
        productId: config.productId,
        productName: config.productName,
        baseUrl: config.baseUrl,
        authenticated: config.authenticated,
        username: config.username ?? previous.username,
        password: config.password ?? previous.password,
        firstSeenAt:
          previous.firstSeenAt ?? new Date().toISOString(),
        lastSeenAt: new Date().toISOString()
      },
      { spaces: 2 }
    );

    this.activate(config.productId);

    return root;
  }

  static exists(productId: string): boolean {
    return fs.existsSync(
      path.join(this.root(productId), "product.json")
    );
  }

  /**
   * Per-product module knowledge base used by the AI employee.
   */
  static knowledgePath(productId: string): string {
    return path.join(this.root(productId), "knowledge.json");
  }

  /**
   * Marks a product as the active one so later CLI invocations resolve
   * to it even when several products exist in memory.
   */
  static activate(productId: string): void {
    fs.ensureDirSync(PRODUCTS_ROOT);

    fs.writeJsonSync(
      ACTIVE_FILE,
      {
        productId,
        activatedAt: new Date().toISOString()
      },
      { spaces: 2 }
    );
  }

  /**
   * Product ids present in memory, most recently seen first.
   */
  static list(): string[] {
    if (!fs.existsSync(PRODUCTS_ROOT)) {
      return [];
    }

    return fs
      .readdirSync(PRODUCTS_ROOT)
      .filter(entry =>
        fs.existsSync(
          path.join(PRODUCTS_ROOT, entry, "product.json")
        )
      )
      .sort((a, b) => {
        const seenA =
          this.seenAt(path.join(PRODUCTS_ROOT, a));
        const seenB =
          this.seenAt(path.join(PRODUCTS_ROOT, b));

        return seenB.localeCompare(seenA);
      });
  }

  /**
   * Loads a product's persisted configuration, if present.
   */
  static load(productId: string): AQWRuntimeConfig | null {
    const file = path.join(this.root(productId), "product.json");

    if (!fs.existsSync(file)) {
      return null;
    }

    try {
      const raw = fs.readJsonSync(file) as Partial<AQWRuntimeConfig> & {
        lastSeenAt?: string;
      };

      if (!raw.productId || !raw.baseUrl) {
        return null;
      }

      return {
        productId: raw.productId,
        productName: raw.productName ?? raw.productId,
        baseUrl: raw.baseUrl,
        authenticated: raw.authenticated ?? true,
        username:
          typeof raw.username === "string" ? raw.username : undefined,
        password:
          typeof raw.password === "string" ? raw.password : undefined
      };
    } catch {
      return null;
    }
  }

  /**
   * Resolves the active product configuration: explicit active marker
   * first, then the most recently seen product. Returns null when no
   * product has been onboarded.
   */
  static resolveActive(): AQWRuntimeConfig | null {
    if (fs.existsSync(ACTIVE_FILE)) {
      try {
        const marker = fs.readJsonSync(ACTIVE_FILE) as {
          productId?: string;
        };

        if (marker.productId) {
          const config = this.load(marker.productId);

          if (config) {
            return config;
          }
        }
      } catch {
        // Corrupt marker; fall through to most-recent product.
      }
    }

    for (const productId of this.list()) {
      const config = this.load(productId);

      if (config) {
        return config;
      }
    }

    return null;
  }

  private static seenAt(directory: string): string {
    try {
      const metadata = fs.readJsonSync(
        path.join(directory, "product.json")
      ) as { lastSeenAt?: string };

      return metadata.lastSeenAt ?? "";
    } catch {
      return "";
    }
  }
}

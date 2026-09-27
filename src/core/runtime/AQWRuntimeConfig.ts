import { Config } from "../config/ConfigManager";
import { ProductMemory } from "../memory/ProductMemory";
import { ProductIdentity } from "../product/ProductIdentity";

export interface AQWRuntimeConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  productId: string;
  productName: string;
  authenticated: boolean;
}

export class AQWRuntime {
  private static config: AQWRuntimeConfig | undefined;

  static initialize(config: AQWRuntimeConfig): void {
    this.config = config;
  }

  static get(): AQWRuntimeConfig {
    if (!this.config) {
      throw new Error("AQW runtime has not been initialized.");
    }

    return this.config;
  }

  static isInitialized(): boolean {
    return this.config !== undefined;
  }

  static clear(): void {
    this.config = undefined;
  }

  /**
   * Resolves the effective product configuration for the current process:
   *
   * 1. In-process runtime (set by `aqw run` in the same invocation).
   * 2. ProductMemory: the active product marker, else the most recently
   *    seen product (persisted by `aqw run`). Missing credentials fall
   *    back to the legacy .env values.
   * 3. Legacy .env-only fallback (no onboarded product).
   */
  static resolve(): AQWRuntimeConfig {
    if (this.config) {
      return this.config;
    }

    const memoryConfig = ProductMemory.resolveActive();

    if (memoryConfig) {
      return {
        ...memoryConfig,
        username: memoryConfig.username || Config.USERNAME || undefined,
        password: memoryConfig.password || Config.PASSWORD || undefined
      };
    }

    if (Config.BASE_URL) {
      const identity = ProductIdentity.fromUrl(Config.BASE_URL);

      return {
        baseUrl: Config.BASE_URL,
        username: Config.USERNAME || undefined,
        password: Config.PASSWORD || undefined,
        productId: identity.id,
        productName: identity.name,
        authenticated: true
      };
    }

    throw new Error(
      "No active product found. Run `npm run aqw` to onboard a product first."
    );
  }
}
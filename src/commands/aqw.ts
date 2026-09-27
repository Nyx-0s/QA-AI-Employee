import { InteractivePrompt } from "../core/runtime/InteractivePrompt";
import {
  AQWRuntime,
  type AQWRuntimeConfig
} from "../core/runtime/AQWRuntimeConfig";
import { ProductIdentity } from "../core/product/ProductIdentity";
import { ProductMemory } from "../core/memory/ProductMemory";
import { AuthManager } from "../core/auth/AuthManager";
import { BrowserManager } from "../core/browser/BrowserManager";

export async function aqwCommand(): Promise<void> {
  const prompt = new InteractivePrompt();

  console.log("");
  console.log("==============================================");
  console.log("       RFT AUTONOMOUS QA WORKFORCE");
  console.log("==============================================");
  console.log("");

  try {
    const rawUrl = await prompt.required("Product URL: ");

    let normalizedUrl: string;

    try {
      normalizedUrl = new URL(
        /^https?:\/\//i.test(rawUrl)
          ? rawUrl
          : `https://${rawUrl}`
      ).toString();
    } catch {
      throw new Error(`Invalid product URL: ${rawUrl}`);
    }

    const identity = ProductIdentity.fromUrl(normalizedUrl);

    const hasMemory = ProductMemory.exists(identity.id);

    console.log("");
    console.log(`Product       : ${identity.name}`);
    console.log(`Product ID    : ${identity.id}`);
    console.log(
      `Product memory: ${hasMemory ? "FOUND" : "NEW PRODUCT"}`
    );
    console.log("");

    const authenticated = await prompt.yesNo(
      "Does this product require authentication?",
      true
    );

    let username: string | undefined;
    let password: string | undefined;

    if (authenticated) {
      username = await prompt.required("Username / Email: ");
      password = await prompt.required("Password: ");
    }

    const config: AQWRuntimeConfig = {
      baseUrl: normalizedUrl,
      username,
      password,
      productId: identity.id,
      productName: identity.name,
      authenticated
    };

    AQWRuntime.initialize(config);

    const memoryRoot = ProductMemory.ensure(config);

    console.log("");
    console.log("==============================================");
    console.log("             AQW RUNTIME READY");
    console.log("==============================================");
    console.log(`URL           : ${config.baseUrl}`);
    console.log(`Product       : ${config.productName}`);
    console.log(`Product ID    : ${config.productId}`);
    console.log(`Authentication: ${authenticated ? "REQUIRED" : "NONE"}`);
    console.log(`Existing memory: ${hasMemory ? "YES" : "NO"}`);
    console.log(`Memory        : ${memoryRoot}`);
    console.log("");
    console.log("✓ Universal product runtime initialized.");

    if (authenticated) {
      const authenticateNow = await prompt.yesNo(
        "Authenticate now to enable discovery and QA?",
        true
      );

      if (authenticateNow) {
        const browser = new BrowserManager();

        try {
          await browser.launch();

          const auth = new AuthManager(browser);

          const success = await auth.authenticate(
            username ?? "",
            password ?? ""
          );

          console.log("");

          if (success) {
            console.log("✅ Authentication complete. Session saved.");
            console.log("→ Next stage: run npm run discover.");
          } else {
            console.log("⚠️  Authentication did not complete.");
            console.log("→ Retry later with: npm run auth");
          }
        } finally {
          await browser.close().catch(() => undefined);
        }
      } else {
        console.log("→ Skipped. Authenticate later with: npm run auth");
      }
    } else {
      console.log("→ No authentication required for this product.");
      console.log("→ Next stage: run npm run discover.");
    }
  } finally {
    prompt.close();
  }
}

import { AuthManager } from "../core/auth/AuthManager";
import { BrowserManager } from "../core/browser/BrowserManager";

export async function authCommand(): Promise<void> {
  console.log("");
  console.log("============================================");
  console.log("        RFT AUTH — SESSION SETUP");
  console.log("============================================");
  console.log("");

  const browser = new BrowserManager();

  try {
    await browser.launch();

    const auth = new AuthManager(browser);

    const success = await auth.authenticate();

    if (!success) {
      console.error("");
      console.error("❌ Authentication did not complete.");
      console.error(
        "The login form could not be submitted or the session was not established."
      );
      console.error(
        "Check USERNAME / PASSWORD in .env and the product's login flow."
      );
      console.error(
        "The existing session (if any) was preserved at runtime/storageState.json."
      );
      process.exitCode = 1;
      return;
    }

    console.log("");
    console.log("✅ Authentication complete.");
    console.log("   Session saved to runtime/storageState.json");
    console.log("   Previous session (if any) backed up to runtime/storageState.json.bak");
    console.log("");
    console.log("   Next: npm run discover → npm run inventory → npm run qa");
  } finally {
    await browser.close().catch(() => undefined);
  }
}
import type { Locator, Page } from "@playwright/test";
import fs from "fs-extra";

import { BrowserManager } from "../browser/BrowserManager";
import { Config } from "../config/ConfigManager";
import { AQWRuntime } from "../runtime/AQWRuntimeConfig";
import { Logger } from "../logger/Logger";
import { ButtonFinder } from "../actions/utils/ButtonFinder";
import { FieldFinder } from "../actions/utils/FieldFinder";

interface LoginKnowledge {
  inputs: {
    id: string;
    name: string;
    type: string;
  }[];
  buttons: {
    text: string;
    class: string;
  }[];
}

const LOGIN_URL_PATTERN =
  /login|signin|sign-in|log-in|authenticate/i;

export class AuthManager {
  private readonly fieldFinder = new FieldFinder();
  private readonly buttonFinder = new ButtonFinder();

  constructor(private readonly browser: BrowserManager) {}

  /**
   * Product-agnostic authentication flow: open the product, locate and open
   * the login page, fill credentials, submit, verify the session, then save
   * the Playwright storage state that discover/inventory/qa restore.
   */
  async authenticate(
    username?: string,
    password?: string
  ): Promise<boolean> {
    const config = AQWRuntime.resolve();

    await this.openLogin();

    const success = await this.login(
      username ?? config.username ?? "",
      password ?? config.password ?? ""
    );

    if (success) {
      await this.saveState();
    }

    return success;
  }

  async openLogin(): Promise<void> {
    const page = this.browser.getPage();

    const { baseUrl } = AQWRuntime.resolve();

    Logger.info("Opening landing page...");

    await page.goto(baseUrl, {
      waitUntil: "networkidle",
      timeout: Config.TIMEOUT,
    });

    if (LOGIN_URL_PATTERN.test(page.url())) {
      Logger.info("Login page detected directly.");
      return;
    }

    const entry = await this.findLoginEntry(page);

    if (!entry) {
      Logger.warn(
        "No explicit login control detected; " +
          "assuming the current page is the login surface."
      );
      return;
    }

    Logger.info("Opening login page...");

    await entry.click({ timeout: Config.TIMEOUT });

    await page
      .waitForLoadState("networkidle", {
        timeout: Config.TIMEOUT,
      })
      .catch(() => undefined);
  }

  async login(
    username: string,
    password: string
  ): Promise<boolean> {
    const page = this.browser.getPage();

    const usernameInput =
      (await this.findUsernameInput(page)) ??
      (await this.findKnowledgeInput(page, /email|user|login/i));

    const passwordInput =
      (await this.findPasswordInput(page)) ??
      (await this.findKnowledgeInput(page, /password|pass/i));

    if (!usernameInput || !passwordInput) {
      Logger.warn(
        "Login form could not be detected on the current page."
      );
      return false;
    }

    Logger.info("Filling credentials...");

    await usernameInput.fill(username);
    await passwordInput.fill(password);

    const submit = await this.findSubmitButton(page);

    if (submit) {
      Logger.info("Submitting login...");
      await submit.click();
    } else {
      Logger.info("No submit button found; pressing Enter...");
      await passwordInput.press("Enter");
    }

    // Give the application time to redirect after authentication.
    try {
      await page.waitForURL(
        url => !LOGIN_URL_PATTERN.test(url.href),
        { timeout: 15000 }
      );
    } catch {
      await page
        .waitForLoadState("networkidle", {
          timeout: Config.TIMEOUT,
        })
        .catch(() => undefined);

      await page.waitForTimeout(2000);
    }

    const verified = await this.verifyLogin(page);

    Logger.info(
      verified ? "Login successful." : "Login did not complete."
    );

    return verified;
  }

  async saveState(): Promise<void> {
    fs.ensureDirSync("runtime");

    const target = "runtime/storageState.json";

    if (fs.existsSync(target)) {
      fs.copySync(target, "runtime/storageState.json.bak");
    }

    await this.browser
      .getPage()
      .context()
      .storageState({ path: target });

    Logger.info(`Storage state saved to ${target}.`);
  }

  private async findLoginEntry(
    page: Page
  ): Promise<Locator | null> {
    const links = page.locator("a");
    const linkCount = await links.count();

    for (let index = 0; index < linkCount; index++) {
      const link = links.nth(index);

      if (!(await link.isVisible().catch(() => false))) {
        continue;
      }

      const text = (await link.innerText().catch(() => "")).trim();
      const href =
        (await link.getAttribute("href").catch(() => "")) || "";

      const haystack = `${text} ${href}`.toLowerCase();

      if (/(log ?in|sign ?in|signin|login)/.test(haystack)) {
        return link;
      }
    }

    return this.buttonFinder.find(page.locator("body"), [
      "institute login",
      "staff login",
      "admin login",
      "school login",
      "account login",
      "sign in",
      "log in",
      "signin",
      "login",
    ]);
  }

  private async findUsernameInput(
    page: Page
  ): Promise<Locator | null> {
    const email = await this.fieldFinder.find(
      page.locator("body"),
      ["email", "e-mail"]
    );

    if (email) {
      return email;
    }

    return this.fieldFinder.find(page.locator("body"), [
      "username",
      "user name",
      "user id",
      "userid",
      "login id",
    ]);
  }

  private async findPasswordInput(
    page: Page
  ): Promise<Locator | null> {
    const password = page
      .locator("input[type='password']")
      .first();

    if (await password.isVisible().catch(() => false)) {
      return password;
    }

    return this.fieldFinder.find(page.locator("body"), [
      "password",
    ]);
  }

  private async findSubmitButton(
    page: Page
  ): Promise<Locator | null> {
    const knowledge = this.loadKnowledge();

    if (knowledge) {
      for (const button of knowledge.buttons) {
        const candidates = page
          .locator("button")
          .filter({ hasText: button.text });

        const total = await candidates.count();

        for (let index = 0; index < total; index++) {
          const candidate = candidates.nth(index);

          if (await candidate.isVisible().catch(() => false)) {
            return candidate;
          }
        }
      }
    }

    return this.buttonFinder.find(page.locator("body"), [
      "sign in",
      "log in",
      "signin",
      "login",
      "submit",
      "continue",
      "enter",
    ]);
  }

  private async findKnowledgeInput(
    page: Page,
    typePattern: RegExp
  ): Promise<Locator | null> {
    const knowledge = this.loadKnowledge();

    if (!knowledge) {
      return null;
    }

    const entry = knowledge.inputs.find(input =>
      typePattern.test(input.type)
    );

    if (!entry?.id) {
      return null;
    }

    const locator = page.locator(`#${entry.id}`);

    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }

    return null;
  }

  private loadKnowledge(): LoginKnowledge | null {
    const file = "knowledge/login-page.json";

    if (!fs.existsSync(file)) {
      return null;
    }

    try {
      const raw = fs.readJsonSync(file) as LoginKnowledge;

      if (Array.isArray(raw.inputs) && Array.isArray(raw.buttons)) {
        return raw;
      }
    } catch (error) {
      Logger.warn(
        `Could not read ${file}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    return null;
  }

  private async verifyLogin(page: Page): Promise<boolean> {
    const url = page.url().toLowerCase();

    const passwordField = page
      .locator("input[type='password']")
      .first();

    const passwordVisible = await passwordField
      .isVisible()
      .catch(() => false);

    const bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");

    const authError =
      /invalid (username|email|password|credentials?)|incorrect (username|email|password|credentials?)|wrong (username|email|password|credentials?)|login failed|authentication failed|these credentials|account locked|too many (attempts|tries)/i.test(
        bodyText
      );

    if (authError) {
      return false;
    }

    const stillOnLoginPage =
      LOGIN_URL_PATTERN.test(url) && passwordVisible;

    return !stillOnLoginPage;
  }
}
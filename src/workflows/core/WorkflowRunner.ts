import "dotenv/config";
import { chromium } from "playwright";
import { AutoRunner } from "./AutoRunner";

export class WorkflowRunner {

  async run() {

    const browser = await chromium.launch({
      headless: process.env.HEADLESS === "true",
      slowMo: 300
    });

    const page = await browser.newPage();

    console.log("");
    console.log("====================================");
    console.log("GYANSETU AI EMPLOYEE");
    console.log("====================================");

    console.log("Opening login page...");

    await page.goto(process.env.BASE_URL!, {
      waitUntil: "networkidle"
    });

    await page.getByRole("button", {
      name: /Institute Login/i
    }).click();

    await page.waitForURL(/school-login/);

    console.log("Logging in...");

    await page.locator("#email").fill(process.env.USERNAME!);
    await page.locator("#password").fill(process.env.PASSWORD!);

    await page.getByRole("button", {
      name: /Sign In/i
    }).click();

    await page.waitForLoadState("networkidle");

    console.log("Login successful.");

    await AutoRunner.run(page);

    console.log("");
    console.log("====================================");
    console.log("RUN COMPLETE");
    console.log("====================================");

    await browser.close();

  }

}

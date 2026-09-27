import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "../src/App.js";

/**
 * Smoke test: the shell renders, polls the API, and shows the approvals
 * surface. The API client is stubbed at the fetch level so the test runs
 * without a backend.
 */

const approvals = [
  {
    taskId: "tsk_1",
    employeeId: "emp_1",
    employeeName: "Gate Clerk",
    taskObjective: "Submit the invoice form",
    taskUrl: "http://127.0.0.1:9/invoice",
    approval: {
      summary: 'About to click "Pay invoice"',
      elementText: "Pay invoice",
      elementDescription: 'button[type=submit] "Pay invoice"',
      stepIndex: 2,
      via: "click" as const,
      at: new Date().toISOString(),
    },
    awaitingAt: new Date().toISOString(),
    status: "awaiting_approval" as const,
    latestScreenshotRef: null,
  },
];

const employees = [
  {
    id: "emp_1",
    name: "Gate Clerk",
    role: "data_clerk",
    description: "",
    systemPrompt: "x",
    backend: "cloud",
    model: "auto",
    toolsEnabled: ["browser_task"],
    allowedDomains: ["127.0.0.1"],
    confirmBeforeSubmit: true,
    maxStepsPerTask: 25,
    schedule: null,
    status: "active",
    createdAt: new Date().toISOString(),
    tasksCompleted: 3,
  },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/dashboard/approvals")) return jsonResponse(approvals);
    if (url.includes("/api/employees")) return jsonResponse(employees);
    if (url.includes("/api/tasks")) return jsonResponse([]);
    return jsonResponse({ ok: true });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The app now opens on the Workforce overview; tests navigate to Approvals. */
async function openApprovals(): Promise<void> {
  const tab = await screen.findByRole("button", { name: /Approvals/ });
  tab.click();
}

describe("App smoke", () => {
  it("renders the approvals queue from the API", async () => {
    render(<App />);
    await openApprovals();
    expect(await screen.findByText("Gate Clerk")).toBeDefined();
    expect(screen.getByText(/Submit the invoice form/)).toBeDefined();
    // Two-step approve: the first click only ARMS the button.
    const approve = screen.getByRole("button", { name: "Approve" });
    approve.click();
    expect(await screen.findByRole("button", { name: "Approve — click again" })).toBeDefined();
    // fetch was never called with an approve — the commit needs a second click.
    const calls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/approve"))).toBe(false);
  });

  it("does not commit the approval until the second click", async () => {
    render(<App />);
    await openApprovals();
    await screen.findByText("Gate Clerk");
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeDefined());
    screen.getByRole("button", { name: "Approve" }).click();
    const armed = await screen.findByRole("button", { name: "Approve — click again" });
    armed.click();
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes("/approve")),
      ).toBe(true),
    );
  });
});

import type {
  ApprovalQueueEntry,
  DashboardConfig,
  EmployeeSummary,
  Task,
} from "@consentark/shared";

/**
 * API client — the ONLY place that talks to the backend.
 *
 * Auth: the dashboard is the operator's console, so the admin Bearer token
 * is supplied once (VITE_ADMIN_TOKEN in dev; injected per-deployment in
 * prod) and attached to every request. It never leaves this module.
 */

const BASE: string = import.meta.env.VITE_API_URL ?? "";
/**
 * Operator token resolution: dev builds bake VITE_ADMIN_TOKEN; packaged
 * builds ship token-free (a secret must never sit in a publicly served
 * bundle), so the operator pastes the token once — stored in localStorage
 * under "ca-operator-token" — and it is attached to every request here.
 *
 * Resolved per-request (not at module load): the token can be pasted after
 * the app booted, and the very next request must already carry it.
 */
function currentToken(): string {
  return localStorage.getItem("ca-operator-token") ?? import.meta.env.VITE_ADMIN_TOKEN ?? "";
}

/** Called by the App shell when the operator pastes a token. */
export function setOperatorToken(token: string): void {
  localStorage.setItem("ca-operator-token", token);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${currentToken()}`,
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let code = "http_error";
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      /* non-JSON error body — keep the HTTP fallbacks */
    }
    throw new ApiError(response.status, code, message);
  }
  return (await response.json()) as T;
}

export const api = {
  approvals: () => request<ApprovalQueueEntry[]>("/api/dashboard/approvals"),
  config: () => request<DashboardConfig>("/api/dashboard/config"),
  /** Health is the one unauthenticated route — also our version source. */
  health: () => request<{ ok: boolean; version: string; time: string }>("/api/health"),
  employees: () => request<EmployeeSummary[]>("/api/employees"),
  tasks: (filter: { status?: string; employeeId?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.status) params.set("status", filter.status);
    if (filter.employeeId) params.set("employeeId", filter.employeeId);
    const qs = params.toString();
    return request<Task[]>(`/api/tasks${qs ? `?${qs}` : ""}`);
  },
  task: (id: string) => request<Task>(`/api/tasks/${id}`),
  approve: (taskId: string) =>
    request<{ approved: boolean; status?: string }>(`/api/tasks/${taskId}/approve`, {
      method: "POST",
    }),
  cancel: (taskId: string) =>
    request<{ cancelled: boolean; status?: string }>(`/api/tasks/${taskId}/cancel`, {
      method: "POST",
    }),
  /** Screenshot URL (auth comes from fetchScreenshot; fetch → blob). */
  screenshotUrl: (taskId: string, ref: string): string =>
    `${BASE}/api/dashboard/screenshots/${encodeURIComponent(taskId)}/${encodeURIComponent(ref)}`,
  /** Fetch a screenshot as an object URL for <img> (auth header required). */
  fetchScreenshot: async (taskId: string, ref: string): Promise<string> => {
    const response = await fetch(api.screenshotUrl(taskId, ref), {
      headers: { authorization: `Bearer ${currentToken()}` },
    });
    if (!response.ok) throw new ApiError(response.status, "screenshot_error", `HTTP ${response.status}`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  },
};

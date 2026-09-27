import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import http from "node:http";

/**
 * A scripted, OpenAI-compatible chat-completions endpoint.
 *
 * `toolCalls` is a queue: each incoming request pops the next script entry and
 * returns it as a message.content JSON payload — page-agent's
 * `normalizeResponse` parses tool calls from content JSON (verified in
 * @page-agent/core@1.12.4 dist) so no real provider formatting is needed.
 *
 * Used by the spike and tests to drive the agent deterministically and to
 * verify that page-agent's model calls actually arrive at a baseURL we control.
 */
export interface MockLlmCall {
  promptChars: number;
  toolNames: string[];
  at: number;
  /** Full serialized messages — lets tests verify prompt content (spike-scale). */
  promptSnippet: string;
}

export interface MockLlmServer {
  url: string;
  calls: MockLlmCall[];
  server: Server;
  close: () => Promise<void>;
}

export interface ScriptedToolCall {
  /** Tool name page-agent should invoke. */
  name: string;
  /** Tool arguments, matching the tool's zod inputSchema. */
  args: Record<string, unknown>;
}

/** Context handed to a content-aware step chooser. */
export interface ScriptedHookContext {
  /** Full messages array of the incoming chat-completions request. */
  messages: unknown;
  /** Zero-based index of this call on this server instance. */
  callIndex: number;
}

export function startMockLlm(
  script: ScriptedToolCall[],
  opts: {
    authRequired?: boolean;
    expectedApiKey?: string;
    /** Bind a fixed port (dev/E2E daemons); default ephemeral. */ port?: number;
    /** Content-aware override (demo sandbox): pick the step from the request
     *  itself instead of the positional queue. Takes precedence over `script`
     *  entirely — a discarded/retried call can then never desync the play.
     *  `script` is kept as the fallback/documentation of the intended steps. */
    chooseStep?: (ctx: ScriptedHookContext) => ScriptedToolCall;
  } = {},
): Promise<MockLlmServer> {
  const calls: MockLlmCall[] = [];
  let counter = 0;
  let idCounter = 0;

  /** CORS: the caller is the in-page agent (cross-origin fetch from the page). */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
} as const;

const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        // --- auth verification (proves apiKey passthrough wiring) ---
        const auth = req.headers["authorization"] ?? "";
        if (opts.authRequired) {
          const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
          if (token !== opts.expectedApiKey) {
            res.writeHead(401, { "content-type": "application/json", ...CORS });
            res.end(JSON.stringify({ error: { message: "bad key" } }));
            return;
          }
        }

        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
          model?: string;
          messages?: { role: string; content?: unknown }[];
          tools?: unknown[];
        };

        calls.push({
          promptChars: JSON.stringify(body.messages ?? []).length,
          toolNames: (body.tools ?? []).map((t) => {
            const tt = t as { function?: { name?: string } };
            return tt.function?.name ?? "?";
          }),
          promptSnippet: JSON.stringify(body.messages ?? []),
          at: Date.now(),
        });

        // Content-aware choreography when provided; positional queue otherwise.
        const step = opts.chooseStep
          ? opts.chooseStep({ messages: body.messages, callIndex: counter })
          : script[Math.min(counter, script.length - 1)];
        counter += 1;

        // Rotate ids; tools receive whatever args we scripted.
        const content = JSON.stringify({
          evaluation_previous_goal: "Spike mock",
          memory: "mock",
          next_goal: "run scripted step",
          action: { [step.name]: step.args },
        });

        res.writeHead(200, { "content-type": "application/json", ...CORS });
        res.end(
          JSON.stringify({
            id: `mock-${idCounter++}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: body.model ?? "mock-model",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content,
                },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
          }),
        );
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json", ...CORS });
        res.end(JSON.stringify({ error: { message: String(err) } }));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}/v1`,
        calls,
        server,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

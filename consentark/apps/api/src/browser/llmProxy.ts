import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Local OpenAI-compatible proxy in front of the real LLM backend.
 *
 * Phase 2 wiring for page-agent's model calls: the in-page agent is configured
 * with THIS proxy's URL instead of the provider's. The proxy then:
 *   1. injects the real Authorization header (the API key never enters the
 *      page/DOM — the agent config carries only `apiKey: "pa-proxy"`),
 *   2. logs every request (model, prompt summary, usage) for the task audit
 *      trail — the ConsentArk product requirement, and
 *   3. applies timeout + retry with exponential backoff (the same resilience
 *      policy as our LLMProvider).
 *
 * In the spike the upstream is the scripted mock LLM; for production this
 * points at the CloudProvider/LocalProvider backends (FreeLLMAPI / Colibrì).
 */
export interface ProxyRequestRecord {
  model: string;
  messageCount: number;
  promptPreview: string;
  /** Serialized request size in chars — cheap audit metric. */
  promptChars: number;
  status: number;
  durationMs: number;
  at: number;
}

export interface LlmProxyOptions {
  /** URL of the OpenAI-compatible backend to forward to. */
  upstreamUrl: string;
  /** Authorization header value sent upstream (e.g. "Bearer sk-…"). */
  upstreamApiKey?: string;
  /** Hard cap per forwarded request. */
  timeoutMs?: number;
  /** Retry attempts on 5xx/network errors (0 = no retry). */
  maxRetries?: number;
  /** Realtime audit hook — fires once per forwarded request. */
  onRequest?: (record: ProxyRequestRecord) => void;
}

export interface LlmProxy {
  url: string;
  requests: ProxyRequestRecord[];
  server: Server;
  close: () => Promise<void>;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * CORS headers: the CALLER here is the in-page agent (cross-origin fetch from
 * the automated page). Without these the page cannot read the response and
 * fetch() rejects with "Network request failed" (verified in the spike).
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  // Chrome Private Network Access: allows public https pages to reach this
  // private (loopback) server. Secondary defense — the primary path is the
  // CDP fetch bridge, which bypasses the network layer entirely.
  "access-control-allow-private-network": "true",
} as const;

export function startLlmProxy(opts: LlmProxyOptions): Promise<LlmProxy> {
  const requests: ProxyRequestRecord[] = [];
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxRetries = opts.maxRetries ?? 2;

  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    const started = Date.now();
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");

      let model = "?";
      let messageCount = 0;
      let promptPreview = "";
      try {
        const parsed = JSON.parse(body || "{}") as {
          model?: string;
          messages?: { role: string; content?: unknown }[];
        };
        model = parsed.model ?? "?";
        messageCount = parsed.messages?.length ?? 0;
        const first = parsed.messages?.find((m) => m.role === "system") ??
          parsed.messages?.[0];
        promptPreview = String(first?.content ?? "").slice(0, 160);
      } catch {
        /* non-JSON body is forwarded unchanged */
      }

      const forward = async (attempt: number): Promise<void> => {
        let upstreamBody: string;
        let status: number;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          const upstream = await fetch(opts.upstreamUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(opts.upstreamApiKey
                ? { authorization: `Bearer ${opts.upstreamApiKey}` }
                : {}),
            },
            body,
            signal: controller.signal,
          });
          clearTimeout(timer);
          status = upstream.status;
          upstreamBody = await upstream.text();

          if (RETRYABLE.has(status) && attempt < maxRetries) {
            await delay(2 ** attempt * 250);
            return forward(attempt + 1);
          }
        } catch (err) {
          if (attempt < maxRetries) {
            await delay(2 ** attempt * 250);
            return forward(attempt + 1);
          }
          status = 502;
          upstreamBody = JSON.stringify({
            error: {
              message: `upstream unreachable after ${attempt + 1} attempt(s): ${String(err)}`,
            },
          });
        }

        requests.push({
          model,
          messageCount,
          promptPreview,
          promptChars: body.length,
          status,
          durationMs: Date.now() - started,
          at: Date.now(),
        });
        try {
          opts.onRequest?.(requests[requests.length - 1]!);
        } catch {
          /* audit hook failure must not break the proxy */
        }

        res.writeHead(status, { "content-type": "application/json", ...CORS });
        res.end(upstreamBody);
      };

      void forward(0);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}/v1`,
        requests,
        server,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

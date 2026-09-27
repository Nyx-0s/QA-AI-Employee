# Tracker go-live — the 3-step checklist (FreeLLMAPI key)

**Written 2026-09-19, verified against live config the same morning.**
State at writing: `FREELLMAPI_KEY` length 0 (line 4 of `consentark/.env`);
nothing listening on :3001; `consentark-app` running on :4000 (mock backend);
compose already has the `freellmapi` profile (`tashfeenahmed/freellmapi:latest`,
port 3001:3001). Zero code changes needed anywhere — config only.

**What goes live:** the sales tracker's chat tasks run on a real model instead
of the scripted mock. FreeLLMAPI is self-hosted routing over 34 free provider
tiers (~7.4B tokens/mo aggregate) — cost $0, key issued by your own router.

---

## Step 1 — Start the router (2 min)

```bash
cd consentark && docker compose --profile freellmapi up -d freellmapi
```

**You verify:** `curl -s http://localhost:3001/health` answers (or open
http://localhost:3001 in a browser). On the dashboard's **Keys** page, create
a key — it starts with `freellmapi-`. This is the only place keys come from;
nothing else in the codebase accepts any other credential.

**If it fails:** `docker compose logs freellmapi` — port 3001 conflict is the
only realistic failure (something else grabbed it); free the port and re-up.

## Step 2 — Paste the key + prove it (1 min)

Edit `consentark/.env` **line 4**: `FREELLMAPI_KEY=freellmapi-...`

**You verify (two commands, from `consentark/`):**

```bash
awk -F= '/^FREELLMAPI_KEY/{print "key length:", length($2)}' .env   # >0, and NEVER print the value
node apps/api/dist/cli/keycheck.js
```

Expected: `key length: 40+` and then **`keycheck: PASS — the tracker
employee's chat backend is live.`** (exit 0). keycheck builds the real cloud
provider and sends one live chat call through the same code path the tracker
uses — this is the end-to-end proof, not a config sniff.

**If it fails:** keycheck prints the provider error verbatim. Bad/expired key
→ recreate on the Keys page. Connection refused → Step 1's router isn't up.

## Step 3 — Flip the running stack (1 min)

```bash
cd consentark && docker compose restart app
```

The app container gets `.env` via `env_file` **at boot only** — without the
restart it keeps serving the mock. This restart is the entire "flip."

**You verify (the live read):** enqueue one real chat task for the tracker
employee (dashboard or `POST /api/employee/tasks` with an employee token) and
watch it complete with genuine model text in the transcript — not the mock's
scripted lines. Audit trail shows the live provider call.

**If the task fails with connection refused *from inside the container*:**
that's the one known packaging gotcha — `localhost` inside a container is not
the host. Fix is one line under the `app:` service in `docker-compose.yml`:
`environment: FREELLMAPI_URL: http://freellmapi:3001/v1`, then
`docker compose up -d app`. Only change this if the live read actually fails —
the compose file currently says leave `FREELLMAPI_URL` as-is.

---

**Done = all three greens:** keycheck PASS + one real tracker task completed.
Then tell the agent "tracker is live" — the flip gets logged and the mock-era
notes close out. Total: ~5 minutes, $0, no code changes.

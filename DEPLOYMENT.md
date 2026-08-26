# Deploying KAKSHA

## Read this first: what goes where

KAKSHA is two deployable pieces, and only one of them belongs on Vercel.

| Piece | Host | Why |
|---|---|---|
| **Frontend** (React + Three.js) | **Vercel** | Static bundle. Ideal fit. |
| **Backend** (FastAPI + SGP4) | **Render / Railway / Fly.io** | Long-running stateful process. |

### Why the backend cannot run on Vercel

This is not a configuration problem — it is an architectural mismatch, and it
is worth being able to explain:

- **It is stateful by design.** The catalogue holds ~18,700 element sets plus
  their pre-built SGP4 `Satrec` objects — about **240 MB resident**. Screening
  runs are cached in-process, and the simulation clock is a process-level
  singleton. A serverless function keeps none of that between invocations.
- **Cold start is 30–60 s.** The catalogue is fetched from CelesTrak and parsed
  at startup. Vercel's function limit is 60 s on Hobby; the load alone would
  consume it, and it would happen again on every cold invocation.
- **A screening run takes 7–90 s.** That is a single request, before any of the
  function's other work.
- **It writes a disk cache.** Vercel's filesystem is read-only except `/tmp`.

So: frontend on Vercel, backend on a host that runs an actual process. That is
the normal shape for this kind of application, not a workaround.

---

## Step 1 — Deploy the backend first

The frontend is useless without it, so start here.

### Render (free tier, blueprint included)

1. Push this repository to GitHub.
2. Render dashboard → **New → Blueprint** → select this repository.
3. Render reads [render.yaml](render.yaml) and configures the service.
4. Set the environment variables it asks for (see below).
5. Deploy, and **copy the service URL** — something like
   `https://kaksha-api.onrender.com`.

### Environment variables

| Variable | Required | Value |
|---|---|---|
| `KAKSHA_CORS_ORIGINS` | Yes | Your Vercel domain, e.g. `https://kaksha.vercel.app`. Comma-separated for several. |
| `KAKSHA_GEMINI_API_KEY` | No | Enables generated explanations. Without it the deterministic template is served. |
| `KAKSHA_LLM_MODEL` | No | `gemini-2.5-flash`, or an Anthropic model id with `KAKSHA_ANTHROPIC_API_KEY`. |
| `KAKSHA_MAX_SCREEN_OBJECTS` | No | Defaults to 4000. Lower it if the service is OOM-killed on a 512 MB plan. |

Preview deployments need no configuration: `*.vercel.app` is matched by a regex
in [config.py](backend/app/core/config.py), so every Vercel preview URL is
accepted without being listed.

### Check it before moving on

```bash
curl https://YOUR-BACKEND-URL/api/health
```

Expect `"status": "OK"` and a non-zero `objects`. While the catalogue is still
loading you will see `"status": "LOADING"` — wait for it.

### Other hosts

[backend/Dockerfile](backend/Dockerfile) works on Railway, Fly.io, Cloud Run,
or anything that builds a container. Run **one worker**: the catalogue, the
clock and the screening cache are process-level singletons, so a second worker
means a second 240 MB catalogue and two processes disagreeing about the time.

---

## Step 2 — Deploy the frontend to Vercel

1. Vercel → **Add New → Project** → import this repository.
2. Leave the framework preset alone. [vercel.json](vercel.json) at the
   repository root already sets the build command, the output directory and the
   SPA rewrites.
3. **Add one environment variable:**

   | Name | Value |
   |---|---|
   | `VITE_API_BASE` | Your backend URL, **no trailing slash** |

4. Deploy.

> **`VITE_API_BASE` is inlined at build time, not read at runtime.** Adding or
> changing it requires a **redeploy** — restarting or reloading will not pick it
> up. This is the single most common reason a Vercel deployment shows
> "Backend unreachable" when the backend is demonstrably up.

---

## Step 3 — Close the loop

Once the frontend has a URL, go back to the backend and put that exact origin
in `KAKSHA_CORS_ORIGINS`, then redeploy the backend. Until you do, the browser
blocks every API call and the UI shows its "Backend unreachable" screen.

---

## The free-tier warning that matters for your demo

**Render's free tier spins a service down after 15 minutes of inactivity.**
Waking it costs about 50 seconds, and then the catalogue load costs another
30–60 seconds. A judge clicking your link cold could wait **over a minute**
looking at a loading screen.

Options, roughly in order of how much they help:

1. **Run the backend locally for the live demo** and point a local frontend at
   it. Fastest and most reliable — the deployed version is then a link people
   can browse afterwards.
2. **Hit the URL a few minutes before you present** so it is already warm.
3. **Use a paid tier** (Render Starter, ~$7/month) which does not sleep.
4. **Ping `/api/health` on a schedule** from a free uptime monitor to keep it
   awake.

---

## Troubleshooting

**Vercel build fails on TypeScript errors**
`npm run build` runs `tsc -b` and Vite's dev server does not typecheck, so
errors can hide locally. Reproduce it exactly as Vercel does:

```bash
cd frontend && npm run build
```

**UI loads but every panel says "Backend unreachable"**
In order of likelihood: `VITE_API_BASE` was set but the project was not
redeployed; the URL has a trailing slash; the backend is asleep; or the Vercel
origin is missing from `KAKSHA_CORS_ORIGINS`.

**Browser console shows a CORS error**
The backend does not have your frontend's origin allowlisted. Add it to
`KAKSHA_CORS_ORIGINS` and redeploy the backend. Check the scheme too —
`https://` and `http://` are different origins.

**Routes 404 on refresh**
The SPA rewrite in `vercel.json` is not being applied. Confirm the file is at
the repository root and that Vercel's Root Directory setting is empty rather
than pointing at `frontend`.

**Backend is OOM-killed on Render free**
Lower `KAKSHA_MAX_SCREEN_OBJECTS` to 2000, or move to a plan with more memory.

**Backend starts but reports 0 objects**
CelesTrak was unreachable during startup. Check the logs — a failed feed is
logged and the catalogue is marked `degraded`. It retries on the refresh timer.

---

## Local development is unchanged

None of this affects running locally. With no `VITE_API_BASE` set, the client
falls back to `http://127.0.0.1:8000`, and the default CORS allowlist already
contains `localhost:5173`. See the README for the local setup.

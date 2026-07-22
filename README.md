# Authoring — MCP prototype

A minimal, working MCP server + widget for the sell-side authoring
concept: search across (fake) internal-repo / market-data / web sources,
draft a report with inline citations, refine sections with AI or by hand,
and export the draft. Built to run against your **personal** ChatGPT account
in Developer Mode.

Everything here is real, working code — but the "connectors" in `sources.js`
are hard-coded fake documents, not live SharePoint/Bloomberg/web calls. That's
deliberate: it lets you validate the citation model and widget UX first,
before wiring in real (and slower-to-provision) data sources.

## What's inside

```
authoring-mcp-app/
  server.js         MCP server (Express + @modelcontextprotocol/sdk)
  sources.js        Fake source registry (swap for real connectors later)
  widgets/report.html   The widget UI rendered inline in ChatGPT
  package.json
```

Four tools are exposed:

- `search_sources` — read-only lookup across the fake corpus, returns excerpts + `sourceId`s
- `render_report` — draws the widget with sections + resolved citations
- `update_section` — patches one section after a manual edit or AI refine
- `export_report` — returns the draft as Markdown with a numbered source list

## 1. Prerequisites

- Node.js 18+
- ChatGPT **Plus or Pro** on the web (Developer Mode is web-only right now)
- A tunneling tool: [ngrok](https://ngrok.com/download) is the easiest, or
  Cloudflare Tunnel, or ChatGPT's own "Secure MCP Tunnel" option (offered
  when you create the app if you don't have a public URL yet)

## 2. Run it locally

```bash
cd authoring-mcp-app
npm install
npm start
```

You should see:

```
Authoring MCP server listening on http://localhost:3000/mcp
```

Sanity-check it's alive: `curl http://localhost:3000/health` → `{"ok":true}`.

## 3. Expose it over HTTPS

In a second terminal:

```bash
ngrok http 3000
```

Copy the `https://xxxx.ngrok-free.app` URL it prints. Your MCP endpoint is
that URL + `/mcp`, e.g. `https://xxxx.ngrok-free.app/mcp`.

(Keep this running — every time you restart ngrok without a paid/reserved
domain, the URL changes and you'll need to reconnect the app in ChatGPT.)

## 3b. Or: deploy to Render.com instead of tunneling

A tunnel dies the moment your laptop sleeps or your terminal closes. For
repeated testing, it's more reliable to just deploy the server somewhere
with a permanent URL. Render's free tier works well for this and needs
almost no setup — a `render.yaml` is already included in this project.

1. **Push this project to GitHub.** Render deploys from a Git repo, not a
   zip upload.
   ```bash
   cd authoring-mcp-app
   git init
   git add .
   git commit -m "Authoring MCP prototype"
   ```
   Create an empty repo on github.com (no README/license, so it stays
   empty), then:
   ```bash
   git remote add origin https://github.com/<you>/authoring-mcp-app.git
   git branch -M main
   git push -u origin main
   ```

2. **Create the Render service.**
   - Go to [render.com](https://render.com) → sign up/log in (GitHub login
     is easiest) → **New → Blueprint**.
   - Pick the repo you just pushed. Render will read `render.yaml` and
     pre-fill everything: runtime Node, build command `npm install`,
     start command `npm start`, plan Free.
   - Click **Apply** / **Create Web Service**.

   If you'd rather configure by hand instead of using the blueprint
   (**New → Web Service** instead of **Blueprint**), set:
   - **Runtime**: Node
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Instance type**: Free
   - No environment variables are required — the app already reads
     Render's injected `PORT` (`process.env.PORT`), so it binds correctly
     without changes.

3. **Wait for the first deploy** (a couple of minutes). Render gives you a
   URL like `https://authoring-mcp-app.onrender.com`. Confirm it's alive:
   ```bash
   curl https://authoring-mcp-app.onrender.com/health
   ```
   → `{"ok":true}`

4. **Your MCP server URL for ChatGPT** is that same URL + `/mcp`:
   ```
   https://authoring-mcp-app.onrender.com/mcp
   ```
   Use this directly in step 5 below — skip ngrok/Secure MCP Tunnel
   entirely, since Render already gives you a public HTTPS endpoint.

**Two things to know about the free tier:**
- **Cold starts**: after ~15 minutes of no traffic, Render spins the free
  instance down. The next request (including ChatGPT's) triggers a restart
  that can take 30-60 seconds — the first tool call after a lull may look
  like it's hanging before it responds. Fine for a prototype; upgrade to a
  paid instance later if that latency becomes annoying.
- **State resets on redeploy/restart**: `currentReport` lives in memory
  (see "Known simplifications" below), so a cold start or a new deploy
  clears whatever draft you were working on. Re-run `render_report` to
  get a fresh draft going again.

To redeploy after making changes: `git add . && git commit -m "..." && git push`
— Render auto-deploys on push once it's connected to the repo.

## 4. Turn on Developer Mode in ChatGPT

1. Go to chatgpt.com → **Settings → Apps & Connectors → Advanced** (some
   accounts show this under **Settings → Security and login** instead —
   check both).
2. Toggle **Developer mode** on. This is what lets you add an app by
   pointing at your own MCP URL instead of picking from the directory.

## 5. Connect your server as an app

1. Go to **Settings → Apps → Create** (or chatgpt.com/plugins → the **+**
   button).
2. Fill in:
   - **Name**: Authoring (Prototype)
   - **Description**: Drafts investment report sections with
     citations to internal, market-data, and web sources.
   - **MCP server URL**: your public URL + `/mcp` (from ngrok, Secure MCP
     Tunnel, or your Render deployment — whichever you used in step 3)
3. Click **Create**. If the connection succeeds, you'll see the four tools
   listed. If it fails, see Troubleshooting below.

## 6. Test it in a chat

Start a new conversation and try prompts like:

> "Use the Authoring app to look into APAC channel checks, then
> draft a Channel Checks section with citations."

ChatGPT should call `search_sources`, then `render_report`, and the widget
should appear inline showing the section text with clickable `[1]` `[2]`
citation markers. Try:

- Clicking a citation marker → shows the source card underneath
- **Edit text** → make a manual change → **Done editing** → this calls
  `update_section` so the model knows about your edit for later turns
- **Ask AI to refine** → type an instruction → this sends a follow-up
  message telling the model what to change
- **Export draft** → calls `export_report` and prints Markdown with a
  numbered source list back into the chat

## 7. Iterate

- Add more fake documents to `sources.js` to test broader queries.
- Tighten the tool `description` fields if the model picks the wrong tool
  or won't call `render_report` unprompted — Apps SDK discovery is driven
  almost entirely by these descriptions.
- If you want to test protocol-level issues before touching ChatGPT at all,
  use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):
  `npx @modelcontextprotocol/inspector` and point it at your `/mcp` URL.

## Known simplifications (fix before this touches real users)

- **No auth** — anyone with your ngrok URL can call these tools. Fine for a
  solo prototype behind a random tunnel URL; not fine once real data or
  other people are involved. Add OAuth (the SDK supports DCR/OAuth 2.1) next.
- **In-memory, single draft** — `currentReport` is one global variable, not
  per-user or per-session. Good enough to test the UX; needs a real
  datastore (keyed by user + report id) before more than one person uses it.
- **Fake sources only** — swap `sources.js`'s functions for real calls to
  your document store / market-data vendor / web search once the citation
  UX is validated.
- **Stateless HTTP transport** — each request spins up a fresh MCP session
  server-side. That's fine here because the report state lives in
  `currentReport`, not in the transport session — but if you add
  multi-user support, move that state into a real store keyed by user.

## Troubleshooting

- **"Create" fails / can't connect**: confirm the ngrok URL is reachable
  from a browser in an incognito window, and that you included `/mcp` in
  the URL you gave ChatGPT.
- **Tools don't show up**: check `/tmp` or your terminal for server errors;
  re-run the `curl .../tools/list` command from this README's testing
  section against your local server directly to confirm it's healthy
  independent of ChatGPT.
- **Widget doesn't render**: confirm `resources/list` (see testing section)
  returns `ui://widget/report.html` with `mimeType: text/html+skybridge` —
  ChatGPT keys off that MIME type to know it's a widget, not a plain
  resource.

# chat

The BFFless chat demo — served at [chat.bffless.dev](https://chat.bffless.dev).

A static React 18 + Vite app with no backend of its own. The chat itself is a BFFless AI
pipeline, authored as code in `.bffless/proxy-rules/` and synced by CI.

Previously `bffless/demo-chat`, served at `chat.docs.bffless.app` with its pipelines living
only as database rows in the admin UI.

## Features

Streaming responses, conversation persistence via localStorage, markdown rendering with
syntax highlighting, rate-limit handling with countdown, suggestion buttons, stop-generation,
and keyboard shortcuts (Enter to send, Shift+Enter for newline).

## Entry points

| Path | Description |
| --- | --- |
| `/` | Full-page chat UI |
| `/popup/` | Popup widget (floating button + slide-up panel) |
| `/embed/` | Iframe-ready chat panel (no chrome, used by `embed.js`) |
| `/embed.js` | Vanilla JS snippet for embedding on any site, including Wix |

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:3002
pnpm build      # tsc && vite build && vite build --config vite.config.embed-script.ts
pnpm preview
```

## Deploys

| Workflow | Trigger | Result |
| --- | --- | --- |
| `build.yml` | push to `main` | sync rules, upload `dist/` + `.bffless/` to the `production` alias |
| `preview.yml` | any PR | per-PR rule set + `chat-pr-<N>` alias, commented on the PR |
| `cleanup-preview.yml` | PR closed | tears the per-PR alias and rule set down |

CI needs a repo variable `CHAT_ASSET_HOST_URL` (`https://admin.bffless.dev`) and a secret
`CHAT_ASSET_HOST_KEY`.

### Two uploads, not one

`build.yml` uploads **twice** to the same alias, and both are load-bearing:

- `dist/` under `base-path: /dist` — the site. The `chat.bffless.dev` domain maps to this
  `/dist` prefix.
- `.bffless/` at its default prefix — **the chatbot's knowledge**. Skills are served from
  the deployment and versioned per commit, so `skills: {mode: all}` resolves against
  whatever that step uploaded. Drop this step and the chat still works but knows nothing
  about BFFless.

### Naming

The GitHub repo, the BFFless project, and the rule set are all named `chat`. Keep it that
way: a BFFless project's `owner/name` **cannot be renamed** after creation (the API exposes
only display name, description, and visibility). The sibling `bffless` repo is stuck pinned
to a `bffless/bffless.app` project for exactly that reason.

The workflows state `repository: bffless/chat` explicitly rather than relying on the
derive-from-repo-context default, because `upload-artifact` and `deploy-proxy-rules` fall
back to *different* sources (GitHub context vs `.bffless/config.json`).

## Proxy rules as code

`.bffless/proxy-rules/chat-pipelines/` holds two rules — `POST /api/chat` (the AI handler)
and `GET /api/chat` (conversation fetch) — plus the `chat_messages` and `chat_conversations`
schemas. Synced with `prune: true`, so **git is the source of truth: a rule deleted here is
deleted live**. Schemas resolve by name via `$schema:` refs and are never deleted, so record
data is untouched.

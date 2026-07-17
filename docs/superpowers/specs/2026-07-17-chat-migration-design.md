# Chat migration: demo-chat → bffless/chat on chat.bffless.dev

**Date:** 2026-07-17
**Status:** approved, not yet implemented

Move the chat demo out of `bffless/demo-chat` into a new repo named `chat`, serve it at
`chat.bffless.dev`, and convert its pipelines from live database state into rules as code.

## Why

The chat pipelines exist only as database rows on the docs instance, edited through the
admin UI. There is no review, no history, and no way to recreate them. Everything else in
the estate has moved to rules as code; this is the last chat-shaped hole.

## Current state (verified 2026-07-17)

Live project `bffless/demo-chat` (`bb8bd54c-1dd1-4a56-bbef-a3cbba9ce6be`) on the **docs**
instance (`admin.docs.bffless.app`) holds one rule set, `chat_chat_pipelines`
(`fb97ffd1-425d-4a12-97b6-55cdaf4d6888`), with five rules:

| Rule | Handler | Fate |
| --- | --- | --- |
| `POST /api/chat` | ai_handler — haiku-4.5, skills `all`, email-contact plugin, rate limit 25/300s | **migrate** |
| `GET /api/chat` | form_handler + data_query — conversation by id | **migrate** |
| `POST /api/consulting/chat` | ai_handler — sonnet-4.6, google-calendar, post-steps → email | **drop** (consulting site is dead) |
| `GET /api/consulting/chat` | data_query | **drop** |
| `/test` | function_handler returning `request.ip` + headers | **drop** (debug leftover) |

Facts that shaped the design:

- **No project secrets** (`list_secrets` → empty). The Anthropic key is instance-level, so
  there is nothing secret to migrate.
- **Skills ship in the artifact.** `.bffless/skills/*/SKILL.md` is deployed alongside the
  site and versioned per deployment; `skills: {mode: all}` resolves against the deployed
  commit. Copying the repo carries the chatbot's knowledge. No separate migration.
- **Schemas are referenced by UUID** in the live config: `persistMessagesSchemaId`
  (`39ca633d-52b0-4859-9034-f97369c4d066`) and `persistConversationsSchemaId`
  (`a63ef05e-161f-4903-8f31-23e14e0612ea`). These are project-scoped, so a new project
  mints new IDs.
- **`$schema:` refs cover those fields.** The CLI's `SCHEMA_REF_KEYS` is
  `schemaId, persistMessagesSchemaId, persistConversationsSchemaId, conversationsSchemaId,
  messagesSchemaId` — so authored rules can reference schemas by name and stay portable.
- **`debugEnabled: true`** on three of the five rules. Always-on debug snapshots caused the
  CE backend heap OOM crash loop in June 2026.
- **bffless.dev has one project** (`bffless/bffless.app`, the landing site, deployed from
  the repo since renamed to `bffless/bffless`) and **zero domain mappings** — the site is
  served via primary content.
- **Wildcard DNS exists**: `*.bffless.dev` resolves to Cloudflare, so `chat.bffless.dev`
  needs no DNS work and rides the wildcard cert.

## Design

### Repo and naming

New **public** repo `bffless/chat`, fresh single commit, local at `repos/chat`. Source is
the `bffless/demo-chat` tree: the Vite app (entry points `/`, `/popup/`, `/embed/`,
`embed.js`) plus `.bffless/skills/`.

The BFFless project is **born** as `bffless/chat` on first deploy, because `upload-artifact`
derives the project from the GitHub repo context and the repo is already named correctly.

Even so, the workflows **pass `repository: bffless/chat` explicitly** rather than relying on
that derive. The two actions resolve their target differently — `deploy-proxy-rules` takes
`project:` and falls back to `.bffless/config.json`; `upload-artifact` takes `repository:`
and falls back to the GitHub repo context, never reading `config.json`
(`core.getInput('repository') || context.repository`). Two fallbacks means a repo rename can
silently send the rules and the artifact to different projects. Stating the target in both
places costs nothing and removes the failure mode.

> This is the one thing the landing-site migration got wrong. There, the repo was renamed
> after the project existed, and a project's `owner/name` **cannot be renamed** — the API
> exposes only display name, description, and visibility. `bffless/bffless` is therefore
> pinned to `bffless/bffless.app` permanently. Naming the repo before the first deploy is
> what avoids inheriting that here.

`bffless/demo-chat` — the GitHub repo *and* the docs-instance project — is left untouched.
`chat.docs.bffless.app` keeps serving as a live fallback until explicitly retired.

### Rules as code

One set at `.bffless/proxy-rules/chat-pipelines/` (dropping the auto-generated
`chat_chat_pipelines` name; a new project means a clean one is free):

```
.bffless/config.json                        apiUrl admin.bffless.dev, project bffless/chat
.bffless/proxy-rules/chat-pipelines/
  ruleset.yaml
  rules/api/chat/post.rule.yaml             AI chat
  rules/api/chat/get.rule.yaml              conversation fetch
  schemas/conversations.schema.yaml
  schemas/messages.schema.yaml
```

Schemas are exported from the docs project; their UUID references become
`$schema:conversations` / `$schema:messages`. The first sync creates both schemas on the new
project.

Changes from the live config, all deliberate:

- `debugEnabled: false` on both rules.
- email-contact `emailSubjectPrefix`: `"bffless.app chat request"` → `"bffless.dev chat request"`.
- Consulting and `/test` rules omitted entirely.

Preserved verbatim: the system prompt, model (`claude-haiku-4-5`), `skills: {mode: all}`,
the email-contact plugin config, message persistence, `maxHistoryMessages: 50`, and the
25-request / 300-second per-IP rate limit. `docs.bffless.app` links in the system prompt
stay — that site is still live.

### Conversation history

**Not migrated.** The new project starts with empty tables. Returning visitors hold a
localStorage `conversationId` that `GET /api/chat` won't find; it returns empty rather than
erroring. Accepted: this is demo traffic, and the old records stay queryable on the docs
instance.

### Workflows

Three, mirroring `bffless/bffless`:

| Workflow | Trigger | Result |
| --- | --- | --- |
| `build.yml` | push to `main` | build, sync rules (`prune: true`), upload `dist/` → `production` alias with the set attached |
| `preview.yml` | any PR | per-PR rule sets (`pr-<N>` suffix) + `chat-pr-<N>` alias |
| `cleanup-preview.yml` | PR closed | tear down the per-PR alias and sets |

CI config: repo variable `CHAT_ASSET_HOST_URL` (`https://admin.bffless.dev`) and secret
`CHAT_ASSET_HOST_KEY`. Separate names from the landing site's, even though both point at the
same instance.

`packageManager` is pinned in `package.json` with `pnpm/action-setup@v4` and
`--frozen-lockfile`, so CI honors the lockfile. (The landing site inherited `pnpm 8` against
a v9 lockfile from platform and silently re-resolved every build until it was fixed today.)

### Domain

Create `chat.bffless.dev` → project `bffless/chat`, alias `production`, path `/dist`,
`isSpa: true`, public. This mirrors how `chat.docs.bffless.app` is configured today.

### Landing cutover — last

Only after chat.bffless.dev is verified working: in the `bffless` repo, flip
`landing-page-pipeline`'s `/api/chat` rule `targetUrl` from `https://chat.docs.bffless.app`
to `https://chat.bffless.dev`. Until that flip the landing chat is untouched, so a failure
on the new host changes nothing user-facing.

## Order of operations

1. Scaffold `repos/chat` from the demo-chat tree; init fresh history.
2. Export the two schemas and two rules from the docs instance into authored YAML.
3. Add workflows, `.bffless/config.json`, README, `.gitignore`, lockfile.
4. Verify the build locally (all four entry points).
5. Create the GitHub repo `bffless/chat` (public), set the CI variable and secret, push.
6. First deploy creates the project, the schemas, and the rules.
7. Create the `chat.bffless.dev` domain mapping.
8. Verify end to end: page renders, `POST /api/chat` streams, `GET /api/chat` returns.
9. Only then, cut the landing site's `/api/chat` over.

## Risks

| Risk | Mitigation |
| --- | --- |
| `$schema:` doesn't resolve for the AI persist fields | Verified against `SCHEMA_REF_KEYS` in the frozen CLI bundle. |
| First deploy creates a wrongly-named project | Repo is named before first deploy; project name is then correct forever. |
| Chat answers with no BFFless knowledge | Skills ship in the artifact; verify a real question in step 8, not just a 200. |
| `prune: true` deletes live rules | The set is new and authored in full; nothing else writes to it. |
| Landing chat breaks | Cutover is last and is a one-line `targetUrl` revert. |

## Out of scope

Retiring `chat.docs.bffless.app` or the `bffless/demo-chat` project. Migrating the consulting
chat (dead). Migrating conversation records. Platform's own pnpm/lockfile mismatch.

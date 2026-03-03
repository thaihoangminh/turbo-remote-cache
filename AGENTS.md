# AGENTS.md — Turbo Remote Cache

**Project**: Turborepo-compatible remote cache on Cloudflare Workers  
**Stack**: Hono, TypeScript, Wrangler, R2, Analytics Engine  
**Last Updated**: 2025-03-03

---

## OVERVIEW

Self-hosted Turborepo remote cache using Cloudflare's edge. Stores artifacts in R2, tracks events via Analytics Engine, authenticates via bearer tokens. Single-file Worker with flat structure.

---

## STRUCTURE

```
├── src/
│   ├── index.ts      # Main Worker (314 lines) - all routes
│   └── lib/
│       └── utils.ts  # Auth helpers (timing-safe token compare)
├── wrangler.jsonc    # Environment configs (dev/staging/prod)
├── .oxfmtrc.json     # Formatter: singleQuote, no semis, 100 width
├── .oxlintrc.json    # Linter: minimal config, default rules
└── tsconfig.json     # ES2022, bundler resolution
```

---

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add API route | `src/index.ts` | All routes mounted on `/v8` base path |
| Change auth logic | `src/lib/utils.ts` | `verifyBearerToken` uses `timingSafeEqual` |
| Env bindings | `wrangler.jsonc` | R2 + Analytics Engine per environment |
| Format config | `.oxfmtrc.json` | ignores `worker-configuration.d.ts` |
| Type bindings | `worker-configuration.d.ts` | Auto-generated via `pnpm cf-typegen` |

---

## CONVENTIONS

### Code Style
- **Formatter**: `oxfmt` with single quotes, no semicolons, 100 char width
- **Types**: Strict TypeScript, explicit return types on exports
- **Naming**: camelCase functions, PascalCase types, UPPER_SNAKE constants

### API Patterns
- Base path: `/v8` (Turborepo compatibility)
- Auth middleware: global `app.use('*')` validates bearer tokens
- Error responses: JSON with `{ code, message }` shape
- Scoped keys: `team-{id}/hash`, `slug-{id}/hash`, or `default/hash`

### Environment Handling
- `ENVIRONMENT` var: 'development' | 'staging' | 'production'
- `TURBO_CACHE_TOKEN`: Required bearer token (503 if missing)
- Bindings accessed via `context.env.*` (Hono pattern)

### Async Patterns
- Route handlers use `async/await`
- Parallel batch operations via `Promise.all()`
- Stream artifacts directly from R2 (`object.body`)

---

## ANTI-PATTERNS (THIS PROJECT)

### Security
- **Never use simple string comparison for tokens** → Use `crypto.subtle.timingSafeEqual` (see `utils.ts:21`)
- **Never skip Content-Length validation** → Required on PUT, validated with `isFiniteNumber()`
- **Never leak token length** → Compare buffers of equal length first

### Error Handling
- **Don't throw raw errors** → Always use `jsonError()` wrapper with structured codes
- **Don't return generic 500s** → Map to specific codes: 'missing_token', 'unauthorized', 'artifact_not_found'

### R2 Operations
- **Don't read full artifacts into memory** → Stream via `object.body` in response
- **Don't forget metadata on PUT** → Store `duration` and `tag` in `customMetadata`

### Type Safety
- **Don't use implicit any** → `strict: true` in tsconfig
- **Don't cast response statuses** → Use `as never` for Hono status codes (line 54)

---

## COMMANDS

```bash
# Development
pnpm dev                    # Start Wrangler dev server (localhost:8787)

# Code Quality
pnpm lint                   # oxlint check
pnpm lint:fix               # oxlint --fix
pnpm fmt                    # oxfmt format
pnpm fmt:check              # oxfmt --check
pnpm check-types            # tsc --noEmit

# Deployment
pnpm deploy:staging         # wrangler deploy --env staging
pnpm deploy:production      # wrangler deploy --env production

# Types
pnpm cf-typegen             # Regenerate worker-configuration.d.ts
```

---

## NOTES

### Hash Validation
Artifacts use hex pattern `/^[a-fA-F0-9]+$/` — validated on every hash param.

### Scope Precedence
Query params resolved in order: `teamId` → `slug` → `default`

### Analytics Schema
Events written to `TURBO_CACHE_ANALYTICS`:
- `indexes[0]`: sessionId
- `indexes[1]`: source (LOCAL/REMOTE)
- `indexes[2]`: event (HIT/MISS)
- `indexes[3]`: scope
- `doubles[0]`: durationMs
- `blobs[0]`: hash

### Required Env
`TURBO_CACHE_TOKEN` must be set via `.dev.vars` locally or Secrets in production. Worker returns 503 `missing_token` if unset.

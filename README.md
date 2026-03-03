# Turbo Cache Worker

Internal Cloudflare Worker that provides a Turborepo-compatible remote cache for VNPromo. It stores artifacts in R2 and records cache events in Analytics Engine. The worker is implemented with Hono and expects all requests to be authenticated with a bearer token.

## Features

- Turborepo-compatible artifact read/write endpoints
- Scoped cache keys via `teamId` or `slug` query params
- R2 storage for cache artifacts
- Analytics Engine ingestion for cache hit/miss events
- Lightweight status endpoint for health checks

## Authentication

All routes require `Authorization: Bearer <token>`. The token must match the `TURBO_CACHE_TOKEN` binding configured in the worker environment.

Example setup for local CLI usage:

```bash
export TURBO_CACHE_URL="https://your-worker.example.com"
export TURBO_CACHE_TOKEN="<token>"
```

## Configuration

Worker bindings:

- `TURBO_CACHE_BUCKET`: R2 bucket that stores artifacts
- `TURBO_CACHE_ANALYTICS`: Analytics Engine dataset for cache events
- `TURBO_CACHE_TOKEN`: bearer token for request auth
- `ENVIRONMENT`: environment label (used for ops/diagnostics)

Wrangler defaults for development live in `wrangler.jsonc` and point to the staging R2 bucket and Analytics Engine dataset.

## Local development

Start the worker:

```bash
cd apps/turbo-cache
pnpm dev
```

Verify Turbo remote cache locally:

1. Authenticate Turbo CLI against the worker:

```bash
turbo login --manual
```

Use the prompts:

- Remote Cache URL: `http://localhost:8787`
- Team selection: `id`
- Team ID: `thaihoangminh`
- Token: `dev-token`

2. Clear the local cache (optional):

```bash
rm -rf ./.turbo/cache ./apps/*/.turbo
```

3. Run a build to populate remote cache:

```bash
TURBO_REMOTE_CACHE_SIGNATURE_KEY="hvlrEECjqtouKAIG69S1ey4+Er0ecCJ8NnhI/Y27D2c=" \
  pnpm build -F vnp-web...
```

4. Verify artifacts exist in R2:

- Look for keys like `default/<hash>` or `team-<teamId>/<hash>`.

Deploy with Wrangler:

```bash
pnpm deploy
```

## Cache scoping

Artifacts are stored under a scoped key:

- `teamId` query param -> `team-<teamId>/<hash>`
- `slug` query param -> `slug-<slug>/<hash>`
- no scope -> `default/<hash>`

Use the same query params consistently for HEAD/GET/PUT/POST calls so the worker looks up the correct scope.

## API

All requests below assume:

```bash
export BASE_URL="https://your-worker.example.com"
export TOKEN="<token>"
```

### GET /artifacts/status

Check that the cache worker is enabled.

```bash
curl -s "$BASE_URL/artifacts/status" \
  -H "Authorization: Bearer $TOKEN"
```

### HEAD /artifacts/:hash

Check if an artifact exists. Returns `Content-Length` and optional metadata headers.

```bash
curl -I "$BASE_URL/artifacts/abcdef1234?teamId=core" \
  -H "Authorization: Bearer $TOKEN"
```

### GET /artifacts/:hash

Fetch an artifact body.

```bash
curl "$BASE_URL/artifacts/abcdef1234?teamId=core" \
  -H "Authorization: Bearer $TOKEN" \
  -o artifact.tgz
```

### PUT /artifacts/:hash

Store an artifact body. `Content-Length` must be present (curl adds it automatically). Optional metadata headers include `x-artifact-duration` and `x-artifact-tag`.

```bash
curl -X PUT "$BASE_URL/artifacts/abcdef1234?teamId=core" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-artifact-duration: 1520" \
  -H "x-artifact-tag: build" \
  --data-binary @artifact.tgz
```

### POST /artifacts

Batch query artifact metadata. Returns a map of hash to metadata, null, or error.

```bash
curl -X POST "$BASE_URL/artifacts?teamId=core" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"hashes":["abcdef1234","deadbeef5678"]}'
```

### POST /artifacts/events

Record cache events for analytics.

```bash
curl -X POST "$BASE_URL/artifacts/events?teamId=core" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '[
    {"sessionId":"run-1","source":"REMOTE","event":"HIT","hash":"abcdef1234","duration":42},
    {"sessionId":"run-1","source":"REMOTE","event":"MISS","hash":"deadbeef5678","duration":12}
  ]'
```

## Metadata headers

Stored artifact metadata is surfaced via response headers:

- `x-artifact-duration`: task duration in milliseconds
- `x-artifact-tag`: optional tag string

## Error responses

Errors are returned as JSON:

```json
{
  "code": "bad_request",
  "message": "Invalid artifact hash."
}
```

Common codes:

- `missing_token`
- `unauthorized`
- `forbidden`
- `bad_request`
- `artifact_not_found`

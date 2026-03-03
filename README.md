<!-- prettier-ignore -->
<div align="center">

<h1>Turbo Remote Cache</h1>

[![Deploy with Wrangler](https://img.shields.io/badge/Deploy-Wrangler-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/wrangler/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Hono](https://img.shields.io/badge/Hono-E36002?style=flat-square&logo=hono&logoColor=white)](https://hono.dev)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

A [Cloudflare Worker](https://workers.cloudflare.com) that provides a [Turborepo](https://turbo.build)-compatible remote cache. Store build artifacts in R2, track cache events with Analytics Engine, and speed up your CI/CD pipelines.

</div>

## Overview

This Worker implements the Turborepo remote cache API, letting you self-host your cache infrastructure on Cloudflare's edge network. It supports artifact storage, batch queries, and cache analytics while keeping everything secure with bearer token authentication.

## Features

- **Turborepo-Compatible API** - Full implementation of the Turborepo remote cache protocol
- **Artifact Storage** - Store and retrieve build artifacts in Cloudflare R2
- **Batch Operations** - Query multiple artifacts in a single request
- **Cache Analytics** - Track cache hits and misses with Analytics Engine
- **Scoped Caching** - Isolate caches per team or project using query parameters
- **Bearer Token Auth** - Secure access with configurable authentication tokens

## Prerequisites

- [Node.js](https://nodejs.org) 20 or later
- [pnpm](https://pnpm.io) package manager
- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) authenticated with your Cloudflare account

## Quick Start

### 1. Clone and install

```bash
git clone <repository-url>
cd turbo-remote-cache
pnpm install
```

### 2. Configure environment

Copy the example variables file and set your token:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```
TURBO_CACHE_TOKEN=your-secure-random-token
ENVIRONMENT=development
```

> [!NOTE]
> The `TURBO_CACHE_TOKEN` is required. Without it, the Worker returns a 503 error with code `missing_token`.

### 3. Start local development

```bash
pnpm dev
```

The Worker runs at `http://localhost:8787`.

## Configuration

### Wrangler Configuration

The Worker uses `wrangler.jsonc` for configuration with three environments:

| Environment | Domain                            | R2 Bucket                       | Analytics Dataset                      |
| ----------- | --------------------------------- | ------------------------------- | -------------------------------------- |
| Development | `dev.turbo-cache.example.com`     | `turbo-remote-cache-staging`    | `turbo-remote-cache-events-staging`    |
| Staging     | `staging.turbo-cache.example.com` | `turbo-remote-cache-staging`    | `turbo-remote-cache-events-staging`    |
| Production  | `turbo-cache.example.com`         | `turbo-remote-cache-production` | `turbo-remote-cache-events-production` |

### Required Bindings

| Binding                 | Type                 | Description                      |
| ----------------------- | -------------------- | -------------------------------- |
| `TURBO_CACHE_BUCKET`    | R2 Bucket            | Storage for cache artifacts      |
| `TURBO_CACHE_ANALYTICS` | Analytics Engine     | Dataset for cache event tracking |
| `TURBO_CACHE_TOKEN`     | Environment Variable | Bearer token for authentication  |

### Deploying to Cloudflare

**Staging:**

```bash
pnpm deploy:staging
```

**Production:**

```bash
pnpm deploy:production
```

> [!IMPORTANT]
> Update the `TURBO_CACHE_TOKEN` value in `wrangler.jsonc` for each environment before deploying. The default value is `<PLACEHOLDER>`.

## Using with Turborepo

### 1. Configure environment variables

```bash
export TURBO_CACHE_URL="https://your-worker.example.com"
export TURBO_CACHE_TOKEN="your-token"
```

### 2. Login with Turbo CLI

```bash
turbo login --manual
```

Follow the prompts:

- Remote Cache URL: `https://your-worker.example.com`
- Team selection: `id`
- Team ID: `your-team-id` (or any identifier)
- Token: `your-token`

### 3. Run your build

```bash
turbo build
```

Turborepo automatically uses the remote cache for subsequent runs.

## Cache Scoping

Artifacts are stored with scoped keys to support multi-team or multi-project setups:

| Query Parameter | Key Format             | Example                |
| --------------- | ---------------------- | ---------------------- |
| `teamId`        | `team-{teamId}/{hash}` | `team-core/abc123...`  |
| `slug`          | `slug-{slug}/{hash}`   | `slug-myapp/abc123...` |
| (none)          | `default/{hash}`       | `default/abc123...`    |

Use the same scope parameters consistently across all API calls.

## API Reference

All endpoints are prefixed with `/v8` and require `Authorization: Bearer <token>`.

### Check Cache Status

```bash
GET /v8/artifacts/status
```

Returns `{ "status": "enabled" }` when the cache is operational.

### Check Artifact Existence

```bash
HEAD /v8/artifacts/:hash?teamId=<team>
```

Returns `200` with `Content-Length` header if the artifact exists, `404` otherwise.

### Download Artifact

```bash
GET /v8/artifacts/:hash?teamId=<team>
```

Returns the artifact body with `Content-Type: application/octet-stream`.

### Upload Artifact

```bash
PUT /v8/artifacts/:hash?teamId=<team>
```

**Headers:**

- `Content-Length` (required) - Size of the artifact in bytes
- `x-artifact-duration` (optional) - Task duration in milliseconds
- `x-artifact-tag` (optional) - Custom tag for the artifact

**Response:**

```json
{
  "urls": ["https://your-worker.example.com/v8/artifacts/abc123"]
}
```

### Batch Query Artifacts

```bash
POST /v8/artifacts?teamId=<team>
```

**Request Body:**

```json
{
  "hashes": ["abc123...", "def456..."]
}
```

**Response:**

```json
{
  "abc123...": {
    "size": 1024,
    "taskDurationMs": 1520,
    "tag": "build"
  },
  "def456...": null
}
```

Returns `null` for missing artifacts and includes error details for invalid hashes.

### Record Cache Events

```bash
POST /v8/artifacts/events?teamId=<team>
```

**Request Body:**

```json
[
  {
    "sessionId": "run-1",
    "source": "REMOTE",
    "event": "HIT",
    "hash": "abc123...",
    "duration": 42
  }
]
```

Events are written to the Analytics Engine dataset for monitoring cache performance.

## Error Responses

Errors return JSON with a `code` and `message`:

```json
{
  "code": "unauthorized",
  "message": "Invalid bearer token."
}
```

| Code                 | HTTP Status | Description                     |
| -------------------- | ----------- | ------------------------------- |
| `missing_token`      | 503         | Worker token not configured     |
| `unauthorized`       | 401         | Missing or invalid bearer token |
| `forbidden`          | 403         | Token mismatch                  |
| `bad_request`        | 400         | Invalid request parameters      |
| `artifact_not_found` | 404         | Artifact does not exist         |

## Development

### Available Scripts

| Command                  | Description                      |
| ------------------------ | -------------------------------- |
| `pnpm dev`               | Start local development server   |
| `pnpm deploy:staging`    | Deploy to staging environment    |
| `pnpm deploy:production` | Deploy to production environment |
| `pnpm lint`              | Run linter (oxlint)              |
| `pnpm lint:fix`          | Fix linting issues               |
| `pnpm fmt`               | Format code (oxfmt)              |
| `pnpm check-types`       | Run TypeScript type checking     |
| `pnpm cf-typegen`        | Generate Cloudflare types        |

### Project Structure

```
.
├── src/
│   └── index.ts          # Main Worker implementation
├── .dev.vars.example     # Example environment variables
├── wrangler.jsonc        # Wrangler configuration
├── package.json          # Dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

## Analytics

Cache events sent to `/v8/artifacts/events` are stored in Analytics Engine with these fields:

| Field     | Description                  |
| --------- | ---------------------------- |
| `index1`  | Session ID                   |
| `index2`  | Source (`LOCAL` or `REMOTE`) |
| `index3`  | Event type (`HIT` or `MISS`) |
| `index4`  | Scope (team/slug identifier) |
| `double1` | Duration in milliseconds     |
| `blob1`   | Artifact hash                |

Query these events in the Cloudflare dashboard to analyze cache hit rates and performance.

## Related Resources

- [Turborepo Remote Caching](https://turbo.build/repo/docs/core-concepts/remote-caching)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Cloudflare Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)
- [Hono Framework](https://hono.dev)

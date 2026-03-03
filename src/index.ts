import type { Context } from 'hono'
import { Hono } from 'hono'

const HASH_PATTERN = /^[a-fA-F0-9]+$/
const DEFAULT_SCOPE = 'default'

type Bindings = {
  TURBO_CACHE_TOKEN: string
  TURBO_CACHE_BUCKET: R2Bucket
  TURBO_CACHE_ANALYTICS: AnalyticsEngineDataset
}

type ArtifactInfo = {
  size: number
  taskDurationMs: number
  tag?: string
}

type ArtifactError = {
  error: {
    message: string
  }
}

type CacheEvent = {
  sessionId: string
  source: 'LOCAL' | 'REMOTE'
  event: 'HIT' | 'MISS'
  hash: string
  duration?: number
}

type QueryParams = Record<string, string | undefined>

type ArtifactMetadata = Record<string, string>

type HonoContext = Context<{ Bindings: Bindings }>

type ArtifactQueryRequest = {
  hashes: string[]
}

type ErrorResponse = {
  code: string
  message: string
}

const app = new Hono<{ Bindings: Bindings }>().basePath('/v8')

const jsonError = (context: HonoContext, body: ErrorResponse, status: number) => {
  return context.json(body, status as never)
}

const jsonBadRequest = (context: HonoContext, message: string) =>
  jsonError(context, { code: 'bad_request', message }, 400)

const jsonUnauthorized = (context: HonoContext, message: string) =>
  jsonError(context, { code: 'unauthorized', message }, 401)

const jsonForbidden = (context: HonoContext, message: string) =>
  jsonError(context, { code: 'forbidden', message }, 403)

const jsonNotFound = (context: HonoContext, message: string) =>
  jsonError(context, { code: 'artifact_not_found', message }, 404)

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value)
}

app.use('*', async (context, next) => {
  const authHeader = context.req.header('authorization')
  const expected = context.env.TURBO_CACHE_TOKEN

  if (!expected) {
    return jsonError(
      context,
      {
        code: 'missing_token',
        message: 'Remote cache token is not configured.',
      },
      500,
    )
  }

  if (!authHeader?.startsWith('Bearer ')) {
    return jsonUnauthorized(context, 'Missing bearer token.')
  }

  const token = authHeader.slice('Bearer '.length).trim()
  if (token !== expected) {
    return jsonForbidden(context, 'Invalid bearer token.')
  }

  await next()
})

app.get('/artifacts/status', (context) => {
  return context.json({ status: 'enabled' })
})

app.on('HEAD', '/artifacts/:hash', async (context) => {
  const hash = context.req.param('hash')
  if (!HASH_PATTERN.test(hash)) {
    return jsonBadRequest(context, 'Invalid artifact hash.')
  }

  const query = context.req.query()
  const key = buildArtifactKey(query, hash)
  const object = await context.env.TURBO_CACHE_BUCKET.head(key)

  if (!object) {
    return jsonNotFound(context, 'Artifact not found.')
  }

  const headers = new Headers()
  headers.set('Content-Length', object.size.toString())
  addArtifactHeaders(headers, object.customMetadata)

  return new Response(null, {
    status: 200,
    headers,
  })
})

app.get('/artifacts/:hash', async (context) => {
  const hash = context.req.param('hash')
  if (!HASH_PATTERN.test(hash)) {
    return jsonBadRequest(context, 'Invalid artifact hash.')
  }

  const query = context.req.query()
  const key = buildArtifactKey(query, hash)
  const object = await context.env.TURBO_CACHE_BUCKET.get(key)

  if (!object) {
    return jsonNotFound(context, 'Artifact not found.')
  }

  const headers = new Headers()
  headers.set('Content-Length', object.size.toString())
  headers.set('Content-Type', 'application/octet-stream')
  addArtifactHeaders(headers, object.customMetadata)

  return new Response(object.body, {
    status: 200,
    headers,
  })
})

app.put('/artifacts/:hash', async (context) => {
  const hash = context.req.param('hash')
  if (!HASH_PATTERN.test(hash)) {
    return jsonBadRequest(context, 'Invalid artifact hash.')
  }

  const contentLength = context.req.header('content-length')
  const parsedLength = contentLength ? Number(contentLength) : Number.NaN

  if (!isFiniteNumber(parsedLength) || parsedLength < 0) {
    return jsonBadRequest(context, 'Content-Length header is required.')
  }

  const query = context.req.query()
  const key = buildArtifactKey(query, hash)
  const durationHeader = context.req.header('x-artifact-duration')
  const tagHeader = context.req.header('x-artifact-tag')
  const metadata: ArtifactMetadata = {
    size: parsedLength.toString(),
  }

  if (durationHeader) {
    metadata.duration = durationHeader
  }

  if (tagHeader) {
    metadata.tag = tagHeader
  }

  const body = context.req.raw.body
  if (!body) {
    return jsonBadRequest(context, 'Artifact body is required.')
  }

  await context.env.TURBO_CACHE_BUCKET.put(key, body, {
    customMetadata: metadata,
  })

  return context.json(
    {
      urls: [buildArtifactUrl(context.req.url, hash)],
    },
    200,
  )
})

app.post('/artifacts', async (context) => {
  const body = await context.req.json().catch(() => null)
  const payload = body as ArtifactQueryRequest | null
  const hashes = payload?.hashes

  if (!Array.isArray(hashes)) {
    return jsonBadRequest(context, 'hashes must be an array of artifact hashes.')
  }

  const results: Record<string, ArtifactInfo | ArtifactError | null> = {}
  const scope = resolveScope(context.req.query())

  await Promise.all(
    hashes.map(async (hash) => {
      if (!HASH_PATTERN.test(hash)) {
        results[hash] = {
          error: {
            message: 'Invalid artifact hash.',
          },
        }
        return
      }

      const key = `${scope}/${hash}`
      const object = await context.env.TURBO_CACHE_BUCKET.head(key)

      if (!object) {
        results[hash] = null
        return
      }

      results[hash] = {
        size: object.size,
        taskDurationMs: toNumber(object.customMetadata?.duration),
        tag: object.customMetadata?.tag,
      }
    }),
  )

  return context.json(results)
})

app.post('/artifacts/events', async (context) => {
  const body = await context.req.json().catch(() => null)

  if (!Array.isArray(body)) {
    return jsonBadRequest(context, 'Request body must be an array of events.')
  }

  const events = body as CacheEvent[]
  const scope = resolveScope(context.req.query())

  for (const event of events) {
    if (!event?.sessionId || !event?.source || !event?.event || !event?.hash) {
      return jsonBadRequest(context, 'Invalid cache event payload.')
    }

    context.env.TURBO_CACHE_ANALYTICS.writeDataPoint({
      indexes: [event.sessionId, event.source, event.event, scope],
      doubles: [event.duration ?? 0],
      blobs: [event.hash],
    })
  }

  return context.json({ ok: true })
})

function resolveScope(query: QueryParams): string {
  const teamId = query.teamId?.trim()
  if (teamId) {
    return `team-${teamId}`
  }

  const slug = query.slug?.trim()
  if (slug) {
    return `slug-${slug}`
  }

  return DEFAULT_SCOPE
}

function buildArtifactKey(query: QueryParams, hash: string): string {
  const scope = resolveScope(query)
  return `${scope}/${hash}`
}

function addArtifactHeaders(headers: Headers, metadata?: ArtifactMetadata): void {
  if (metadata?.duration) {
    headers.set('x-artifact-duration', metadata.duration)
  }

  if (metadata?.tag) {
    headers.set('x-artifact-tag', metadata.tag)
  }
}

function toNumber(value: string | undefined): number {
  if (!value) {
    return 0
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildArtifactUrl(requestUrl: string, hash: string): string {
  const url = new URL(requestUrl)
  url.pathname = `/artifacts/${hash}`
  return url.toString()
}

export default app

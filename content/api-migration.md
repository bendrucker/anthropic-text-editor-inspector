# Migrating to the v2 Ingest API

The v1 ingest endpoints are deprecated and stop accepting writes at the end of the quarter. This note covers the three changes that break existing clients, in the order they are worth making.

## Authentication

v1 accepted a bearer token in either the header or the query string. v2 accepts it in the header only, and a token in the query string is rejected before routing.

```http
POST /v2/ingest/events
Authorization: Bearer <token>
Content-Type: application/json
```

A request that still passes the token as a query parameter gets a 410 rather than a 401, because the parameter itself is deprecated rather than the credential.

## Batching

v1 took one event per request. v2 takes an envelope, and a single-event write is just an envelope of length one.

```json
{
  "batch": [
    { "type": "page_view", "at": "2026-03-01T10:00:00Z" },
    { "type": "click", "at": "2026-03-01T10:00:04Z" }
  ]
}
```

The envelope is capped at 500 events. A larger batch is rejected whole rather than truncated, so a client that splits on the boundary never lands in a partially accepted state.

```python
def send(events):
    for i in range(0, len(events), 500):
        post("/v2/ingest/events", json={"batch": events[i : i + 500]})
```

## Error Handling

v1 returned 200 with an error body for anything it could partially process. v2 always signals through the status code.

```
200  every event accepted
207  some accepted, per-event results in the body
400  envelope malformed, nothing accepted
410  endpoint or parameter deprecated
429  rate limited, retry after the header value
```

The 207 case is the one most v1 clients get wrong. They treat any 2xx as total success, which silently drops the rejected members of the batch.

## Timeline

The v1 endpoints are deprecated now and read-only from the first of next month. Anything still writing to v1 after that receives a 410 on every request.

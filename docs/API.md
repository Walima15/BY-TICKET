# API Reference

> **Status:** Phase 1 ships `GET /api/health`. The other endpoints are the planned surface and are documented
> here as they land in Phases 3–7.

Conventions:
- JSON in/out, request bodies validated with zod; errors return `{ "error": { "code", "message", "details?" } }`.
- Auth via the Supabase session cookie; role checks on the server and RLS in Postgres.
- Mutations accept an `Idempotency-Key` header; repeat requests return the original result.
- Rate-limited per IP + user; `429` with `Retry-After` when exceeded.

## Implemented

### `GET /api/health`
Liveness and configuration check (never exposes secrets).

```json
{
  "status": "ok",
  "app": "BY Tickets",
  "network": "testnet",
  "rpc": { "url": "https://soroban-testnet.stellar.org", "reachable": true, "latestLedger": 123456 },
  "configured": { "supabase": false, "contracts": false, "qrSigning": false, "custodialKeys": false }
}
```

## Planned

| Method | Path | Role | Phase |
|---|---|---|---|
| `GET` | `/api/events` | public | 4 |
| `GET` | `/api/events/:id` | public | 4 |
| `POST` | `/api/purchases/prepare` | customer | 4 |
| `POST` | `/api/purchases/submit` | customer | 4 |
| `GET` | `/api/me/tickets` | customer | 5 |
| `POST` | `/api/tickets/:id/credential` | ticket owner | 5 |
| `POST` | `/api/tickets/:id/transfer` | ticket owner | 5 |
| `POST` | `/api/checkins/sync` | scanner | 5 |
| `POST` | `/api/organizer/events` | organizer | 6 |
| `PATCH` | `/api/organizer/events/:id` | organizer | 6 |
| `GET` | `/api/organizer/events/:id/analytics` | organizer | 6 |
| `GET` | `/api/organizer/payouts` | organizer | 6 |
| `GET` | `/api/me/rewards` | customer | 7 |
| `POST` | `/api/rewards/redeem` | customer | 7 |
| `POST` | `/api/admin/organizers/:id/approve` | admin | 6 |
| `PATCH` | `/api/admin/fees` | admin | 6 |
| `GET` | `/api/admin/stats` | admin | 6 |

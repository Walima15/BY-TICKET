# Architecture

BY Tickets is a mobile-first PWA backed by Supabase for off-chain data and Stellar/Soroban as the source of
truth for **ownership, transfers, check-ins, points and badges**.

## System overview

```mermaid
flowchart LR
  subgraph Client["Client (PWA, mobile-first)"]
    C[Customer app<br/>browse · buy · My Tickets · rewards]
    O[Organizer dashboard<br/>events · tiers · analytics · payouts]
    S[Staff scanner<br/>camera QR · offline queue]
    A[Admin console<br/>approvals · fees · stats]
    FW[(Freighter wallet)]
    IDB[(IndexedDB<br/>offline check-in queue)]
  end

  subgraph Server["Next.js server (Route Handlers / Server Actions)"]
    API[REST API /api/*<br/>zod validation · rate limiting]
    QR[QR credential signer<br/>Ed25519]
    CUS[Custodial signer<br/>AES-GCM encrypted keys]
    PAY[Payment service<br/>USDC/XLM + PaymentRampAdapter]
    IDX[Chain indexer / sync<br/>contract events → DB]
  end

  subgraph Supabase
    AUTH[Auth<br/>email OTP / magic link]
    DB[(Postgres + RLS)]
    ST[(Storage<br/>event posters)]
  end

  subgraph Stellar["Stellar network (testnet → mainnet)"]
    RPC[Soroban RPC]
    ET[event_ticket contract]
    RW[rewards contract<br/>BY Points SEP-41]
    BG[attendance_badge contract]
    USDC[USDC SAC]
  end

  MM[[Mobile money ramp<br/>MTN · Airtel · Zamtel<br/>stub]]

  C & O & A --> API
  S --> IDB --> API
  C -- sign tx --> FW
  FW --> RPC
  API --> AUTH & DB & ST
  API --> QR & CUS & PAY
  CUS --> RPC
  PAY --> MM
  RPC --> ET
  ET -- mint on purchase / attendance --> RW
  ET -- mint after check-in --> BG
  ET -- payment & revenue split --> USDC
  IDX -- getEvents --> RPC
  IDX --> DB
```

## Ticket purchase (wallet user)

```mermaid
sequenceDiagram
  autonumber
  participant U as Customer (PWA)
  participant F as Freighter
  participant API as Next.js API
  participant RPC as Soroban RPC
  participant ET as event_ticket
  participant TK as USDC SAC
  participant RW as rewards

  U->>API: POST /api/purchases/prepare {eventId, tierId, buyer}
  API->>API: validate (zod), rate-limit, check capacity & sale window
  API->>RPC: simulate mint_ticket(...)
  API-->>U: unsigned XDR + idempotency key
  U->>F: signTransaction(xdr)
  F-->>U: signed XDR
  U->>API: POST /api/purchases/submit {signedXdr, idempotencyKey}
  API->>RPC: sendTransaction
  RPC->>ET: mint_ticket(buyer, tier)
  ET->>TK: transfer price buyer→splits (organizer / artist / platform)
  ET->>RW: mint(buyer, purchase points)
  ET-->>RPC: ticket_id + events
  API->>API: record ticket (pending → confirmed), idempotent on key
  API-->>U: ticket confirmed
```

Email (custodial) users follow the same flow, except the server signs with the user's decrypted custodial
key and the platform account sponsors fees.

## Check-in (works offline)

```mermaid
sequenceDiagram
  autonumber
  participant H as Holder device
  participant S as Scanner (staff PWA)
  participant Q as IndexedDB queue
  participant API as Next.js API
  participant ET as event_ticket
  participant BG as attendance_badge

  H->>H: render QR = credential + timestamp, signed by device key (rotates ~20s)
  S->>S: verify server sig (public key) + device sig + freshness
  S->>Q: check local seen-set → accept & enqueue
  Note over S,Q: works with no connectivity
  Q-->>API: sync when online (batched, idempotent)
  API->>ET: validate_and_check_in(ticket_id, scanner)
  ET->>ET: reject if already used (final double-entry guard)
  ET->>BG: mint_badge(event, attendee)
  API-->>S: confirmed / conflict list
```

## Responsibilities: on-chain vs off-chain

| Concern | On-chain (Soroban) | Off-chain (Supabase) |
|---|---|---|
| Ticket ownership & transfers | ✅ source of truth | mirrored for fast queries |
| Capacity / oversell | ✅ enforced in `mint_ticket` | pre-check for UX only |
| Check-in / double entry | ✅ final | offline seen-set on scanner |
| Points & badges | ✅ | cached balances & history |
| Event descriptions, images, tiers metadata | — | ✅ (+ hash anchored on-chain) |
| Users, roles, organizer approval | role addresses on-chain | ✅ profiles, RLS |

## Code layout

```
apps/web/src/
  app/            routes (customer, organizer, scanner, admin) + /api route handlers
  components/     ui/ (shadcn), layout/, feature components
  lib/
    env.ts        zod-validated environment
    stellar/      network config, RPC client, contract clients, Freighter helpers
    supabase/     browser / server / admin clients
    payments/     pricing (USDC ↔ ZMW), PaymentRampAdapter + stub
    security/     rate limiting, QR credentials, key encryption
contracts/        Soroban workspace: event_ticket, rewards, attendance_badge
supabase/         migrations/, seed.sql
scripts/          gen-secrets, deploy-testnet
```

# BY Tickets

**Buy. Attend. Earn. Connect.**

Blockchain-powered event ticketing and rewards on the [Stellar](https://stellar.org) network, built for small
organizers, artists, promoters, venues and community events in Zambia and across Africa. Mobile-first PWA,
friendly to low-bandwidth connections.

- **Organizers** list events, sell tickets, set transfer/resale rules, split revenue, scan at the door.
- **Customers** discover events, buy with a Stellar wallet *or* just an email, earn BY Points, collect badges.
- **Tickets** are verifiable on-chain; check-in is single-use; QR codes rotate and can't be screenshotted.

> Status: **Phase 1 of 8 complete** (scaffold). See [docs/ROADMAP.md](docs/ROADMAP.md).

## Stack

| Layer | Tech |
|---|---|
| Web | Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui (Base UI) · PWA |
| Backend | Next.js Route Handlers / Server Actions · Supabase (Postgres + RLS, Auth, Storage) · zod |
| Chain | Stellar testnet · Soroban contracts in Rust (`soroban-sdk` 28) · `@stellar/stellar-sdk` · Freighter |
| Payments | USDC / XLM on Stellar · ZMW display pricing · mobile-money adapter interface (stub) |

## Repository layout

```
.
├── apps/web/                 Next.js PWA (customer, organizer, scanner, admin, /api)
│   ├── .env.example          environment template (copy to apps/web/.env.local)
│   └── src/
│       ├── app/              routes + api/health
│       ├── components/       ui/ (shadcn), layout/, brand/
│       └── lib/              env, stellar/, supabase/, payments/, security/
├── contracts/                Soroban Cargo workspace
│   ├── event_ticket/         events, tickets, transfers, check-in, revenue split
│   ├── rewards/              BY Points (SEP-41 token)
│   └── attendance_badge/     proof-of-attendance badges
├── supabase/                 migrations/ + seed.sql
├── scripts/                  gen-secrets.mjs (+ testnet deploy in Phase 2)
└── docs/                     ARCHITECTURE · CONTRACTS · API · SECURITY · DECISIONS · ROADMAP
```

## Prerequisites

- **Node.js ≥ 20.9** (22 LTS recommended)
- **Rust ≥ 1.91** with the Soroban target: `rustup target add wasm32v1-none`
- **A linker for Rust on Windows**, one of:
  - Visual Studio Build Tools with the **"Desktop development with C++"** workload (default MSVC toolchain), or
  - the GNU toolchain, which ships its own linker:
    `rustup toolchain install stable-x86_64-pc-windows-gnu --target wasm32v1-none`, then run cargo as
    `cargo +stable-x86_64-pc-windows-gnu ...`
- **Stellar CLI** (Phase 2, for build + deploy): `winget install --id Stellar.StellarCLI` or
  `cargo install --locked stellar-cli` — see the [Stellar docs](https://developers.stellar.org/docs/tools/cli/install-cli)
- A **Supabase** project (Phase 3) — free tier is fine
- **Freighter** browser extension, set to *Testnet*, for wallet testing

## Quick start

```bash
# 1. install web deps and create apps/web/.env.local with generated secrets
npm run setup

# 2. (optional) fund the platform account on testnet via Friendbot
npm run secrets -- --fund

# 3. run the app
npm run dev            # http://localhost:3000
# health check:        http://localhost:3000/api/health

# 4. contracts
npm run contracts:test
```

`npm run setup` copies `apps/web/.env.example` to `apps/web/.env.local` and fills in:

| Variable | What |
|---|---|
| `CUSTODIAL_KEY_ENCRYPTION_KEY` | AES-256-GCM key for email users' wallet secrets |
| `QR_CREDENTIAL_SIGNING_KEY` / `NEXT_PUBLIC_QR_CREDENTIAL_PUBLIC_KEY` | Ed25519 pair for signed ticket QR credentials |
| `STELLAR_PLATFORM_SECRET` / `NEXT_PUBLIC_STELLAR_PLATFORM_PUBLIC_KEY` | testnet platform account (fee sponsor, platform fee receiver) |

You then add your Supabase URL + keys by hand (Phase 3); contract IDs are written by the deploy script (Phase 2).
Every variable is documented in [`apps/web/.env.example`](apps/web/.env.example) and validated with zod at startup.

## Scripts (repo root)

| Command | Does |
|---|---|
| `npm run setup` | install web deps + generate secrets |
| `npm run secrets [-- --fund \| --force]` | (re)generate missing secrets; `--fund` uses testnet Friendbot |
| `npm run dev` / `build` / `start` | Next.js app |
| `npm run typecheck` / `lint` | TypeScript + ESLint |
| `npm run contracts:test` | `cargo test` for all contracts |
| `npm run contracts:build` | `stellar contract build` → WASM |
| `npm run check` | typecheck + lint + contract tests |

## Deploy

- **Contracts → testnet:** Phase 2 adds `scripts/deploy-testnet` (build, deploy, initialise, write IDs into
  `apps/web/.env.local`).
- **Web:** any Node host (Vercel, Fly, Render, or a VPS). Set every variable from `.env.example` in the host's
  environment; `NEXT_PUBLIC_*` values are baked in at build time, so rebuild after changing them.

## Security

Keys and secrets are never committed and never put in `NEXT_PUBLIC_*` variables. Deployer/admin keys live
in the Stellar CLI keystore, not in `.env`. See [docs/SECURITY.md](docs/SECURITY.md).

## Notes for this machine

This repo currently sits in a **OneDrive-synced folder**. That works, but `node_modules`, `.next` and
`contracts/target` make sync slow and can cause file-lock errors. Prefer moving the repo outside OneDrive
(e.g. `C:\dev\by-tickets`) or excluding those folders from sync.

## Docs

- [Architecture (mermaid diagrams)](docs/ARCHITECTURE.md)
- [Contract specs](docs/CONTRACTS.md)
- [API reference](docs/API.md)
- [Security & key handling](docs/SECURITY.md)
- [Decisions & assumptions](docs/DECISIONS.md)
- [Roadmap](docs/ROADMAP.md)

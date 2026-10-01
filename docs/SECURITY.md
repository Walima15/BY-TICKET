# Security & Key Handling

## Secrets inventory

| Secret | Where it lives | Used by | Rotation |
|---|---|---|---|
| `SUPABASE_SECRET_KEY` | server env only | admin DB tasks, indexer | Supabase dashboard → API keys |
| `STELLAR_PLATFORM_SECRET` | server env only (testnet); KMS on mainnet | fee sponsorship, custodial account creation | new keypair → update signer on platform account |
| `CUSTODIAL_KEY_ENCRYPTION_KEY` | server env only; KMS on mainnet | AES-256-GCM encryption of custodial wallet secrets | key version prefix on ciphertext; re-encrypt job |
| `QR_CREDENTIAL_SIGNING_KEY` | server env only | signs ticket credentials | publish new public key; scanners accept old+new during overlap |
| Contract deployer / admin | `stellar keys` identity `by-deployer`, stored in the `by-stellar-config` Docker volume, **not** in `.env` or the repo (`by-usdc-issuer` and the `by-smoke-*` test identities live there too) | deploy + admin calls | transfer admin role to a multisig account before mainnet |

Rules:
1. **Never** put a secret in a `NEXT_PUBLIC_*` variable — those are inlined into browser JS.
2. `.env.local` is git-ignored; only `.env.example` (no real values) is committed.
3. Plaintext private keys never touch the database or logs. Custodial secrets are stored as
   `v1:<iv>:<ciphertext>:<tag>` and decrypted in memory only for the duration of a signature.
4. Env is validated with zod: `apps/web/src/lib/env.ts` (public values) and `apps/web/src/lib/env.server.ts`
   (secrets, guarded by `server-only`, so importing it from a Client Component fails the build).
5. Generate local secrets with `npm run secrets` (uses Node `crypto`; nothing leaves your machine).

## Threats & mitigations (summary — detailed per phase)

| Threat | Mitigation |
|---|---|
| Oversell | capacity enforced inside `mint_ticket` (atomic on-chain) |
| Double entry | `validate_and_check_in` marks ticket used on-chain; scanner keeps an offline seen-set |
| Screenshot / QR sharing | QR signed by holder device key with ~20 s freshness; credential bound to current owner |
| Replay of signed tx / API calls | Stellar sequence numbers + tx time bounds; API idempotency keys; QR timestamps + nonce |
| Double-spend of points | SEP-41 balances on-chain; redemption burns atomically |
| Scalping | `max_transfers`, `resale_cap` enforced on-chain |
| Brute force / abuse | per-IP + per-user rate limiting on auth, purchase and check-in endpoints |
| Data leakage between tenants | Postgres row-level security on every table; organizers see only their events |
| Injection / malformed input | zod validation on every route handler and server action |

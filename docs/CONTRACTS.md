# Contract Specifications

> **Status:** draft interface (Phase 1). Finalised with implementation and tests in Phase 2.

All amounts are `i128` in the token's smallest unit (USDC and BY Points use 7 decimals).
All state-changing calls require `require_auth()` from the acting address and emit an event.

## Roles

| Role | Granted by | Can |
|---|---|---|
| `admin` | set at `__constructor` | set platform fee & treasury, approve organizers, pause, upgrade, set minters |
| `organizer` | admin (`approve_organizer`) | create/update own events, set transfer rules, add/remove scanners |
| `scanner` | event organizer (`add_scanner`) | `validate_and_check_in` for that event only |

## `event_ticket`

| Function | Auth | Notes |
|---|---|---|
| `__constructor(admin, payment_token, platform_treasury, platform_fee_bps, rewards, badge)` | — | one-time init |
| `approve_organizer(organizer)` / `revoke_organizer` | admin | |
| `create_event(organizer, capacity, price, max_transfers, resale_cap, splits) -> u64` | organizer | `splits`: organizer/artist addresses + bps; platform fee added by contract; must sum to 10 000 bps |
| `mint_ticket(event_id, buyer) -> u64` | buyer | pulls `price` in `payment_token`, distributes splits, enforces `capacity` (no oversell), mints points |
| `transfer_ticket(ticket_id, from, to, price)` | from | rejects if used, `transfers >= max_transfers`, or `price > resale_cap` |
| `add_scanner(event_id, scanner)` / `remove_scanner` | organizer | |
| `validate_and_check_in(ticket_id, scanner)` | scanner | marks used; second call fails with `AlreadyCheckedIn`; mints attendance points + badge |
| `get_event(event_id)`, `get_ticket(ticket_id)`, `tickets_of(owner)` | — | views |

**Events:** `event_created`, `ticket_minted`, `ticket_transferred`, `checked_in`, `scanner_added`,
`scanner_removed`, `organizer_approved`, `fee_updated`.

**Errors:** `NotAuthorized`, `EventNotFound`, `SoldOut`, `TicketNotFound`, `NotOwner`, `AlreadyCheckedIn`,
`TransferLimitReached`, `ResaleCapExceeded`, `InvalidSplits`, `SalesClosed`, `Paused`.

## `rewards` (BY Points, SEP-41)

Standard SEP-41: `allowance`, `approve`, `balance`, `transfer`, `transfer_from`, `burn`, `burn_from`,
`decimals`, `name`, `symbol`.

| Extra function | Auth | Notes |
|---|---|---|
| `__constructor(admin, name, symbol)` | — | |
| `set_minter(minter, enabled)` | admin | `event_ticket` contract is a minter |
| `mint(minter, to, amount, reason)` | minter | `reason`: `Purchase` / `Attendance` / `Promo` |
| `add_perk(perk_id, cost, sponsor)` / `remove_perk` | admin | |
| `redeem(from, perk_id)` | from | burns `cost`, emits `perk_redeemed` |
| `set_transferable(bool)` | admin | points are non-transferable by default |

## `attendance_badge` (POAP)

| Function | Auth | Notes |
|---|---|---|
| `__constructor(admin, minter)` | — | `minter` = `event_ticket` contract |
| `mint_badge(event_id, attendee) -> u64` | minter | one per (event, attendee); non-transferable |
| `has_badge(event_id, attendee) -> bool`, `badges_of(attendee) -> Vec<u64>` | — | views |

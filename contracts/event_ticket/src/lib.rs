#![no_std]
//! BY Tickets — `event_ticket` contract.
//!
//! Phase 1 scaffold. Phase 2 implements:
//! - `create_event(organizer, capacity, price, max_transfers, resale_cap, splits)`
//! - `mint_ticket(event_id, buyer)` with capacity enforcement
//! - `transfer_ticket(ticket_id, from, to, price)` under organizer rules
//! - `validate_and_check_in(ticket_id, scanner)` (single-use)
//! - organizer / artist / platform revenue split
//! - role-based auth (admin, organizer, scanner) and events for every action
//!
//! See `docs/CONTRACTS.md` for the full specification.

use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct EventTicket;

#[contractimpl]
impl EventTicket {
    /// Contract interface version, bumped on breaking changes.
    pub fn version(_env: Env) -> u32 {
        1
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn reports_version() {
        let env = Env::default();
        let id = env.register(EventTicket, ());
        let client = EventTicketClient::new(&env, &id);
        assert_eq!(client.version(), 1);
    }
}

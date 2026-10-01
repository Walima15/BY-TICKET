#![no_std]
//! BY Tickets — `attendance_badge` contract (proof of attendance).
//!
//! Phase 1 scaffold. Phase 2 implements non-transferable POAP-style badges:
//! - `mint_badge(event_id, attendee)` callable only by the event_ticket contract after check-in
//! - one badge per (event, attendee); `has_badge`, `badges_of`
//!
//! See `docs/CONTRACTS.md` for the full specification.

use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct AttendanceBadge;

#[contractimpl]
impl AttendanceBadge {
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
        let id = env.register(AttendanceBadge, ());
        let client = AttendanceBadgeClient::new(&env, &id);
        assert_eq!(client.version(), 1);
    }
}

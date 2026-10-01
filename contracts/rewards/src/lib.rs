#![no_std]
//! BY Tickets — `rewards` contract ("BY Points").
//!
//! Phase 1 scaffold. Phase 2 implements a SEP-41 compatible fungible token:
//! - `mint(to, amount)` restricted to authorised minters (event_ticket contract, admin)
//! - points on purchase and on attendance (rates configured by admin)
//! - `redeem(from, perk_id, amount)` burns points against a registered perk
//! - standard SEP-41 `balance`, `transfer`, `approve`, `burn`, `decimals`, `name`, `symbol`
//!
//! See `docs/CONTRACTS.md` for the full specification.

use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct Rewards;

#[contractimpl]
impl Rewards {
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
        let id = env.register(Rewards, ());
        let client = RewardsClient::new(&env, &id);
        assert_eq!(client.version(), 1);
    }
}

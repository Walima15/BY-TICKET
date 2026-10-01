#![no_std]
//! BY Tickets — `attendance_badge` contract (proof of attendance, POAP-style).
//!
//! Non-transferable badges, one per (event, attendee). Minted by an authorised
//! minter — the `event_ticket` contract — right after a successful check-in.
//! `mint_badge` is idempotent: an attendee holding two tickets for the same event
//! keeps a single badge, and the second check-in must not fail because of it.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, ContractExecutable, Env, Vec,
};

const DAY_IN_LEDGERS: u32 = 17_280;
const BUMP: u32 = 60 * DAY_IN_LEDGERS;
const THRESHOLD: u32 = BUMP - DAY_IN_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotMinter = 1,
    BadgeNotFound = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Badge {
    pub id: u64,
    pub event_id: u64,
    pub owner: Address,
    /// Ledger close time (unix seconds) at mint.
    pub minted_at: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    NextId,
    Minter(Address),
    Badge(u64),
    /// (event_id, attendee) -> badge id
    Owned(u64, Address),
    OwnerBadges(Address),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BadgeMinted {
    #[topic]
    pub event_id: u64,
    #[topic]
    pub owner: Address,
    pub badge_id: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MinterSet {
    #[topic]
    pub minter: Address,
    pub enabled: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChanged {
    pub admin: Address,
}

#[contract]
pub struct AttendanceBadge;

#[contractimpl]
impl AttendanceBadge {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextId, &1u64);
    }

    // ---- admin ----------------------------------------------------------------

    pub fn set_minter(env: Env, minter: Address, enabled: bool) {
        require_admin(&env);
        let key = DataKey::Minter(minter.clone());
        if enabled {
            env.storage().instance().set(&key, &true);
        } else {
            env.storage().instance().remove(&key);
        }
        MinterSet { minter, enabled }.publish(&env);
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        require_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        AdminChanged { admin: new_admin }.publish(&env);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_admin(&env);
        env.deployer().update_current_contract(ContractExecutable::Wasm(new_wasm_hash));
    }

    // ---- minting ----------------------------------------------------------------

    /// Mint the attendance badge for `attendee` at `event_id`, or return the
    /// existing badge id if they already hold one.
    pub fn mint_badge(env: Env, minter: Address, event_id: u64, attendee: Address) -> Result<u64, Error> {
        minter.require_auth();
        if !env.storage().instance().has(&DataKey::Minter(minter)) {
            return Err(Error::NotMinter);
        }
        bump_instance(&env);

        let owned_key = DataKey::Owned(event_id, attendee.clone());
        if let Some(existing) = env.storage().persistent().get::<_, u64>(&owned_key) {
            return Ok(existing);
        }

        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        let badge = Badge { id, event_id, owner: attendee.clone(), minted_at: env.ledger().timestamp() };
        let badge_key = DataKey::Badge(id);
        env.storage().persistent().set(&badge_key, &badge);
        bump(&env, &badge_key);
        env.storage().persistent().set(&owned_key, &id);
        bump(&env, &owned_key);

        let list_key = DataKey::OwnerBadges(attendee.clone());
        let mut list: Vec<u64> = env.storage().persistent().get(&list_key).unwrap_or(Vec::new(&env));
        list.push_back(id);
        env.storage().persistent().set(&list_key, &list);
        bump(&env, &list_key);

        BadgeMinted { event_id, owner: attendee, badge_id: id }.publish(&env);
        Ok(id)
    }

    // ---- views ------------------------------------------------------------------

    pub fn has_badge(env: Env, event_id: u64, attendee: Address) -> bool {
        env.storage().persistent().has(&DataKey::Owned(event_id, attendee))
    }

    pub fn badge(env: Env, badge_id: u64) -> Result<Badge, Error> {
        env.storage().persistent().get(&DataKey::Badge(badge_id)).ok_or(Error::BadgeNotFound)
    }

    pub fn badges_of(env: Env, owner: Address) -> Vec<u64> {
        env.storage().persistent().get(&DataKey::OwnerBadges(owner)).unwrap_or(Vec::new(&env))
    }

    pub fn is_minter(env: Env, minter: Address) -> bool {
        env.storage().instance().has(&DataKey::Minter(minter))
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn version(_env: Env) -> u32 {
        1
    }
}

fn require_admin(env: &Env) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
    bump_instance(env);
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(THRESHOLD, BUMP);
}

fn bump(env: &Env, key: &DataKey) {
    env.storage().persistent().extend_ttl(key, THRESHOLD, BUMP);
}

#[cfg(test)]
mod test;

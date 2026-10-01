#![no_std]
//! BY Tickets — `rewards` contract: **BY Points**, a SEP-41 fungible token.
//!
//! - Minted only by allow-listed minters (the `event_ticket` contract) or the admin,
//!   on ticket purchase and on attendance.
//! - Non-transferable by default (loyalty points, not a currency). The admin can
//!   enable transfers later without redeploying (`set_transferable`).
//! - Redeemed against perks: `redeem` burns the perk cost atomically, so points
//!   can't be double-spent; the emitted `perk_redeemed` event carries a unique
//!   redemption id that vendors/organizers fulfil off-chain.
//!
//! Why a custom SEP-41 token instead of a classic asset + SAC: see docs/DECISIONS.md D-007.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token::TokenInterface,
    Address, BytesN, ContractExecutable, Env, MuxedAddress, String, Symbol,
};

const DECIMALS: u32 = 7;
const DAY_IN_LEDGERS: u32 = 17_280;
const BUMP: u32 = 60 * DAY_IN_LEDGERS;
const THRESHOLD: u32 = BUMP - DAY_IN_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotMinter = 1,
    InvalidAmount = 2,
    InsufficientBalance = 3,
    InsufficientAllowance = 4,
    NonTransferable = 5,
    InvalidExpiration = 6,
    PerkNotFound = 7,
    PerkInactive = 8,
    PerkOutOfStock = 9,
    NotPerkManager = 10,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Perk {
    /// Points burned per redemption (7 decimals).
    pub cost: i128,
    /// Organizer, vendor or sponsor who fulfils the perk; may deactivate it.
    pub sponsor: Address,
    /// Remaining redemptions; `None` means unlimited.
    pub stock: Option<u32>,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowanceValue {
    pub amount: i128,
    pub live_until_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Name,
    Symbol,
    Transferable,
    TotalSupply,
    NextRedemption,
    Minter(Address),
    Balance(Address),
    Allowance(Address, Address),
    Perk(u32),
}

// ---- events (SEP-41 shapes for transfer/approve/burn/mint) ------------------------

#[contractevent(data_format = "single-value")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Transfer {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent(data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Approve {
    #[topic]
    pub from: Address,
    #[topic]
    pub spender: Address,
    pub amount: i128,
    pub live_until_ledger: u32,
}

#[contractevent(data_format = "single-value")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Burn {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

#[contractevent(data_format = "single-value")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Mint {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

/// BY-specific context for a mint (why the points were awarded).
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PointsAwarded {
    #[topic]
    pub to: Address,
    #[topic]
    pub reason: Symbol,
    pub amount: i128,
    pub minter: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PerkRedeemed {
    #[topic]
    pub perk_id: u32,
    #[topic]
    pub from: Address,
    pub redemption_id: u64,
    pub cost: i128,
    pub sponsor: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PerkUpdated {
    #[topic]
    pub perk_id: u32,
    pub perk: Perk,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MinterSet {
    #[topic]
    pub minter: Address,
    pub enabled: bool,
}

#[contract]
pub struct Rewards;

#[contractimpl]
impl Rewards {
    pub fn __constructor(env: Env, admin: Address, name: String, symbol: String) {
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Name, &name);
        s.set(&DataKey::Symbol, &symbol);
        s.set(&DataKey::Transferable, &false);
        s.set(&DataKey::TotalSupply, &0i128);
        s.set(&DataKey::NextRedemption, &1u64);
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

    pub fn set_transferable(env: Env, transferable: bool) {
        require_admin(&env);
        env.storage().instance().set(&DataKey::Transferable, &transferable);
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        require_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_admin(&env);
        env.deployer().update_current_contract(ContractExecutable::Wasm(new_wasm_hash));
    }

    // ---- minting ----------------------------------------------------------------

    /// Award points. `minter` must be allow-listed or the admin.
    /// `reason` is free-form context, e.g. `purchase`, `attend`, `promo`.
    pub fn mint(env: Env, minter: Address, to: Address, amount: i128, reason: Symbol) -> Result<(), Error> {
        minter.require_auth();
        bump_instance(&env);
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if minter != admin && !env.storage().instance().has(&DataKey::Minter(minter.clone())) {
            return Err(Error::NotMinter);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        add_balance(&env, &to, amount);
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalSupply, &(supply + amount));

        Mint { to: to.clone(), amount }.publish(&env);
        PointsAwarded { to, reason, amount, minter }.publish(&env);
        Ok(())
    }

    // ---- perks ------------------------------------------------------------------

    /// Create or replace a perk. Admin only.
    pub fn set_perk(env: Env, perk_id: u32, cost: i128, sponsor: Address, stock: Option<u32>) -> Result<(), Error> {
        require_admin(&env);
        if cost <= 0 {
            return Err(Error::InvalidAmount);
        }
        let perk = Perk { cost, sponsor, stock, active: true };
        save_perk(&env, perk_id, &perk);
        PerkUpdated { perk_id, perk }.publish(&env);
        Ok(())
    }

    /// Activate/deactivate a perk. Callable by the admin or the perk's sponsor.
    pub fn set_perk_active(env: Env, caller: Address, perk_id: u32, active: bool) -> Result<(), Error> {
        caller.require_auth();
        let mut perk = load_perk(&env, perk_id)?;
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller != admin && caller != perk.sponsor {
            return Err(Error::NotPerkManager);
        }
        perk.active = active;
        save_perk(&env, perk_id, &perk);
        PerkUpdated { perk_id, perk }.publish(&env);
        Ok(())
    }

    /// Burn the perk cost from `from` and return a unique redemption id.
    pub fn redeem(env: Env, from: Address, perk_id: u32) -> Result<u64, Error> {
        from.require_auth();
        bump_instance(&env);
        let mut perk = load_perk(&env, perk_id)?;
        if !perk.active {
            return Err(Error::PerkInactive);
        }
        if perk.stock == Some(0) {
            return Err(Error::PerkOutOfStock);
        }
        spend_balance(&env, &from, perk.cost)?;
        reduce_supply(&env, perk.cost);
        if let Some(stock) = perk.stock {
            perk.stock = Some(stock - 1);
            save_perk(&env, perk_id, &perk);
        }

        let redemption_id: u64 = env.storage().instance().get(&DataKey::NextRedemption).unwrap_or(1);
        env.storage().instance().set(&DataKey::NextRedemption, &(redemption_id + 1));

        Burn { from: from.clone(), amount: perk.cost }.publish(&env);
        PerkRedeemed { perk_id, from, redemption_id, cost: perk.cost, sponsor: perk.sponsor }.publish(&env);
        Ok(redemption_id)
    }

    pub fn perk(env: Env, perk_id: u32) -> Result<Perk, Error> {
        load_perk(&env, perk_id)
    }

    // ---- views ------------------------------------------------------------------

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    pub fn transferable(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Transferable).unwrap_or(false)
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

// ---- SEP-41 ---------------------------------------------------------------------

#[contractimpl]
impl TokenInterface for Rewards {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        read_allowance(&env, &from, &spender).amount
    }

    fn approve(env: Env, from: Address, spender: Address, amount: i128, live_until_ledger: u32) {
        from.require_auth();
        bump_instance(&env);
        if amount < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let seq = env.ledger().sequence();
        if amount > 0 && live_until_ledger < seq {
            panic_with_error!(&env, Error::InvalidExpiration);
        }
        let key = DataKey::Allowance(from.clone(), spender.clone());
        env.storage().temporary().set(&key, &AllowanceValue { amount, live_until_ledger });
        if amount > 0 {
            let ttl = live_until_ledger.saturating_sub(seq);
            env.storage().temporary().extend_ttl(&key, ttl, ttl);
        }
        Approve { from, spender, amount, live_until_ledger }.publish(&env);
    }

    fn balance(env: Env, id: Address) -> i128 {
        read_balance(&env, &id)
    }

    fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) {
        from.require_auth();
        require_transferable(&env);
        check_amount(&env, amount);
        let to = to.address();
        unwrap_or_panic(&env, spend_balance(&env, &from, amount));
        add_balance(&env, &to, amount);
        Transfer { from, to, amount }.publish(&env);
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        require_transferable(&env);
        check_amount(&env, amount);
        unwrap_or_panic(&env, spend_allowance(&env, &from, &spender, amount));
        unwrap_or_panic(&env, spend_balance(&env, &from, amount));
        add_balance(&env, &to, amount);
        Transfer { from, to, amount }.publish(&env);
    }

    fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        check_amount(&env, amount);
        unwrap_or_panic(&env, spend_balance(&env, &from, amount));
        reduce_supply(&env, amount);
        Burn { from, amount }.publish(&env);
    }

    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        check_amount(&env, amount);
        unwrap_or_panic(&env, spend_allowance(&env, &from, &spender, amount));
        unwrap_or_panic(&env, spend_balance(&env, &from, amount));
        reduce_supply(&env, amount);
        Burn { from, amount }.publish(&env);
    }

    fn decimals(_env: Env) -> u32 {
        DECIMALS
    }

    fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    fn symbol(env: Env) -> String {
        env.storage().instance().get(&DataKey::Symbol).unwrap()
    }
}

// ---- internals --------------------------------------------------------------------

fn require_admin(env: &Env) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
    bump_instance(env);
}

fn require_transferable(env: &Env) {
    bump_instance(env);
    if !env.storage().instance().get::<_, bool>(&DataKey::Transferable).unwrap_or(false) {
        panic_with_error!(env, Error::NonTransferable);
    }
}

fn check_amount(env: &Env, amount: i128) {
    if amount <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
}

fn unwrap_or_panic(env: &Env, r: Result<(), Error>) {
    if let Err(e) = r {
        panic_with_error!(env, e);
    }
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(THRESHOLD, BUMP);
}

fn read_balance(env: &Env, id: &Address) -> i128 {
    let key = DataKey::Balance(id.clone());
    match env.storage().persistent().get::<_, i128>(&key) {
        Some(b) => {
            env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
            b
        }
        None => 0,
    }
}

fn write_balance(env: &Env, id: &Address, amount: i128) {
    let key = DataKey::Balance(id.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
}

fn add_balance(env: &Env, id: &Address, amount: i128) {
    let balance = read_balance(env, id);
    write_balance(env, id, balance.checked_add(amount).unwrap());
}

fn spend_balance(env: &Env, id: &Address, amount: i128) -> Result<(), Error> {
    let balance = read_balance(env, id);
    if balance < amount {
        return Err(Error::InsufficientBalance);
    }
    write_balance(env, id, balance - amount);
    Ok(())
}

fn reduce_supply(env: &Env, amount: i128) {
    let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
    env.storage().instance().set(&DataKey::TotalSupply, &(supply - amount));
}

fn read_allowance(env: &Env, from: &Address, spender: &Address) -> AllowanceValue {
    let key = DataKey::Allowance(from.clone(), spender.clone());
    match env.storage().temporary().get::<_, AllowanceValue>(&key) {
        Some(a) if a.live_until_ledger >= env.ledger().sequence() => a,
        Some(a) => AllowanceValue { amount: 0, live_until_ledger: a.live_until_ledger },
        None => AllowanceValue { amount: 0, live_until_ledger: 0 },
    }
}

fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) -> Result<(), Error> {
    let allowance = read_allowance(env, from, spender);
    if allowance.amount < amount {
        return Err(Error::InsufficientAllowance);
    }
    let key = DataKey::Allowance(from.clone(), spender.clone());
    env.storage().temporary().set(
        &key,
        &AllowanceValue { amount: allowance.amount - amount, live_until_ledger: allowance.live_until_ledger },
    );
    Ok(())
}

fn load_perk(env: &Env, perk_id: u32) -> Result<Perk, Error> {
    let key = DataKey::Perk(perk_id);
    let perk: Perk = env.storage().persistent().get(&key).ok_or(Error::PerkNotFound)?;
    env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
    Ok(perk)
}

fn save_perk(env: &Env, perk_id: u32, perk: &Perk) {
    let key = DataKey::Perk(perk_id);
    env.storage().persistent().set(&key, perk);
    env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
}

#[cfg(test)]
mod test;

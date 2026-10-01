extern crate std;

use super::*;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{symbol_short, String};

const POINT: i128 = 10_000_000; // 1.0000000 BY Points

struct Setup<'a> {
    env: Env,
    admin: Address,
    minter: Address,
    client: RewardsClient<'a>,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let minter = Address::generate(&env);
    let id = env.register(Rewards, (&admin, String::from_str(&env, "BY Points"), String::from_str(&env, "BYPTS")));
    let client = RewardsClient::new(&env, &id);
    client.set_minter(&minter, &true);
    Setup { env, admin, minter, client }
}

/// SEP-41 functions return `()`, so their failures surface as a generic host error.
fn sep41_err(e: Error) -> soroban_sdk::Error {
    soroban_sdk::Error::from_contract_error(e as u32)
}

fn emitted(env: &Env, contract: &Address, name: &str) -> bool {
    use soroban_sdk::xdr::{ContractEventBody, ScSymbol, ScVal};
    let want = ScVal::Symbol(ScSymbol(name.try_into().unwrap()));
    env.events().all().filter_by_contract(contract).events().iter().any(|e| {
        let ContractEventBody::V0(body) = &e.body;
        body.topics.first() == Some(&want)
    })
}

#[test]
fn metadata() {
    let s = setup();
    assert_eq!(s.client.decimals(), 7);
    assert_eq!(s.client.name(), String::from_str(&s.env, "BY Points"));
    assert_eq!(s.client.symbol(), String::from_str(&s.env, "BYPTS"));
    assert!(!s.client.transferable());
}

#[test]
fn minter_mints_and_supply_tracks() {
    let s = setup();
    let alice = Address::generate(&s.env);
    s.client.mint(&s.minter, &alice, &(50 * POINT), &symbol_short!("purchase"));
    assert!(emitted(&s.env, &s.client.address, "points_awarded"));
    s.client.mint(&s.admin, &alice, &(5 * POINT), &symbol_short!("promo"));
    assert_eq!(s.client.balance(&alice), 55 * POINT);
    assert_eq!(s.client.total_supply(), 55 * POINT);
}

#[test]
fn non_minter_cannot_mint() {
    let s = setup();
    let rogue = Address::generate(&s.env);
    let alice = Address::generate(&s.env);
    assert_eq!(s.client.try_mint(&rogue, &alice, &POINT, &symbol_short!("purchase")), Err(Ok(Error::NotMinter)));
}

#[test]
fn rejects_non_positive_mint() {
    let s = setup();
    let alice = Address::generate(&s.env);
    assert_eq!(s.client.try_mint(&s.minter, &alice, &0, &symbol_short!("x")), Err(Ok(Error::InvalidAmount)));
    assert_eq!(s.client.try_mint(&s.minter, &alice, &-1, &symbol_short!("x")), Err(Ok(Error::InvalidAmount)));
}

#[test]
fn points_are_non_transferable_by_default() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    s.client.mint(&s.minter, &alice, &(10 * POINT), &symbol_short!("attend"));
    assert_eq!(s.client.try_transfer(&alice, &bob, &POINT), Err(Ok(sep41_err(Error::NonTransferable))));
    assert_eq!(s.client.balance(&alice), 10 * POINT);
}

#[test]
fn transfers_when_enabled() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    s.client.mint(&s.minter, &alice, &(10 * POINT), &symbol_short!("attend"));
    s.client.set_transferable(&true);

    s.client.transfer(&alice, &bob, &(4 * POINT));
    assert!(emitted(&s.env, &s.client.address, "transfer"));
    assert_eq!(s.client.balance(&alice), 6 * POINT);
    assert_eq!(s.client.balance(&bob), 4 * POINT);
    assert_eq!(s.client.try_transfer(&alice, &bob, &(7 * POINT)), Err(Ok(sep41_err(Error::InsufficientBalance))));
}

#[test]
fn allowance_flow_and_expiry() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let spender = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    s.client.mint(&s.minter, &alice, &(10 * POINT), &symbol_short!("attend"));
    s.client.set_transferable(&true);

    let seq = s.env.ledger().sequence();
    s.client.approve(&alice, &spender, &(3 * POINT), &(seq + 100));
    assert_eq!(s.client.allowance(&alice, &spender), 3 * POINT);

    s.client.transfer_from(&spender, &alice, &bob, &(2 * POINT));
    assert_eq!(s.client.allowance(&alice, &spender), POINT);
    assert_eq!(
        s.client.try_transfer_from(&spender, &alice, &bob, &(2 * POINT)),
        Err(Ok(sep41_err(Error::InsufficientAllowance)))
    );

    s.env.ledger().set_sequence_number(seq + 101);
    assert_eq!(s.client.allowance(&alice, &spender), 0);
}

#[test]
fn approve_rejects_past_expiration() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let spender = Address::generate(&s.env);
    s.env.ledger().set_sequence_number(1_000);
    assert_eq!(s.client.try_approve(&alice, &spender, &POINT, &999), Err(Ok(sep41_err(Error::InvalidExpiration))));
}

#[test]
fn burn_reduces_balance_and_supply() {
    let s = setup();
    let alice = Address::generate(&s.env);
    s.client.mint(&s.minter, &alice, &(10 * POINT), &symbol_short!("attend"));
    s.client.burn(&alice, &(3 * POINT));
    assert_eq!(s.client.balance(&alice), 7 * POINT);
    assert_eq!(s.client.total_supply(), 7 * POINT);
}

#[test]
fn redeem_burns_cost_and_tracks_stock() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let vendor = Address::generate(&s.env);
    s.client.mint(&s.minter, &alice, &(100 * POINT), &symbol_short!("attend"));
    s.client.set_perk(&1, &(40 * POINT), &vendor, &Some(2));

    let r1 = s.client.redeem(&alice, &1);
    assert!(emitted(&s.env, &s.client.address, "perk_redeemed"));
    let r2 = s.client.redeem(&alice, &1);
    assert_ne!(r1, r2);
    assert_eq!(s.client.balance(&alice), 20 * POINT);
    assert_eq!(s.client.total_supply(), 20 * POINT);
    assert_eq!(s.client.perk(&1).stock, Some(0));
    assert_eq!(s.client.try_redeem(&alice, &1), Err(Ok(Error::PerkOutOfStock)));
}

#[test]
fn redeem_needs_enough_points_and_leaves_stock_untouched() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let vendor = Address::generate(&s.env);
    s.client.mint(&s.minter, &alice, &(10 * POINT), &symbol_short!("attend"));
    s.client.set_perk(&1, &(40 * POINT), &vendor, &Some(5));
    assert_eq!(s.client.try_redeem(&alice, &1), Err(Ok(Error::InsufficientBalance)));
    assert_eq!(s.client.perk(&1).stock, Some(5));
    assert_eq!(s.client.balance(&alice), 10 * POINT);
}

#[test]
fn sponsor_can_deactivate_perk_but_strangers_cannot() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let vendor = Address::generate(&s.env);
    let stranger = Address::generate(&s.env);
    s.client.mint(&s.minter, &alice, &(100 * POINT), &symbol_short!("attend"));
    s.client.set_perk(&9, &POINT, &vendor, &None);

    assert_eq!(s.client.try_set_perk_active(&stranger, &9, &false), Err(Ok(Error::NotPerkManager)));
    s.client.set_perk_active(&vendor, &9, &false);
    assert_eq!(s.client.try_redeem(&alice, &9), Err(Ok(Error::PerkInactive)));
    s.client.set_perk_active(&s.admin, &9, &true);
    s.client.redeem(&alice, &9);
}

#[test]
fn unknown_perk() {
    let s = setup();
    let alice = Address::generate(&s.env);
    assert_eq!(s.client.try_redeem(&alice, &404), Err(Ok(Error::PerkNotFound)));
}

#[test]
fn redeem_requires_holder_auth() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let vendor = Address::generate(&s.env);
    s.client.mint(&s.minter, &alice, &(10 * POINT), &symbol_short!("attend"));
    s.client.set_perk(&1, &POINT, &vendor, &None);
    s.client.redeem(&alice, &1);
    assert_eq!(s.env.auths()[0].0, alice);
}

#[test]
#[should_panic]
fn admin_functions_need_admin_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(Rewards, (&admin, String::from_str(&env, "BY Points"), String::from_str(&env, "BYPTS")));
    RewardsClient::new(&env, &id).set_transferable(&true);
}

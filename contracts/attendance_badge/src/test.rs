extern crate std;

use super::*;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};

struct Setup<'a> {
    env: Env,
    admin: Address,
    minter: Address,
    client: AttendanceBadgeClient<'a>,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let minter = Address::generate(&env);
    let id = env.register(AttendanceBadge, (&admin,));
    let client = AttendanceBadgeClient::new(&env, &id);
    client.set_minter(&minter, &true);
    Setup { env, admin, minter, client }
}

#[test]
fn mints_badge_with_metadata() {
    let s = setup();
    s.env.ledger().set_timestamp(1_760_000_000);
    let alice = Address::generate(&s.env);

    let id = s.client.mint_badge(&s.minter, &7, &alice);

    assert_eq!(id, 1);
    assert!(s.client.has_badge(&7, &alice));
    assert!(!s.client.has_badge(&8, &alice));
    let badge = s.client.badge(&id);
    assert_eq!(badge, Badge { id, event_id: 7, owner: alice.clone(), minted_at: 1_760_000_000 });
    assert_eq!(s.client.badges_of(&alice), Vec::from_array(&s.env, [1u64]));
}

#[test]
fn mint_is_idempotent_per_event_and_attendee() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let first = s.client.mint_badge(&s.minter, &1, &alice);
    let second = s.client.mint_badge(&s.minter, &1, &alice);
    assert_eq!(first, second);
    assert_eq!(s.client.badges_of(&alice).len(), 1);

    let other_event = s.client.mint_badge(&s.minter, &2, &alice);
    assert_ne!(other_event, first);
    assert_eq!(s.client.badges_of(&alice).len(), 2);
}

#[test]
fn rejects_unauthorised_minter() {
    let s = setup();
    let rogue = Address::generate(&s.env);
    let alice = Address::generate(&s.env);
    assert_eq!(s.client.try_mint_badge(&rogue, &1, &alice), Err(Ok(Error::NotMinter)));
}

#[test]
fn disabled_minter_cannot_mint() {
    let s = setup();
    s.client.set_minter(&s.minter, &false);
    assert!(!s.client.is_minter(&s.minter));
    let alice = Address::generate(&s.env);
    assert_eq!(s.client.try_mint_badge(&s.minter, &1, &alice), Err(Ok(Error::NotMinter)));
}

#[test]
fn mint_requires_minter_auth() {
    let s = setup();
    let alice = Address::generate(&s.env);
    s.client.mint_badge(&s.minter, &1, &alice);
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.minter);
}

#[test]
fn set_minter_requires_admin_auth() {
    let s = setup();
    let m = Address::generate(&s.env);
    s.client.set_minter(&m, &true);
    assert_eq!(s.env.auths()[0].0, s.admin);
}

#[test]
#[should_panic]
fn set_minter_without_admin_auth_panics() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(AttendanceBadge, (&admin,));
    let client = AttendanceBadgeClient::new(&env, &id);
    client.set_minter(&Address::generate(&env), &true);
}

/// True if `contract` emitted an event whose first topic is the symbol `name`.
fn emitted(env: &Env, contract: &Address, name: &str) -> bool {
    use soroban_sdk::xdr::{ContractEventBody, ScSymbol, ScVal};
    let want = ScVal::Symbol(ScSymbol(name.try_into().unwrap()));
    env.events().all().filter_by_contract(contract).events().iter().any(|e| {
        let ContractEventBody::V0(body) = &e.body;
        body.topics.first() == Some(&want)
    })
}

#[test]
fn emits_badge_minted_event() {
    let s = setup();
    let alice = Address::generate(&s.env);
    s.client.mint_badge(&s.minter, &3, &alice);
    assert!(emitted(&s.env, &s.client.address, "badge_minted"));
}

#[test]
fn missing_badge_errors() {
    let s = setup();
    assert_eq!(s.client.try_badge(&99), Err(Ok(Error::BadgeNotFound)));
}

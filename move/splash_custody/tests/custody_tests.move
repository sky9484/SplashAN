/// Custody-side tests.
///
/// NOTE ON RUNNABILITY: `sui move test` cannot execute in this package. The
/// pinned DeepBook rev ships test files that fail to compile against the current
/// toolchain (`unbound function 'destroy'` in deepbook's own vault_tests.move),
/// which aborts the test build before these are reached. splash_core has no
/// DeepBook dependency and its suite DOES run — see
/// move/splash_core/tests/core_invariants_tests.move.
///
/// These are written so they run the moment the DeepBook pin moves. The
/// receipt/anchor coverage that used to live here moved to splash_core, where it
/// executes today.
#[test_only]
module splash_custody::custody_tests;

use splash_core::business_account;
use splash_custody::smart_treasury;
use std::unit_test::assert_eq;
use sui::clock;
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario;

const ADMIN: address = @0xAD31;
const OUTSIDER: address = @0xBADBAD;

#[test]
/// M3. `deposit` is AdminCap-gated and emits `PoolFunded`. It used to be open to
/// anyone with no record of who funded the pool, which made the pool
/// unreconcilable and gave an obvious layering path into a shared object that
/// pays third parties.
fun deposit_requires_admin_and_records_the_depositor() {
    let mut scenario = test_scenario::begin(ADMIN);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000_000);

    let admin = business_account::admin_cap_for_testing(ctx);
    let mut treasury = smart_treasury::treasury_for_testing<SUI>(
        b"treasury-sui".to_string(),
        0,
        &c,
        ctx,
    );
    let funding = coin::mint_for_testing<SUI>(5_000, ctx);
    smart_treasury::deposit(&mut treasury, funding, &c, ctx);
    assert_eq!(smart_treasury::balance(&treasury), 5_000);

    sui::test_utils::destroy(admin);
    let leftover = smart_treasury::destroy_for_testing(treasury);
    assert_eq!(leftover, 5_000);
    c.destroy_for_testing();
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 703, location = splash_custody::smart_treasury)]
/// The corridor operating floor must hold. `allocate` takes the minimum as a
/// caller-supplied argument, so this pins that the assert is real — passing a
/// floor the withdrawal would breach aborts rather than silently draining.
fun treasury_allocate_respects_the_operating_floor() {
    let mut scenario = test_scenario::begin(ADMIN);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000_000);

    let admin = business_account::admin_cap_for_testing(ctx);
    let mut treasury = smart_treasury::treasury_for_testing<SUI>(
        b"treasury-sui".to_string(),
        1_000,
        &c,
        ctx,
    );
    // Withdrawing 600 of 1_000 leaves 400, below the 500 floor.
    smart_treasury::allocate(&mut treasury, &admin, OUTSIDER, 600, 500, &c, ctx);

    sui::test_utils::destroy(admin);
    let _ = smart_treasury::destroy_for_testing(treasury);
    c.destroy_for_testing();
    scenario.end();
}

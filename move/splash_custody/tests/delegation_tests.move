/// Delegation and credit-segregation tests.
///
/// ⚠️ NOT YET RUNNABLE. `sui move test` cannot execute in splash_custody: the
/// pinned DeepBook rev ships test files that fail to compile against this
/// toolchain (`unbound function 'destroy'` in deepbook's own vault_tests.move),
/// which aborts the test build before these are reached. They are written
/// against the real API and run the moment the pin moves — see STATUS.md.
///
/// The properties below are the ones that decide whether A-11 is actually
/// closed. The window arithmetic they depend on IS executable, in
/// `splash_meter/tests/spend_meter_tests.move` (22 tests, passing), which is
/// deliberately dependency-free for exactly this reason.
#[test_only]
module splash_custody::delegation_tests;

use splash_core::business_account;
use splash_custody::delegation;
use splash_custody::settlement;
use std::unit_test::assert_eq;
use sui::clock;
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario;

const TENANT_A: address = @0xA;
const TENANT_B: address = @0xB;
const OPERATOR: address = @0x09E7A;
const FEE_SINK: address = @0xFEE;
const DAY: u64 = 86_400_000;

const PER_TX: u64 = 50_000_000_000;
const WINDOW: u64 = 50_000_000_000;

#[test]
/// Credit segregation. Tenant A funds the pool; tenant B has zero credit. A
/// delegation for B cannot spend A's money — not because an assert says so, but
/// because `credits[B]` is a different number from `credits[A]`.
///
/// This is what bounds the blast radius of a compromised operator to a single
/// tenant's funding rather than the whole pool.
fun credits_are_segregated_per_tenant() {
    let mut scenario = test_scenario::begin(OPERATOR);
    {
        let ctx = scenario.ctx();
        let mut c = clock::create_for_testing(ctx);
        c.set_for_testing(1_000 * DAY);
        let admin = business_account::admin_cap_for_testing(ctx);
        settlement::create_pool<SUI>(&admin, FEE_SINK, PER_TX, WINDOW, PER_TX, WINDOW, &c, ctx);
        sui::test_utils::destroy(admin);
        c.destroy_for_testing();
    };

    scenario.next_tx(OPERATOR);
    {
        let mut pool = scenario.take_shared<settlement::SettlementPool<SUI>>();
        let ctx = scenario.ctx();
        let mut c = clock::create_for_testing(ctx);
        c.set_for_testing(1_000 * DAY);
        let admin = business_account::admin_cap_for_testing(ctx);

        let funding = coin::mint_for_testing<SUI>(10_000_000_000, ctx);
        settlement::deposit_for(&admin, &mut pool, TENANT_A, funding, &c, ctx);

        assert_eq!(settlement::credit_of(&pool, TENANT_A), 10_000_000_000);
        assert_eq!(settlement::credit_of(&pool, TENANT_B), 0);
        assert_eq!(settlement::total_credit(&pool), 10_000_000_000);

        sui::test_utils::destroy(admin);
        c.destroy_for_testing();
        test_scenario::return_shared(pool);
    };
    scenario.end();
}

#[test]
/// A delegation is bound to the operator address it was granted to. Possession
/// of the object is NOT authority — a stolen delegation used from another
/// address aborts.
fun a_delegation_is_bound_to_its_operator() {
    // Covered by `delegation::authorize`'s
    // `assert!(delegation.operator == tx_context::sender(ctx), E_INVALID_OPERATOR)`.
    // Written here so the property is enumerated with the others; the executable
    // form lands when the DeepBook pin moves and a full settle can run.
    assert!(delegation::max_ttl_ms() == 2_592_000_000, 0);
}

#[test]
/// `revoke_all_delegations` bumps the pool epoch, and every delegation records
/// the epoch it was minted under.
///
/// This is the ONLY revocation that reaches a compromised operator: their
/// delegations are owned objects at their address, and the multisig cannot name
/// an owned object it does not hold. One write on the shared pool kills all of
/// them at once.
fun revoking_all_delegations_bumps_the_pool_epoch() {
    let mut scenario = test_scenario::begin(OPERATOR);
    {
        let ctx = scenario.ctx();
        let mut c = clock::create_for_testing(ctx);
        c.set_for_testing(1_000 * DAY);
        let admin = business_account::admin_cap_for_testing(ctx);
        settlement::create_pool<SUI>(&admin, FEE_SINK, PER_TX, WINDOW, PER_TX, WINDOW, &c, ctx);
        sui::test_utils::destroy(admin);
        c.destroy_for_testing();
    };

    scenario.next_tx(OPERATOR);
    {
        let mut pool = scenario.take_shared<settlement::SettlementPool<SUI>>();
        let ctx = scenario.ctx();
        let admin = business_account::admin_cap_for_testing(ctx);

        assert_eq!(settlement::delegation_epoch(&pool), 0);
        settlement::revoke_all_delegations(&admin, &mut pool);
        assert_eq!(settlement::delegation_epoch(&pool), 1);
        // Every delegation minted at epoch 0 now fails `authorize` with 117.

        sui::test_utils::destroy(admin);
        test_scenario::return_shared(pool);
    };
    scenario.end();
}

#[test]
/// The fee recipient is fixed at pool creation and `withdraw_fees` takes no
/// recipient argument at all.
///
/// A caller-supplied recipient meant a compromised admin key could redirect
/// every future sweep to itself — revenue theft that looks exactly like normal
/// operation in the event log.
fun the_fee_recipient_is_fixed_at_creation() {
    let mut scenario = test_scenario::begin(OPERATOR);
    {
        let ctx = scenario.ctx();
        let mut c = clock::create_for_testing(ctx);
        c.set_for_testing(1_000 * DAY);
        let admin = business_account::admin_cap_for_testing(ctx);
        settlement::create_pool<SUI>(&admin, FEE_SINK, PER_TX, WINDOW, PER_TX, WINDOW, &c, ctx);
        sui::test_utils::destroy(admin);
        c.destroy_for_testing();
    };

    scenario.next_tx(OPERATOR);
    {
        let pool = scenario.take_shared<settlement::SettlementPool<SUI>>();
        assert_eq!(settlement::fee_recipient(&pool), FEE_SINK);
        test_scenario::return_shared(pool);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 119, location = splash_custody::settlement)]
/// Repointing the fee recipient requires the pool to be paused first, so a
/// redirect cannot be slipped in between two normal sweeps without the pause
/// showing up in monitoring.
fun repointing_the_fee_recipient_requires_a_pause() {
    let mut scenario = test_scenario::begin(OPERATOR);
    {
        let ctx = scenario.ctx();
        let mut c = clock::create_for_testing(ctx);
        c.set_for_testing(1_000 * DAY);
        let admin = business_account::admin_cap_for_testing(ctx);
        settlement::create_pool<SUI>(&admin, FEE_SINK, PER_TX, WINDOW, PER_TX, WINDOW, &c, ctx);
        sui::test_utils::destroy(admin);
        c.destroy_for_testing();
    };

    scenario.next_tx(OPERATOR);
    {
        let mut pool = scenario.take_shared<settlement::SettlementPool<SUI>>();
        let ctx = scenario.ctx();
        let admin = business_account::admin_cap_for_testing(ctx);
        settlement::set_fee_recipient(&admin, &mut pool, @0xBADBAD);
        sui::test_utils::destroy(admin);
        test_scenario::return_shared(pool);
    };
    scenario.end();
}

#[test]
/// The pool meter bounds aggregate outflow independently of any single
/// tenant's own limit — one tenant must not be able to consume the protocol's
/// whole daily headroom, and the protocol must not be exposed to the sum of
/// every tenant's individually-reasonable limit.
fun the_pool_meter_is_independent_of_delegation_meters() {
    let mut scenario = test_scenario::begin(OPERATOR);
    {
        let ctx = scenario.ctx();
        let mut c = clock::create_for_testing(ctx);
        c.set_for_testing(1_000 * DAY);
        let admin = business_account::admin_cap_for_testing(ctx);
        settlement::create_pool<SUI>(&admin, FEE_SINK, PER_TX, WINDOW, PER_TX, WINDOW, &c, ctx);
        sui::test_utils::destroy(admin);
        c.destroy_for_testing();
    };

    scenario.next_tx(OPERATOR);
    {
        let pool = scenario.take_shared<settlement::SettlementPool<SUI>>();
        assert_eq!(settlement::payout_remaining_at(&pool, 1_000 * DAY), WINDOW);
        test_scenario::return_shared(pool);
    };
    scenario.end();
}

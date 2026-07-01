#[test_only]
module splash_protocol::oxwal_milestone5_tests;

use splash_protocol::audit_anchor;
use splash_protocol::business_account;
use splash_protocol::payment_intent;
use splash_protocol::smart_treasury;
use std::unit_test::{assert_eq, destroy};
use sui::clock;
use sui::sui::SUI;
use sui::tx_context;

#[test]
fun settlement_receipt_is_consumed_by_anchor() {
    let ctx = &mut tx_context::dummy();
    let mut clock = clock::create_for_testing(ctx);

    let (intent, receipt) = payment_intent::create(
        @0xA,
        b"counterparty:vendor-001",
        100,
        b"USDC",
        b"MY_PH",
        b"PHP".to_string(),
        1_000_000,
        &clock,
        ctx,
    );

    audit_anchor::anchor(receipt, b"content-hash", b"walrus-blob", &clock, ctx);
    assert_eq!(payment_intent::status(&intent), 0);

    payment_intent::cancel(intent, ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 500, location = audit_anchor)]
fun anchor_rejects_empty_content_hash() {
    let ctx = &mut tx_context::dummy();
    let mut clock = clock::create_for_testing(ctx);

    let (intent, receipt) = payment_intent::create(
        @0xA,
        b"counterparty:vendor-001",
        100,
        b"USDC",
        b"MY_PH",
        b"PHP".to_string(),
        1_000_000,
        &clock,
        ctx,
    );

    payment_intent::cancel(intent, ctx);
    audit_anchor::anchor(receipt, vector[], b"walrus-blob", &clock, ctx);
    abort 999
}

#[test]
fun treasury_allocation_preserves_floor() {
    let ctx = &mut tx_context::dummy();
    let mut clock = clock::create_for_testing(ctx);
    let admin = business_account::admin_cap_for_testing(ctx);
    let mut treasury = smart_treasury::treasury_for_testing<SUI>(
        b"MY_PH operating reserve".to_string(),
        1_000,
        &clock,
        ctx,
    );

    smart_treasury::allocate<SUI>(&mut treasury, &admin, @0xB, 250, 700, &clock, ctx);
    assert_eq!(smart_treasury::balance(&treasury), 750);

    assert_eq!(smart_treasury::destroy_for_testing(treasury), 750);
    destroy(admin);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 703, location = smart_treasury)]
fun treasury_allocation_breaching_floor_aborts() {
    let ctx = &mut tx_context::dummy();
    let mut clock = clock::create_for_testing(ctx);
    let admin = business_account::admin_cap_for_testing(ctx);
    let mut treasury = smart_treasury::treasury_for_testing<SUI>(
        b"MY_PH operating reserve".to_string(),
        1_000,
        &clock,
        ctx,
    );

    smart_treasury::allocate<SUI>(&mut treasury, &admin, @0xB, 400, 700, &clock, ctx);
    abort 999
}

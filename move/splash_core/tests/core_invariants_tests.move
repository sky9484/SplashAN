/// splash_core invariant tests.
///
/// These could not exist before the package split: splash_core depended on
/// DeepBook, and the pinned DeepBook rev ships test files that fail to compile
/// against this toolchain, aborting the whole test build before our modules were
/// reached. That is why this repository had 93 lines of Move tests against 16 TS
/// suites. Moving the liquidity guard to splash_custody (where the pooled funds
/// it protects actually live) removed the dependency and unblocked this suite.
///
/// The properties pinned here are the ones the regulatory claim rests on:
/// no receipt without a consumed coin, exactly one receipt consumer, exact
/// refunds, and caps that cannot do each other's jobs.
#[test_only]
module splash_core::core_invariants_tests;

use splash_core::audit_anchor;
use splash_core::business_account;
use splash_core::payment_intent;
use std::unit_test::assert_eq;
use sui::clock;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario;

const SENDER: address = @0xA11CE;
const RECIPIENT: address = @0xB0B;

const HASH: vector<u8> = b"0123456789abcdef0123456789abcdef";
const BLOB: vector<u8> = b"walrus-blob-id";

fun new_intent(c: &clock::Clock, ctx: &mut TxContext): payment_intent::PaymentIntent {
    payment_intent::create(
        RECIPIENT,
        b"counterparty:vendor-001",
        1_000,
        b"USD",
        b"MY-PH",
        b"PHP".to_string(),
        56_000_000,
        c,
        ctx,
    )
}

// ── M1: no receipt without a consumed coin ─────────────────────────────────

#[test]
/// M1. `create` used to return `(PaymentIntent, SettleReceipt)`, minting the
/// receipt with `settled_at: now` while no `Coin` appeared anywhere in the
/// function. The type asserted a settlement that had not happened, and
/// `audit_anchor` would then anchor that assertion on chain as proof of payment.
///
/// That this test COMPILES is half the assertion: `create` returns exactly one
/// value. Reinstating the receipt mint stops this file building.
fun create_returns_intent_only_and_settles_nothing() {
    let mut scenario = test_scenario::begin(SENDER);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000_000);

    let intent = new_intent(&c, ctx);

    assert_eq!(payment_intent::sender(&intent), SENDER);
    assert_eq!(payment_intent::recipient(&intent), RECIPIENT);
    assert_eq!(payment_intent::amount_usd(&intent), 1_000);
    // STATUS_PENDING — creating an intent settles nothing.
    assert_eq!(payment_intent::status(&intent), 0);

    payment_intent::cancel(intent, ctx);
    c.destroy_for_testing();
    scenario.end();
}

#[test]
/// A receipt exists only where a coin was consumed, and the receipt is a hot
/// potato — no `drop`, no `store`, no `key` — so the PTB must anchor it or
/// abort. "Every settlement is anchored" is enforced by the type system.
fun receipt_requires_a_consumed_coin_and_must_be_anchored() {
    let mut scenario = test_scenario::begin(SENDER);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000_000);

    let mut intent = new_intent(&c, ctx);
    let payment = coin::mint_for_testing<SUI>(1_000, ctx);

    let receipt = payment_intent::confirm_payment_intent(&mut intent, payment, &c, ctx);
    assert_eq!(payment_intent::status(&intent), 1); // STATUS_CONFIRMED

    // The ONLY way to dispose of a receipt.
    audit_anchor::anchor(receipt, HASH, BLOB, &c, ctx);

    payment_intent::delete_finalized(intent);
    c.destroy_for_testing();
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 402, location = splash_core::payment_intent)]
/// Underpayment aborts — no receipt can be minted for less than the intent.
fun underpayment_aborts() {
    let mut scenario = test_scenario::begin(SENDER);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000_000);

    let mut intent = new_intent(&c, ctx);
    let short = coin::mint_for_testing<SUI>(999, ctx);

    let receipt = payment_intent::confirm_payment_intent(&mut intent, short, &c, ctx);
    audit_anchor::anchor(receipt, HASH, BLOB, &c, ctx);
    payment_intent::delete_finalized(intent);
    c.destroy_for_testing();
    scenario.end();
}

#[test]
/// Overpay is refunded to the payer EXACTLY: the recipient gets the intent
/// amount and not a unit more, and nothing is stranded in the module. H-03.
fun overpayment_refunded_exactly() {
    let mut scenario = test_scenario::begin(SENDER);
    {
        let ctx = scenario.ctx();
        let mut c = clock::create_for_testing(ctx);
        c.set_for_testing(1_000_000);
        let mut intent = new_intent(&c, ctx);
        let over = coin::mint_for_testing<SUI>(1_500, ctx);
        let receipt = payment_intent::confirm_payment_intent(&mut intent, over, &c, ctx);
        audit_anchor::anchor(receipt, HASH, BLOB, &c, ctx);
        payment_intent::delete_finalized(intent);
        c.destroy_for_testing();
    };

    scenario.next_tx(SENDER);
    {
        let refund = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&refund), 500);
        scenario.return_to_sender(refund);
    };

    scenario.next_tx(RECIPIENT);
    {
        let paid = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&paid), 1_000);
        scenario.return_to_sender(paid);
    };
    scenario.end();
}

#[test]
/// Exact payment leaves no refund coin at all — `destroy_zero` on a provably
/// zero coin, so no dust object is created.
fun exact_payment_creates_no_refund() {
    let mut scenario = test_scenario::begin(SENDER);
    {
        let ctx = scenario.ctx();
        let mut c = clock::create_for_testing(ctx);
        c.set_for_testing(1_000_000);
        let mut intent = new_intent(&c, ctx);
        let exact = coin::mint_for_testing<SUI>(1_000, ctx);
        let receipt = payment_intent::confirm_payment_intent(&mut intent, exact, &c, ctx);
        audit_anchor::anchor(receipt, HASH, BLOB, &c, ctx);
        payment_intent::delete_finalized(intent);
        c.destroy_for_testing();
    };
    scenario.next_tx(RECIPIENT);
    {
        let paid = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&paid), 1_000);
        scenario.return_to_sender(paid);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 404, location = splash_core::payment_intent)]
/// Only the intent's own sender may confirm it (H-02). A third party holding a
/// shared intent object cannot push it through.
fun third_party_cannot_confirm() {
    let mut scenario = test_scenario::begin(SENDER);
    let mut intent;
    {
        let ctx = scenario.ctx();
        let mut c = clock::create_for_testing(ctx);
        c.set_for_testing(1_000_000);
        intent = new_intent(&c, ctx);
        c.destroy_for_testing();
    };

    scenario.next_tx(@0xBADBAD);
    {
        let ctx = scenario.ctx();
        let mut c = clock::create_for_testing(ctx);
        c.set_for_testing(1_000_000);
        let payment = coin::mint_for_testing<SUI>(1_000, ctx);
        let receipt = payment_intent::confirm_payment_intent(&mut intent, payment, &c, ctx);
        audit_anchor::anchor(receipt, HASH, BLOB, &c, ctx);
        c.destroy_for_testing();
    };
    payment_intent::delete_finalized(intent);
    scenario.end();
}

// ── Anchor validation ──────────────────────────────────────────────────────

#[test]
#[expected_failure(abort_code = 500, location = splash_core::audit_anchor)]
/// An anchor with no content hash is not evidence of anything.
fun anchor_rejects_empty_digest() {
    let mut scenario = test_scenario::begin(SENDER);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000_000);

    let mut intent = new_intent(&c, ctx);
    let payment = coin::mint_for_testing<SUI>(1_000, ctx);
    let receipt = payment_intent::confirm_payment_intent(&mut intent, payment, &c, ctx);

    audit_anchor::anchor(receipt, b"", BLOB, &c, ctx);
    payment_intent::delete_finalized(intent);
    c.destroy_for_testing();
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 502, location = splash_core::audit_anchor)]
/// An anchor pointing at no blob cannot be verified off chain.
fun anchor_rejects_empty_blob() {
    let mut scenario = test_scenario::begin(SENDER);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000_000);

    let mut intent = new_intent(&c, ctx);
    let payment = coin::mint_for_testing<SUI>(1_000, ctx);
    let receipt = payment_intent::confirm_payment_intent(&mut intent, payment, &c, ctx);

    audit_anchor::anchor(receipt, HASH, b"", &c, ctx);
    payment_intent::delete_finalized(intent);
    c.destroy_for_testing();
    scenario.end();
}

// ── Capability separation (S-10) ───────────────────────────────────────────

#[test]
/// AttestationCap can attest. It cannot move value — and that is enforced by
/// the type system, not by this test: splash_core contains no function that
/// takes an AttestationCap and moves a Coin. There is nothing here to call.
fun attestation_cap_attests_but_moves_no_money() {
    let mut scenario = test_scenario::begin(SENDER);
    let ctx = scenario.ctx();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(1_000_000);

    let cap = business_account::attestation_cap_for_testing(ctx);
    audit_anchor::anchor_audit_hash(
        &cap,
        b"audit-hash".to_string(),
        b"anchor-001".to_string(),
        b"walrus-blob".to_string(),
        @0x0,
        &c,
        ctx,
    );
    business_account::destroy_attestation_cap(cap);
    c.destroy_for_testing();
    scenario.end();
}

#[test]
/// A business is unverified until an AdminCap says otherwise. `submit_application`
/// is permissionless (anyone may apply); verification is not.
fun business_is_unverified_until_admin_verifies() {
    let mut scenario = test_scenario::begin(SENDER);
    {
        let ctx = scenario.ctx();
        business_account::submit_application(
            b"SSM-202401012345".to_string(),
            b"bafy-kyb-cid".to_string(),
            ctx,
        );
    };

    scenario.next_tx(SENDER);
    {
        let mut account = scenario.take_from_sender<business_account::BusinessAccount>();
        assert_eq!(business_account::is_verified(&account), false);
        assert_eq!(business_account::owner(&account), SENDER);

        let ctx = scenario.ctx();
        let admin = business_account::admin_cap_for_testing(ctx);
        business_account::verify_business(&admin, &mut account, 20);
        assert_eq!(business_account::is_verified(&account), true);
        assert_eq!(business_account::risk_score(&account), 20);

        sui::test_utils::destroy(admin);
        scenario.return_to_sender(account);
    };
    scenario.end();
}

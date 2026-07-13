module splash_protocol::settlement;

use splash_protocol::business_account::{Self, BusinessAccount, AdminCap};
use splash_protocol::compliance_config::ComplianceConfig;
use splash_protocol::peg_monitor::{Self, PegState};
use deepbook::pool::Pool;
use openzeppelin_math::rounding;
use openzeppelin_math::u64 as oz_u64;
use sui::clock::Clock;
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;

// ─── Abort codes ────────────────────────────────────────────────────────────
const E_NOT_VERIFIED: u64 = 100;
const E_INSUFFICIENT_FUNDS: u64 = 101;
const E_EMPTY_BATCH: u64 = 102;
/// Caller passed fee_bps above MAX_FEE_BPS. Prevents fee gouging.
const E_FEE_EXCEEDED: u64 = 103;
const E_INVALID_RECIPIENT: u64 = 104;
const E_INVALID_AMOUNT: u64 = 105;
/// The BusinessAccount object was transferred away from the address recorded
/// as its owner. Verified status is not transferable (audit fix S-01).
const E_NOT_ACCOUNT_OWNER: u64 = 106;

// ─── Constants ──────────────────────────────────────────────────────────────
const BPS_DENOMINATOR: u64 = 10_000;
/// Hard ceiling on per-settlement fee. Any caller-supplied fee_bps above this
/// aborts the tx. 200 bps = 2.00%. Splash's advertised corridor fees are
/// 0.80%–1.10%, so 2% leaves headroom for emerging-market corridors but
/// prevents an attacker (or misconfigured off-chain quote) from siphoning
/// user funds via an absurd fee.
const MAX_FEE_BPS: u64 = 200;

public struct SettlementPool<phantom T> has key {
    id: UID,
    balance: Balance<T>,
    protocol_fees: Balance<T>,
}

public struct Payment has copy, drop, store {
    recipient: address,
    amount: u64,
}

public struct PaymentSettled has copy, drop {
    business_owner: address,
    recipient: address,
    gross_amount: u64,
    protocol_fee: u64,
    fee_bps: u64,
    net_amount: u64,
}

public struct PaymentExecuted has copy, drop {
    business_owner: address,
    recipient: address,
    gross_amount: u64,
    protocol_fee: u64,
    fee_bps: u64,
    net_amount: u64,
}

public fun new_payment(recipient: address, amount: u64): Payment {
    assert!(recipient != @0x0, E_INVALID_RECIPIENT);
    assert!(amount > 0, E_INVALID_AMOUNT);
    Payment { recipient, amount }
}

public fun create_pool<T>(ctx: &mut TxContext) {
    let pool = SettlementPool<T> {
        id: object::new(ctx),
        balance: balance::zero<T>(),
        protocol_fees: balance::zero<T>(),
    };

    transfer::share_object(pool);
}

public fun deposit<T>(pool: &mut SettlementPool<T>, coin: Coin<T>) {
    assert!(coin::value(&coin) > 0, E_INVALID_AMOUNT);
    balance::join(&mut pool.balance, coin::into_balance(coin));
}

/// Settle a single payment. `fee_bps` is set by the off-chain quote engine
/// per corridor (e.g. 80 for PHP, 110 for EUR) and is bounded by MAX_FEE_BPS.
public fun settle_payment<T, QuoteAsset>(
    pool: &mut SettlementPool<T>,
    business_account: &BusinessAccount,
    peg_state: &PegState,
    compliance_config: &ComplianceConfig,
    deepbook_pool: &Pool<T, QuoteAsset>,
    payment: Coin<T>,
    recipient: address,
    fee_bps: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(business_account::is_verified(business_account), E_NOT_VERIFIED);
    // Bind verified status to the address that passed KYB. The owned-object
    // rule already forces the tx sender to hold the account object; this
    // assert additionally rejects accounts whose object was transferred or
    // sold after verification (S-01: verified status is not transferable).
    assert!(business_account::owner(business_account) == tx_context::sender(ctx), E_NOT_ACCOUNT_OWNER);
    assert!(fee_bps <= MAX_FEE_BPS, E_FEE_EXCEEDED);
    assert!(recipient != @0x0, E_INVALID_RECIPIENT);
    peg_monitor::assert_pegged(peg_state, compliance_config, clock);

    let gross = coin::value(&payment);
    assert!(gross > 0, E_INVALID_AMOUNT);
    peg_monitor::assert_deepbook_liquidity(compliance_config, deepbook_pool, gross, clock);
    // OpenZeppelin checked mul_div (u128 intermediate, rounds down): fee
    // rounding always favors the payer, and overflow aborts instead of
    // wrapping.
    let fee = fee_of(gross, fee_bps);
    let net = gross - fee;

    assert!(net > 0, E_INSUFFICIENT_FUNDS);

    let mut payment_balance = coin::into_balance(payment);
    let fee_balance = balance::split(&mut payment_balance, fee);

    balance::join(&mut pool.protocol_fees, fee_balance);
    transfer::public_transfer(coin::from_balance(payment_balance, ctx), recipient);

    event::emit(PaymentSettled {
        business_owner: business_account::owner(business_account),
        recipient,
        gross_amount: gross,
        protocol_fee: fee,
        fee_bps,
        net_amount: net,
    });
}

/// Settle a batch of payments funded from the SHARED `pool.balance`. A single
/// `fee_bps` applies to every payment in the batch — batches are constructed
/// per corridor by the off-chain layer, so one fee per call is sufficient and
/// keeps the bounded-fee invariant simple to audit.
///
/// SECURITY: this draws payouts from the shared pool to caller-supplied
/// recipients, so it MUST be gated by the operator's `AdminCap`. Requiring the
/// cap means only the off-chain settlement operator (which computes legitimate
/// payouts) can move pool liquidity — `is_verified(business_account)` alone is
/// NOT sufficient, since any one KYB-approved tenant could otherwise drain the
/// pooled liquidity of every other business to an address they control.
public fun settle_batch<T, QuoteAsset>(
    _admin: &AdminCap,
    pool: &mut SettlementPool<T>,
    business_account: &BusinessAccount,
    peg_state: &PegState,
    compliance_config: &ComplianceConfig,
    deepbook_pool: &Pool<T, QuoteAsset>,
    payments: vector<Payment>,
    fee_bps: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(business_account::is_verified(business_account), E_NOT_VERIFIED);
    assert!(fee_bps <= MAX_FEE_BPS, E_FEE_EXCEEDED);
    peg_monitor::assert_pegged(peg_state, compliance_config, clock);
    assert!(vector::length(&payments) > 0, E_EMPTY_BATCH);

    let mut total_amount = 0;
    let mut index = 0;
    while (index < vector::length(&payments)) {
        total_amount = total_amount + vector::borrow(&payments, index).amount;
        index = index + 1;
    };
    peg_monitor::assert_deepbook_liquidity(compliance_config, deepbook_pool, total_amount, clock);

    let business_owner = business_account::owner(business_account);
    let mut payments = payments;

    while (!vector::is_empty(&payments)) {
        let payment = vector::pop_back(&mut payments);
        assert!(payment.recipient != @0x0, E_INVALID_RECIPIENT);
        assert!(payment.amount > 0, E_INVALID_AMOUNT);

        let fee = fee_of(payment.amount, fee_bps);
        let net = payment.amount - fee;

        // Same invariant as single settle — net must be positive after fee.
        assert!(net > 0, E_INSUFFICIENT_FUNDS);

        let fee_balance = balance::split(&mut pool.balance, fee);
        let payout_balance = balance::split(&mut pool.balance, net);

        balance::join(&mut pool.protocol_fees, fee_balance);
        transfer::public_transfer(coin::from_balance(payout_balance, ctx), payment.recipient);

        event::emit(PaymentExecuted {
            business_owner,
            recipient: payment.recipient,
            gross_amount: payment.amount,
            protocol_fee: fee,
            fee_bps,
            net_amount: net,
        });
    };
}

public fun settle_sui_batch<QuoteAsset>(
    admin: &AdminCap,
    pool: &mut SettlementPool<SUI>,
    business_account: &BusinessAccount,
    peg_state: &PegState,
    compliance_config: &ComplianceConfig,
    deepbook_pool: &Pool<SUI, QuoteAsset>,
    payments: vector<Payment>,
    fee_bps: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    settle_batch<SUI, QuoteAsset>(
        admin,
        pool,
        business_account,
        peg_state,
        compliance_config,
        deepbook_pool,
        payments,
        fee_bps,
        clock,
        ctx,
    );
}

/// Withdraw accumulated protocol fees to `recipient`. AdminCap-gated.
///
/// Audit fix S-02: fees previously accumulated in `pool.protocol_fees` with
/// no extraction path, permanently locking revenue in the shared object.
public fun withdraw_fees<T>(
    _admin: &AdminCap,
    pool: &mut SettlementPool<T>,
    recipient: address,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(recipient != @0x0, E_INVALID_RECIPIENT);
    assert!(amount > 0, E_INVALID_AMOUNT);
    assert!(balance::value(&pool.protocol_fees) >= amount, E_INSUFFICIENT_FUNDS);

    let fees = balance::split(&mut pool.protocol_fees, amount);
    transfer::public_transfer(coin::from_balance(fees, ctx), recipient);

    event::emit(FeesWithdrawn { recipient, amount });
}

public struct FeesWithdrawn has copy, drop {
    recipient: address,
    amount: u64,
}

/// Checked fee math shared by single and batch settlement.
fun fee_of(gross: u64, fee_bps: u64): u64 {
    oz_u64::mul_div(gross, fee_bps, BPS_DENOMINATOR, rounding::down()).destroy_some()
}

public fun pool_balance<T>(pool: &SettlementPool<T>): u64 {
    balance::value(&pool.balance)
}

public fun protocol_fees<T>(pool: &SettlementPool<T>): u64 {
    balance::value(&pool.protocol_fees)
}

/// Public read of the fee ceiling so off-chain code / explorers can verify
/// the bound without re-parsing the source.
public fun max_fee_bps(): u64 {
    MAX_FEE_BPS
}

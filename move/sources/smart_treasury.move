/// SmartTreasury — generic, AdminCap-gated treasury that actually holds funds.
///
/// Replaces the Phase 1 scaffold which (a) accepted `Coin<SUI>` while claiming
/// to hold USDC, (b) only tracked u64 counters with no on-chain backing, and
/// (c) called `coin::destroy_zero` on a non-zero coin and always aborted.
///
/// Findings addressed (see SECURITY.md):
///   - C-01: `add_usdc` always aborts
///   - C-02: treasury holds no real value
///   - M-04: shared object per rebalance → replaced with event
///   - M-05: magic abort codes → named constants
///
/// Design:
///   * `SmartTreasury<phantom T>` holds a real `Balance<T>` (USDC, USDT, or
///     any coin type chosen at create time).
///   * Deposits move the coin into the balance via `balance::join`.
///   * Withdrawals are AdminCap-gated and emit `TreasuryWithdrawn`.
///   * All state changes emit events — no shared objects per call.
module splash_protocol::smart_treasury;

use splash_protocol::business_account::{AdminCap, AttestationCap};
use std::string::String;
use sui::balance::{Self, Balance};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;

// ─── Abort codes ───────────────────────────────────────────────────────────
const E_INSUFFICIENT_BALANCE: u64 = 700;
const E_ZERO_AMOUNT:          u64 = 701;
const E_RECIPIENT_INVALID:    u64 = 702;
const E_OPERATING_FLOOR:      u64 = 703;

public struct SmartTreasury<phantom T> has key {
    id: UID,
    treasury_id: String,
    balance: Balance<T>,
    /// Lifetime cumulative deposit volume (informational only — not the
    /// current balance; for that use `balance::value(&treasury.balance)`).
    lifetime_deposited: u64,
    /// Lifetime cumulative withdraw volume.
    lifetime_withdrawn: u64,
    last_activity_ms: u64,
    /// AdminCap is required to mutate — `admin` is informational so off-chain
    /// indexers can show "who" deployed this treasury.
    admin: address,
}

// ─── Events ────────────────────────────────────────────────────────────────

public struct TreasuryDeposited has copy, drop {
    treasury_id: String,
    amount: u64,
    new_balance: u64,
    timestamp_ms: u64,
    from: address,
}

public struct TreasuryWithdrawn has copy, drop {
    treasury_id: String,
    amount: u64,
    new_balance: u64,
    timestamp_ms: u64,
    to: address,
    operator: address,
}

public struct TreasuryRebalanced has copy, drop {
    treasury_id: String,
    delta: u64,
    /// 0 = deposit-like (balance grew), 1 = withdraw-like (balance shrank)
    direction: u8,
    new_balance: u64,
    timestamp_ms: u64,
    operator: address,
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────

/// Create a treasury for coin type T. AdminCap-gated so anyone can't spam
/// the object table with empty treasuries.
public fun init_treasury<T>(
    _admin: &AdminCap,
    treasury_id: String,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let treasury = SmartTreasury<T> {
        id: object::new(ctx),
        treasury_id,
        balance: balance::zero<T>(),
        lifetime_deposited: 0,
        lifetime_withdrawn: 0,
        last_activity_ms: clock::timestamp_ms(clock),
        admin: tx_context::sender(ctx),
    };
    transfer::share_object(treasury);
}

/// Anyone can deposit — the treasury just receives coins. Mutates `balance`
/// for real (no more u64-counter fiction).
public fun deposit<T>(
    treasury: &mut SmartTreasury<T>,
    coin: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let amount = coin::value(&coin);
    assert!(amount > 0, E_ZERO_AMOUNT);

    balance::join(&mut treasury.balance, coin::into_balance(coin));
    treasury.lifetime_deposited = treasury.lifetime_deposited + amount;
    treasury.last_activity_ms = clock::timestamp_ms(clock);

    event::emit(TreasuryDeposited {
        treasury_id: treasury.treasury_id,
        amount,
        new_balance: balance::value(&treasury.balance),
        timestamp_ms: treasury.last_activity_ms,
        from: tx_context::sender(ctx),
    });
}

/// AdminCap-gated withdrawal. Returns the requested amount to `recipient`.
public fun withdraw<T>(
    treasury: &mut SmartTreasury<T>,
    _admin: &AdminCap,
    recipient: address,
    amount: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(amount > 0, E_ZERO_AMOUNT);
    assert!(recipient != @0x0, E_RECIPIENT_INVALID);
    assert!(balance::value(&treasury.balance) >= amount, E_INSUFFICIENT_BALANCE);

    let withdrawn = balance::split(&mut treasury.balance, amount);
    let coin = coin::from_balance(withdrawn, ctx);

    treasury.lifetime_withdrawn = treasury.lifetime_withdrawn + amount;
    treasury.last_activity_ms = clock::timestamp_ms(clock);

    event::emit(TreasuryWithdrawn {
        treasury_id: treasury.treasury_id,
        amount,
        new_balance: balance::value(&treasury.balance),
        timestamp_ms: treasury.last_activity_ms,
        to: recipient,
        operator: tx_context::sender(ctx),
    });

    transfer::public_transfer(coin, recipient);
}

/// Allocate funds out of the treasury while preserving the committed
/// operating minimum for the corridor.
public fun allocate<T>(
    treasury: &mut SmartTreasury<T>,
    _admin: &AdminCap,
    recipient: address,
    amount: u64,
    operating_minimum: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(amount > 0, E_ZERO_AMOUNT);
    assert!(recipient != @0x0, E_RECIPIENT_INVALID);

    let current_balance = balance::value(&treasury.balance);
    assert!(current_balance >= amount, E_INSUFFICIENT_BALANCE);
    assert!(current_balance - amount >= operating_minimum, E_OPERATING_FLOOR);

    let withdrawn = balance::split(&mut treasury.balance, amount);
    let coin = coin::from_balance(withdrawn, ctx);

    treasury.lifetime_withdrawn = treasury.lifetime_withdrawn + amount;
    treasury.last_activity_ms = clock::timestamp_ms(clock);

    event::emit(TreasuryWithdrawn {
        treasury_id: treasury.treasury_id,
        amount,
        new_balance: balance::value(&treasury.balance),
        timestamp_ms: treasury.last_activity_ms,
        to: recipient,
        operator: tx_context::sender(ctx),
    });

    transfer::public_transfer(coin, recipient);
}

/// Redeem is the symmetric operator path for returning funds from treasury.
public fun redeem<T>(
    treasury: &mut SmartTreasury<T>,
    admin: &AdminCap,
    recipient: address,
    amount: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    withdraw(treasury, admin, recipient, amount, clock, ctx);
}

/// Convenience wrapper that emits a rebalance-style event without creating
/// a separate shared object per call (M-04 fix). Use this when off-chain
/// accounting wants to tag a particular deposit/withdraw as part of a
/// rebalance flow.
/// AttestationCap-gated (cap split S-06): this only emits an accounting event
/// — `treasury` is an immutable reference and no balance moves — so it belongs
/// with the hot attestation key, not the cold money-authority AdminCap.
public fun emit_rebalance<T>(
    treasury: &SmartTreasury<T>,
    _cap: &AttestationCap,
    delta: u64,
    direction: u8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    event::emit(TreasuryRebalanced {
        treasury_id: treasury.treasury_id,
        delta,
        direction,
        new_balance: balance::value(&treasury.balance),
        timestamp_ms: clock::timestamp_ms(clock),
        operator: tx_context::sender(ctx),
    });
}

// ─── Views ─────────────────────────────────────────────────────────────────

public fun balance<T>(treasury: &SmartTreasury<T>): u64 {
    balance::value(&treasury.balance)
}

public fun lifetime_deposited<T>(treasury: &SmartTreasury<T>): u64 {
    treasury.lifetime_deposited
}

public fun lifetime_withdrawn<T>(treasury: &SmartTreasury<T>): u64 {
    treasury.lifetime_withdrawn
}

public fun last_activity_ms<T>(treasury: &SmartTreasury<T>): u64 {
    treasury.last_activity_ms
}

public fun admin<T>(treasury: &SmartTreasury<T>): address {
    treasury.admin
}

public fun treasury_id<T>(treasury: &SmartTreasury<T>): &String {
    &treasury.treasury_id
}

#[test_only]
public fun treasury_for_testing<T>(
    treasury_id: String,
    amount: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): SmartTreasury<T> {
    SmartTreasury<T> {
        id: object::new(ctx),
        treasury_id,
        balance: balance::create_for_testing<T>(amount),
        lifetime_deposited: amount,
        lifetime_withdrawn: 0,
        last_activity_ms: clock::timestamp_ms(clock),
        admin: tx_context::sender(ctx),
    }
}

#[test_only]
public fun destroy_for_testing<T>(treasury: SmartTreasury<T>): u64 {
    let SmartTreasury {
        id,
        treasury_id: _,
        balance,
        lifetime_deposited: _,
        lifetime_withdrawn: _,
        last_activity_ms: _,
        admin: _,
    } = treasury;
    id.delete();
    balance.destroy_for_testing()
}

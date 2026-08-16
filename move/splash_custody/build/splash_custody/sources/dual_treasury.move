module splash_custody::dual_treasury;

use splash_core::business_account::AdminCap;
use sui::balance::{Self, Balance};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;

const E_USDT_TTL_EXCEEDED: u64 = 600;
const E_USDT_BUFFER_EMPTY: u64 = 601;
const E_USDT_SWEEP_TOO_EARLY: u64 = 602;
const E_USDT_INSUFFICIENT_KYC_TIER: u64 = 603;
const E_USDT_INSUFFICIENT_BALANCE: u64 = 604;
const E_USDT_ACTIVE_BUFFER: u64 = 605;
const E_USDT_ZERO_AMOUNT: u64 = 606;
const E_USDT_INVALID_RECIPIENT: u64 = 607;
const USDT_MAX_HOLD_MS: u64 = 1_800_000;
const USDT_SWEEP_TRIGGER_MS: u64 = 1_620_000;

public struct UsdtBuffer<phantom USDT> has key {
    id: UID,
    balance: Balance<USDT>,
    intake_ms: u64,
    intake_amount: u64,
}

public struct UsdtDeposited has copy, drop {
    amount: u64,
    intake_ms: u64,
    expires_at_ms: u64,
}

public struct UsdtSettled has copy, drop {
    payout_id: vector<u8>,
    amount: u64,
    age_ms: u64,
    recipient: address,
}

public struct UsdtSwept has copy, drop {
    amount: u64,
    age_ms: u64,
}

public fun create_buffer<USDT>(_: &AdminCap, ctx: &mut TxContext): UsdtBuffer<USDT> {
    UsdtBuffer {
        id: object::new(ctx),
        balance: balance::zero(),
        intake_ms: 0,
        intake_amount: 0,
    }
}

/// Share a freshly-created buffer so it becomes a shared object that
/// `deposit`/`settle_usdt`/`emergency_sweep` (all of which take
/// `&mut UsdtBuffer`) can reference from a PTB.
///
/// `UsdtBuffer` only has the `key` ability (no `store`), so it cannot be
/// shared with `transfer::public_share_object` from outside this module —
/// without this entry the object returned by `create_buffer` could never be
/// persisted or used. Compose in one PTB: create_buffer → share_buffer.
public fun share_buffer<USDT>(buffer: UsdtBuffer<USDT>) {
    transfer::share_object(buffer);
}

/// Convenience: create the buffer and share it in a single call.
public fun create_and_share_buffer<USDT>(admin: &AdminCap, ctx: &mut TxContext) {
    share_buffer(create_buffer<USDT>(admin, ctx));
}

public fun deposit<USDT>(
    buffer: &mut UsdtBuffer<USDT>,
    coin: Coin<USDT>,
    clock: &Clock,
    _admin: &AdminCap,
) {
    let amount = coin::value(&coin);
    let now_ms = clock::timestamp_ms(clock);

    assert!(amount > 0, E_USDT_ZERO_AMOUNT);
    assert!(balance::value(&buffer.balance) == 0, E_USDT_ACTIVE_BUFFER);

    balance::join(&mut buffer.balance, coin::into_balance(coin));
    buffer.intake_ms = now_ms;
    buffer.intake_amount = amount;

    event::emit(UsdtDeposited {
        amount,
        intake_ms: now_ms,
        expires_at_ms: now_ms + USDT_MAX_HOLD_MS,
    });
}

public fun settle_usdt<USDT>(
    buffer: &mut UsdtBuffer<USDT>,
    _admin: &AdminCap,
    recipient: address,
    amount: u64,
    payout_id: vector<u8>,
    kyc_tier: u8,
    min_kyc_tier: u8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(amount > 0, E_USDT_ZERO_AMOUNT);
    assert!(recipient != @0x0, E_USDT_INVALID_RECIPIENT);
    assert!(kyc_tier >= min_kyc_tier, E_USDT_INSUFFICIENT_KYC_TIER);

    let balance_value = balance::value(&buffer.balance);
    assert!(balance_value > 0, E_USDT_BUFFER_EMPTY);
    assert!(buffer.intake_ms > 0, E_USDT_BUFFER_EMPTY);

    let age_ms = buffer_age_ms(buffer, clock);
    assert!(age_ms < USDT_MAX_HOLD_MS, E_USDT_TTL_EXCEEDED);
    assert!(balance_value >= amount, E_USDT_INSUFFICIENT_BALANCE);

    let coin = coin::from_balance(balance::split(&mut buffer.balance, amount), ctx);
    transfer::public_transfer(coin, recipient);

    if (balance::value(&buffer.balance) == 0) {
        buffer.intake_ms = 0;
        buffer.intake_amount = 0;
    };

    event::emit(UsdtSettled { payout_id, amount, age_ms, recipient });
}

public fun emergency_sweep<USDT>(
    buffer: &mut UsdtBuffer<USDT>,
    _admin: &AdminCap,
    recipient: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(recipient != @0x0, E_USDT_INVALID_RECIPIENT);

    let amount = balance::value(&buffer.balance);
    assert!(amount > 0, E_USDT_BUFFER_EMPTY);
    assert!(buffer.intake_ms > 0, E_USDT_BUFFER_EMPTY);

    let age_ms = buffer_age_ms(buffer, clock);
    assert!(age_ms >= USDT_SWEEP_TRIGGER_MS, E_USDT_SWEEP_TOO_EARLY);

    let coin = coin::from_balance(balance::split(&mut buffer.balance, amount), ctx);
    buffer.intake_ms = 0;
    buffer.intake_amount = 0;

    event::emit(UsdtSwept { amount, age_ms });
    transfer::public_transfer(coin, recipient);
}

public fun usdt_balance<USDT>(buffer: &UsdtBuffer<USDT>): u64 {
    balance::value(&buffer.balance)
}

public fun usdt_age_ms<USDT>(buffer: &UsdtBuffer<USDT>, clock: &Clock): u64 {
    buffer_age_ms(buffer, clock)
}

public fun ttl_remaining_ms<USDT>(buffer: &UsdtBuffer<USDT>, clock: &Clock): u64 {
    let age = usdt_age_ms(buffer, clock);
    if (age >= USDT_MAX_HOLD_MS) { 0 } else { USDT_MAX_HOLD_MS - age }
}

public fun sweep_trigger_ms(): u64 {
    USDT_SWEEP_TRIGGER_MS
}

public fun max_hold_ms(): u64 {
    USDT_MAX_HOLD_MS
}

fun buffer_age_ms<USDT>(buffer: &UsdtBuffer<USDT>, clock: &Clock): u64 {
    if (buffer.intake_ms == 0) {
        0
    } else {
        let now_ms = clock::timestamp_ms(clock);
        if (now_ms > buffer.intake_ms) { now_ms - buffer.intake_ms } else { 0 }
    }
}

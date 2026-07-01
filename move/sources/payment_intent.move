/// PaymentIntent — atomic payment flow with sender-bound authorization.
///
/// Replaces the Phase 1 scaffold which accepted a spoofable `sender`
/// argument (C-03), used the slow `epoch_timestamp_ms` for expiration
/// (H-01), allowed any third party to confirm a shared intent (H-02),
/// and over-charged the caller by forwarding the entire coin even when
/// it exceeded the requested amount (H-03).
///
/// Design:
///   * `sender` is always `tx_context::sender(ctx)` at creation — never an
///     argument.
///   * Confirmation requires `tx_context::sender == intent.sender`.
///   * Expiration uses `&Clock` (real wall-clock ms), not epoch boundaries.
///   * Overpay is refunded to the sender via `coin::split`.
///   * Named abort codes registered in `lib/server/sui-settlement.ts`.
module splash_protocol::payment_intent;

use std::string::String;
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;

// ─── Abort codes ───────────────────────────────────────────────────────────
const E_NOT_PENDING:           u64 = 400;
const E_EXPIRED:               u64 = 401;
const E_INSUFFICIENT_PAYMENT:  u64 = 402;
const E_NOT_YET_EXPIRED:       u64 = 403;
const E_UNAUTHORIZED:          u64 = 404;
const E_INVALID_AMOUNT:        u64 = 405;
const E_INVALID_RECIPIENT:     u64 = 406;
const E_EMPTY_TARGET_CURRENCY: u64 = 407;
const E_INVALID_FX_RATE:       u64 = 408;
const E_EMPTY_BENEFICIARY_REF: u64 = 409;
const E_EMPTY_CURRENCY:        u64 = 410;
const E_EMPTY_CORRIDOR:        u64 = 411;

// ─── Constants ─────────────────────────────────────────────────────────────
/// 5-minute expiration window.
const EXPIRATION_WINDOW_MS: u64 = 300_000;

// ─── Status constants ──────────────────────────────────────────────────────
const STATUS_PENDING:   u8 = 0;
const STATUS_CONFIRMED: u8 = 1;
const STATUS_EXPIRED:   u8 = 2;
const STATUS_CANCELED:  u8 = 3;

public struct PaymentIntent has key {
    id: UID,
    sender: address,
    recipient: address,
    /// Hash/reference of the verified counterparty record. Never raw PII.
    beneficiary_ref: vector<u8>,
    amount_usd: u64,
    currency: vector<u8>,
    corridor: vector<u8>,
    target_currency: String,
    /// USD→local FX rate scaled by 1e6.
    fx_rate_usd_local: u64,
    created_at: u64,
    created_epoch: u64,
    expires_at: u64,
    status: u8,
}

/// Non-droppable receipt that must be consumed by audit_anchor::anchor.
public struct SettleReceipt {
    intent_id: ID,
    sender: address,
    recipient: address,
    beneficiary_ref: vector<u8>,
    amount: u64,
    currency: vector<u8>,
    corridor: vector<u8>,
    created_epoch: u64,
    settled_at: u64,
}

// ─── Events ────────────────────────────────────────────────────────────────

public struct IntentCreated has copy, drop {
    intent_id: address,
    sender: address,
    recipient: address,
    amount_usd: u64,
    target_currency: String,
    fx_rate_usd_local: u64,
    created_at: u64,
    expires_at: u64,
}

public struct IntentConfirmed has copy, drop {
    intent_id: address,
    sender: address,
    recipient: address,
    amount_paid: u64,
    overpay_refunded: u64,
    confirmed_at: u64,
}

public struct IntentCanceled has copy, drop {
    intent_id: address,
    sender: address,
    canceled_at: u64,
    reason: u8, // STATUS_EXPIRED (2) or STATUS_CANCELED (3)
}

// ─── Entry / public functions ──────────────────────────────────────────────

/// Create a new intent. `sender` is bound to `tx_context::sender(ctx)` —
/// no longer a caller-supplied argument (C-03 fix).
public fun create_payment_intent(
    recipient: address,
    amount_usd: u64,
    target_currency: String,
    fx_rate_usd_local: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(amount_usd > 0, E_INVALID_AMOUNT);
    assert!(recipient != @0x0, E_INVALID_RECIPIENT);
    assert!(std::string::length(&target_currency) > 0, E_EMPTY_TARGET_CURRENCY);
    assert!(fx_rate_usd_local > 0, E_INVALID_FX_RATE);

    let sender = tx_context::sender(ctx);
    let now = clock::timestamp_ms(clock);
    let expires_at = now + EXPIRATION_WINDOW_MS;

    let intent = PaymentIntent {
        id: object::new(ctx),
        sender,
        recipient,
        beneficiary_ref: vector[],
        amount_usd,
        currency: b"SUI",
        corridor: vector[],
        target_currency,
        fx_rate_usd_local,
        created_at: now,
        created_epoch: ctx.epoch(),
        expires_at,
        status: STATUS_PENDING,
    };

    event::emit(IntentCreated {
        intent_id: object::uid_to_address(&intent.id),
        sender,
        recipient,
        amount_usd,
        target_currency: intent.target_currency,
        fx_rate_usd_local,
        created_at: now,
        expires_at,
    });

    transfer::share_object(intent);
}

/// Create an owned intent plus a non-droppable receipt that must be anchored
/// in the same PTB. The caller can share the returned intent with share_intent.
public fun create(
    recipient: address,
    beneficiary_ref: vector<u8>,
    amount: u64,
    currency: vector<u8>,
    corridor: vector<u8>,
    target_currency: String,
    fx_rate_usd_local: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): (PaymentIntent, SettleReceipt) {
    assert!(amount > 0, E_INVALID_AMOUNT);
    assert!(recipient != @0x0, E_INVALID_RECIPIENT);
    assert!(beneficiary_ref.length() > 0, E_EMPTY_BENEFICIARY_REF);
    assert!(currency.length() > 0, E_EMPTY_CURRENCY);
    assert!(corridor.length() > 0, E_EMPTY_CORRIDOR);
    assert!(std::string::length(&target_currency) > 0, E_EMPTY_TARGET_CURRENCY);
    assert!(fx_rate_usd_local > 0, E_INVALID_FX_RATE);

    let sender = tx_context::sender(ctx);
    let now = clock::timestamp_ms(clock);
    let created_epoch = ctx.epoch();
    let expires_at = now + EXPIRATION_WINDOW_MS;

    let intent = PaymentIntent {
        id: object::new(ctx),
        sender,
        recipient,
        beneficiary_ref,
        amount_usd: amount,
        currency,
        corridor,
        target_currency,
        fx_rate_usd_local,
        created_at: now,
        created_epoch,
        expires_at,
        status: STATUS_PENDING,
    };
    let intent_id = object::id(&intent);

    event::emit(IntentCreated {
        intent_id: object::uid_to_address(&intent.id),
        sender,
        recipient,
        amount_usd: amount,
        target_currency: intent.target_currency,
        fx_rate_usd_local,
        created_at: now,
        expires_at,
    });

    let receipt = SettleReceipt {
        intent_id,
        sender,
        recipient,
        beneficiary_ref: intent.beneficiary_ref,
        amount,
        currency: intent.currency,
        corridor: intent.corridor,
        created_epoch,
        settled_at: now,
    };

    (intent, receipt)
}

/// Share an owned intent returned by create.
public fun share_intent(intent: PaymentIntent) {
    transfer::share_object(intent);
}

/// Confirm an intent and execute payment. Only the original sender can call
/// (H-02 fix). Excess payment is split off and returned to the sender so the
/// recipient receives exactly `intent.amount_usd` (H-03 fix).
public fun confirm_payment_intent(
    intent: &mut PaymentIntent,
    mut payment: Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
): SettleReceipt {
    let caller = tx_context::sender(ctx);
    assert!(caller == intent.sender, E_UNAUTHORIZED);
    assert!(intent.status == STATUS_PENDING, E_NOT_PENDING);
    assert!(clock::timestamp_ms(clock) < intent.expires_at, E_EXPIRED);

    let provided = coin::value(&payment);
    assert!(provided >= intent.amount_usd, E_INSUFFICIENT_PAYMENT);

    let overpay = provided - intent.amount_usd;

    // Split off the exact amount; refund the rest if any.
    let to_recipient = coin::split(&mut payment, intent.amount_usd, ctx);
    transfer::public_transfer(to_recipient, intent.recipient);

    if (overpay > 0) {
        transfer::public_transfer(payment, caller);
    } else {
        // `payment` is now zero-value; destroy it safely.
        coin::destroy_zero(payment);
    };

    intent.status = STATUS_CONFIRMED;
    let confirmed_at = clock::timestamp_ms(clock);

    event::emit(IntentConfirmed {
        intent_id: object::uid_to_address(&intent.id),
        sender: intent.sender,
        recipient: intent.recipient,
        amount_paid: intent.amount_usd,
        overpay_refunded: overpay,
        confirmed_at,
    });

    SettleReceipt {
        intent_id: object::id(intent),
        sender: intent.sender,
        recipient: intent.recipient,
        beneficiary_ref: intent.beneficiary_ref,
        amount: intent.amount_usd,
        currency: intent.currency,
        corridor: intent.corridor,
        created_epoch: intent.created_epoch,
        settled_at: confirmed_at,
    }
}

/// Consume an owned pending intent without settlement.
public fun cancel(intent: PaymentIntent, ctx: &mut TxContext) {
    assert!(tx_context::sender(ctx) == intent.sender, E_UNAUTHORIZED);
    assert!(intent.status == STATUS_PENDING, E_NOT_PENDING);

    event::emit(IntentCanceled {
        intent_id: object::uid_to_address(&intent.id),
        sender: intent.sender,
        canceled_at: ctx.epoch_timestamp_ms(),
        reason: STATUS_CANCELED,
    });

    let PaymentIntent {
        id,
        sender: _,
        recipient: _,
        beneficiary_ref: _,
        amount_usd: _,
        currency: _,
        corridor: _,
        target_currency: _,
        fx_rate_usd_local: _,
        created_at: _,
        created_epoch: _,
        expires_at: _,
        status: _,
    } = intent;
    id.delete();
}

/// Cancel an expired intent. Anyone can call after the deadline.
public fun cancel_payment_intent(
    intent: &mut PaymentIntent,
    clock: &Clock,
    _ctx: &mut TxContext,
) {
    assert!(intent.status == STATUS_PENDING, E_NOT_PENDING);
    let now = clock::timestamp_ms(clock);
    assert!(now >= intent.expires_at, E_NOT_YET_EXPIRED);

    intent.status = STATUS_EXPIRED;

    event::emit(IntentCanceled {
        intent_id: object::uid_to_address(&intent.id),
        sender: intent.sender,
        canceled_at: now,
        reason: STATUS_EXPIRED,
    });
}

/// Sender-initiated cancel before expiration. Only the original sender can call.
public fun cancel_by_sender(
    intent: &mut PaymentIntent,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(tx_context::sender(ctx) == intent.sender, E_UNAUTHORIZED);
    assert!(intent.status == STATUS_PENDING, E_NOT_PENDING);

    intent.status = STATUS_CANCELED;

    event::emit(IntentCanceled {
        intent_id: object::uid_to_address(&intent.id),
        sender: intent.sender,
        canceled_at: clock::timestamp_ms(clock),
        reason: STATUS_CANCELED,
    });
}

// ─── Views ─────────────────────────────────────────────────────────────────

public fun sender(intent: &PaymentIntent): address          { intent.sender }
public fun recipient(intent: &PaymentIntent): address       { intent.recipient }
public fun amount_usd(intent: &PaymentIntent): u64          { intent.amount_usd }
public fun status(intent: &PaymentIntent): u8               { intent.status }
public fun expires_at(intent: &PaymentIntent): u64          { intent.expires_at }
public fun target_currency(intent: &PaymentIntent): &String { &intent.target_currency }

public fun is_expired(intent: &PaymentIntent, clock: &Clock): bool {
    clock::timestamp_ms(clock) >= intent.expires_at
}

public(package) fun unpack_settle_receipt(
    receipt: SettleReceipt,
): (ID, address, address, vector<u8>, u64, vector<u8>, vector<u8>, u64, u64) {
    let SettleReceipt {
        intent_id,
        sender,
        recipient,
        beneficiary_ref,
        amount,
        currency,
        corridor,
        created_epoch,
        settled_at,
    } = receipt;

    (
        intent_id,
        sender,
        recipient,
        beneficiary_ref,
        amount,
        currency,
        corridor,
        created_epoch,
        settled_at,
    )
}

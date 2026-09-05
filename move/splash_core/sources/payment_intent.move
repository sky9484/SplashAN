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
module splash_core::payment_intent;

use std::string::String;
use std::type_name;
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;

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
const E_STILL_PENDING:         u64 = 412;
/// A module other than `audit_anchor` tried to consume a `SettleReceipt`.
const E_UNAUTHORIZED_RECEIPT_CONSUMER: u64 = 413;
/// The coin type offered does not match the asset the intent was created for.
const E_WRONG_SETTLEMENT_ASSET: u64 = 414;

/// The only module permitted to destroy a `SettleReceipt`. Bound by module name
/// because Move forbids the circular import that naming the type would require —
/// see `unpack_settle_receipt`.
const ANCHOR_MODULE: vector<u8> = b"audit_anchor";

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
    /// Fully-qualified type of the coin this intent must be settled in, e.g.
    /// `…::usdc::USDC`. Bound at creation and asserted at confirmation.
    ///
    /// Without this, making `confirm_payment_intent` generic over `Coin<T>` —
    /// which it must be, since hardcoding `Coin<SUI>` settles a USD corridor in
    /// a volatile asset — would let ANY coin type satisfy an intent. The
    /// contract compares `coin::value(&payment)` against `amount_usd`, so a
    /// payer could discharge a 100 USDC obligation with 100_000_000 units of a
    /// worthless token and the recipient would receive exactly that.
    settlement_asset: String,
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
public fun create_payment_intent<T>(
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
        // Was hardcoded b"SUI". The corridor is USD-denominated, so the
        // settlement asset is now whatever `T` the caller opened the intent in,
        // recorded verbatim rather than asserted to be SUI.
        currency: type_name::with_defining_ids<T>().into_string().into_bytes(),
        corridor: vector[],
        target_currency,
        settlement_asset: type_name::with_defining_ids<T>().into_string().to_string(),
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
public fun create<T>(
    recipient: address,
    beneficiary_ref: vector<u8>,
    amount: u64,
    currency: vector<u8>,
    corridor: vector<u8>,
    target_currency: String,
    fx_rate_usd_local: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): PaymentIntent {
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
        settlement_asset: type_name::with_defining_ids<T>().into_string().to_string(),
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

    // M1 FIX — `create` used to mint a `SettleReceipt` right here, with
    // `settled_at: now` and no `Coin` anywhere in the function. The type asserted
    // that a settlement had occurred while no value had moved, and
    // `audit_anchor` would then anchor that assertion on chain as if it were
    // proof of payment. A receipt is now minted in exactly one place —
    // `confirm_payment_intent`, which takes a `Coin<T>`, asserts it covers the
    // intent, splits it, and transfers to the recipient. No coin, no receipt.
    let _ = intent_id;
    intent
}

/// Share an owned intent returned by create.
public fun share_intent(intent: PaymentIntent) {
    transfer::share_object(intent);
}

/// Confirm an intent and execute payment. Only the original sender can call
/// (H-02 fix). Excess payment is split off and returned to the sender so the
/// recipient receives exactly `intent.amount_usd` (H-03 fix).
public fun confirm_payment_intent<T>(
    intent: &mut PaymentIntent,
    mut payment: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
): SettleReceipt {
    let caller = tx_context::sender(ctx);
    assert!(caller == intent.sender, E_UNAUTHORIZED);
    assert!(intent.status == STATUS_PENDING, E_NOT_PENDING);
    assert!(clock::timestamp_ms(clock) < intent.expires_at, E_EXPIRED);
    // The asset is bound to the one the intent was opened in. Generic-without-
    // binding would be strictly WORSE than the hardcoded `Coin<SUI>` it
    // replaces: any coin type could discharge the obligation, because the only
    // amount check is `coin::value(&payment) >= intent.amount_usd` and unit
    // counts are meaningless across assets.
    assert!(
        type_name::with_defining_ids<T>().into_string().to_string() == intent.settlement_asset,
        E_WRONG_SETTLEMENT_ASSET,
    );

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
        settlement_asset: _,
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

/// Delete a finalized (confirmed, expired, or canceled) intent to reclaim
/// storage — shared intents otherwise live forever (audit fix S-04). Pending
/// intents must be resolved through confirm/cancel first so their terminal
/// state is evented before the object disappears.
public fun delete_finalized(intent: PaymentIntent) {
    assert!(intent.status != STATUS_PENDING, E_STILL_PENDING);

    let PaymentIntent {
        id,
        sender: _,
        recipient: _,
        beneficiary_ref: _,
        amount_usd: _,
        currency: _,
        corridor: _,
        target_currency: _,
        settlement_asset: _,
        fx_rate_usd_local: _,
        created_at: _,
        created_epoch: _,
        expires_at: _,
        status: _,
    } = intent;
    id.delete();
}

// ─── Views ─────────────────────────────────────────────────────────────────

public fun sender(intent: &PaymentIntent): address          { intent.sender }
public fun recipient(intent: &PaymentIntent): address       { intent.recipient }
public fun amount_usd(intent: &PaymentIntent): u64          { intent.amount_usd }
public fun status(intent: &PaymentIntent): u8               { intent.status }
public fun expires_at(intent: &PaymentIntent): u64          { intent.expires_at }
public fun target_currency(intent: &PaymentIntent): &String { &intent.target_currency }
public fun settlement_asset(intent: &PaymentIntent): &String { &intent.settlement_asset }

public fun is_expired(intent: &PaymentIntent, clock: &Clock): bool {
    clock::timestamp_ms(clock) >= intent.expires_at
}

/// Consume a settlement receipt. THE ONLY function that destroys a
/// `SettleReceipt`, and it may only be called from `audit_anchor`.
///
/// `SettleReceipt` is a hot potato — no `drop`, no `store`, no `key` — so a PTB
/// that produces one must consume it here or abort. That already guaranteed
/// "every settlement is anchored *or the transaction fails*". What it did NOT
/// guarantee was WHO does the anchoring: `public(package)` meant any future
/// module in this package could unpack a receipt and discard the fields without
/// ever emitting an anchor event, silently breaking the audit trail.
///
/// The witness closes that. `audit_anchor::AnchorWitness` can only be
/// constructed inside `audit_anchor` (Move permits struct construction only in
/// the defining module), so holding one proves the caller IS the anchoring path.
///
/// Why the witness is generic + checked at runtime rather than named directly:
/// `audit_anchor` already depends on `payment_intent`, and Move forbids circular
/// module dependencies, so this module cannot import `AnchorWitness` by name.
/// Binding on the module identity of the witness type achieves the same
/// restriction — the assert cannot be satisfied by any type outside
/// `audit_anchor`, because no other module can construct one.
public(package) fun unpack_settle_receipt<W: drop>(
    _witness: W,
    receipt: SettleReceipt,
): (ID, address, address, vector<u8>, u64, vector<u8>, vector<u8>, u64, u64) {
    assert!(
        type_name::with_defining_ids<W>().module_string() == std::ascii::string(ANCHOR_MODULE),
        E_UNAUTHORIZED_RECEIPT_CONSUMER,
    );
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

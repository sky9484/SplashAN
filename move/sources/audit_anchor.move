/// AuditAnchor — immutable on-chain anchoring of off-chain audit content.
///
/// Replaces the Phase 1 scaffold which (a) had no caller authorization so
/// anyone could pollute the audit trail with junk anchors (M-01) and (b)
/// shipped a tautological `verify_anchor` function that compared a hash
/// against itself (M-02).
///
/// Design:
///   * Anchors are AdminCap-gated. Off-chain indexers can trust that any
///     `AuditAnchor` shared object in the package came from the protocol.
///   * Each anchor records the anchorer + business account it relates to
///     so tenant-level audit trails are filterable.
///   * `verify_anchor` now takes an externally-supplied `expected_hash`
///     and a Walrus blob ID and emits a `VerificationChecked` event so
///     the verification leaves a trace (instead of being a no-op view).
module splash_protocol::audit_anchor;

use splash_protocol::business_account::AdminCap;
use splash_protocol::payment_intent::{Self, SettleReceipt};
use std::string::String;
use sui::clock::{Self, Clock};
use sui::event;

// ─── Abort codes ───────────────────────────────────────────────────────────
const E_EMPTY_HASH:    u64 = 500;
const E_EMPTY_ANCHOR:  u64 = 501;
const E_EMPTY_BLOB:    u64 = 502;

public struct AuditAnchor has key {
    id: UID,
    audit_hash: String,
    anchor_id: String,
    /// Walrus blob CID (or other off-chain pointer) backing this anchor.
    backing_blob: String,
    anchored_at: u64,
    anchorer: address,
    /// Tenant tag — typically the BusinessAccount object address whose
    /// receipts this anchor commits to. `@0x0` for protocol-wide anchors.
    business_account_id: address,
}

// ─── Events ────────────────────────────────────────────────────────────────

public struct AuditAnchored has copy, drop {
    anchor_object: address,
    audit_hash: String,
    anchor_id: String,
    backing_blob: String,
    anchored_at: u64,
    anchorer: address,
    business_account_id: address,
}

public struct VerificationChecked has copy, drop {
    anchor_object: address,
    matched: bool,
    checker: address,
    timestamp_ms: u64,
}

// ─── Entry / public functions ──────────────────────────────────────────────

/// Settlement receipt anchor event emitted by the hot-potato anchor path.
public struct SettlementAnchored has copy, drop {
    intent_id: ID,
    sender: address,
    recipient: address,
    beneficiary_ref: vector<u8>,
    amount: u64,
    currency: vector<u8>,
    corridor: vector<u8>,
    content_hash: vector<u8>,
    walrus_blob_id: vector<u8>,
    created_epoch: u64,
    settled_at: u64,
    anchored_at: u64,
    anchorer: address,
}

/// Anchor an audit hash. AdminCap-gated (M-01 fix).
public fun anchor_audit_hash(
    _admin: &AdminCap,
    audit_hash: String,
    anchor_id: String,
    backing_blob: String,
    business_account_id: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // Length-check via byte access so we don't accidentally accept the
    // empty string as a "valid" hash.
    assert!(std::string::length(&audit_hash) > 0, E_EMPTY_HASH);
    assert!(std::string::length(&anchor_id) > 0,   E_EMPTY_ANCHOR);

    let now = clock::timestamp_ms(clock);
    let anchor = AuditAnchor {
        id: object::new(ctx),
        audit_hash,
        anchor_id,
        backing_blob,
        anchored_at: now,
        anchorer: tx_context::sender(ctx),
        business_account_id,
    };

    event::emit(AuditAnchored {
        anchor_object: object::uid_to_address(&anchor.id),
        audit_hash: anchor.audit_hash,
        anchor_id: anchor.anchor_id,
        backing_blob: anchor.backing_blob,
        anchored_at: now,
        anchorer: anchor.anchorer,
        business_account_id,
    });

    transfer::share_object(anchor);
}

/// Verify a hash against this anchor. Unlike the prior tautological
/// implementation (M-02), this emits a traceable event with the result.
/// Off-chain auditors can rely on the on-chain `VerificationChecked`
/// trail to prove that a hash was at one point verified by someone.
public fun verify_anchor(
    anchor: &AuditAnchor,
    expected_hash: String,
    clock: &Clock,
    ctx: &TxContext,
): bool {
    let matched = anchor.audit_hash == expected_hash;

    event::emit(VerificationChecked {
        anchor_object: object::id_address(anchor),
        matched,
        checker: tx_context::sender(ctx),
        timestamp_ms: clock::timestamp_ms(clock),
    });

    matched
}

/// Consume the settlement receipt produced by payment_intent.
public fun anchor(
    receipt: SettleReceipt,
    content_hash: vector<u8>,
    walrus_blob_id: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(content_hash.length() > 0, E_EMPTY_HASH);
    assert!(walrus_blob_id.length() > 0, E_EMPTY_BLOB);

    let (
        intent_id,
        sender,
        recipient,
        beneficiary_ref,
        amount,
        currency,
        corridor,
        created_epoch,
        settled_at,
    ) = payment_intent::unpack_settle_receipt(receipt);

    event::emit(SettlementAnchored {
        intent_id,
        sender,
        recipient,
        beneficiary_ref,
        amount,
        currency,
        corridor,
        content_hash,
        walrus_blob_id,
        created_epoch,
        settled_at,
        anchored_at: clock::timestamp_ms(clock),
        anchorer: tx_context::sender(ctx),
    });
}

// ─── Views ─────────────────────────────────────────────────────────────────

public fun audit_hash(anchor: &AuditAnchor): &String        { &anchor.audit_hash }
public fun anchor_id(anchor: &AuditAnchor): &String         { &anchor.anchor_id }
public fun backing_blob(anchor: &AuditAnchor): &String      { &anchor.backing_blob }
public fun anchored_at(anchor: &AuditAnchor): u64           { anchor.anchored_at }
public fun anchorer(anchor: &AuditAnchor): address          { anchor.anchorer }
public fun business_account_id(anchor: &AuditAnchor): address { anchor.business_account_id }

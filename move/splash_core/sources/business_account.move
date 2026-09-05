module splash_core::business_account;

use std::string::String;
use sui::event;

const E_ALREADY_VERIFIED: u64 = 1;
const E_EMPTY_SSM_NUMBER: u64 = 2;
const E_EMPTY_KYB_CID: u64 = 3;
const E_INVALID_HOLDER: u64 = 4;
/// `revoke_verification` called on an account that was never verified.
const E_NOT_VERIFIED_YET: u64 = 5;

/// AdminCap — MONEY AUTHORITY. Gates `verify_business`, `smart_treasury::*`,
/// `settlement::settle_*` / `withdraw_fees`, `dual_treasury::*`,
/// `compliance_config::create`, and the minting of `AttestationCap`.
///
/// Has `store` so it can be transferred to a cold 2-of-3 Sui multisig address
/// (see the key-ceremony runbook). Nothing that moves value may ever be gated
/// by anything weaker than this cap.
public struct AdminCap has key, store {
    id: UID,
}

/// AttestationCap — hot-key authority for routine, NON-FINANCIAL attestations:
/// `audit_anchor::anchor_audit_hash`, `receipt_v2::create_receipt`,
/// `peg_monitor::update_peg`, `smart_treasury::emit_rebalance`.
///
/// S-10 fix (see SECURITY.md). Those four writes previously required
/// `&AdminCap`; because the peg daemon signs one every ~30s, `AdminCap` could
/// never move to the cold multisig, leaving full money authority on a hot host.
///
/// Segregation of duties: the operator server holds ONLY this cap, so a
/// compromised server key can write attestations but cannot move a single
/// coin. That is the whole point of the split — money authority stays offline.
///
/// Deliberately `key` ONLY (no `store`): it cannot be `public_transfer`red out
/// of this module, so every custody change must go through
/// `mint_attestation_cap` / `destroy_attestation_cap` and leaves an event for
/// off-chain monitoring.
public struct AttestationCap has key {
    id: UID,
}

public struct BusinessAccount has key, store {
    id: UID,
    owner: address,
    ssm_number: String,
    kyb_cid: String,
    is_verified: bool,
    risk_score: u8,
}

public struct ApplicationReceived has copy, drop {
    business_account_id: address,
    owner: address,
    ssm_number: String,
    kyb_cid: String,
}

public struct BusinessUnverified has copy, drop {
    business_account_id: address,
    owner: address,
}

public struct BusinessVerified has copy, drop {
    business_account_id: address,
    owner: address,
    risk_score: u8,
}

/// Emitted whenever attestation authority is granted. Security-critical:
/// off-chain monitoring should alert on any mint it did not initiate.
public struct AttestationCapMinted has copy, drop {
    attestation_cap_id: address,
    holder: address,
}

public struct AttestationCapDestroyed has copy, drop {
    attestation_cap_id: address,
}

fun init(ctx: &mut TxContext) {
    transfer::transfer(AdminCap { id: object::new(ctx) }, tx_context::sender(ctx));
}

#[allow(lint(self_transfer))]
public fun submit_application(ssm_number: String, kyb_cid: String, ctx: &mut TxContext) {
    assert!(std::string::length(&ssm_number) > 0, E_EMPTY_SSM_NUMBER);
    assert!(std::string::length(&kyb_cid) > 0, E_EMPTY_KYB_CID);

    let owner = tx_context::sender(ctx);
    let account = BusinessAccount {
        id: object::new(ctx),
        owner,
        ssm_number,
        kyb_cid,
        is_verified: false,
        risk_score: 0,
    };

    let business_account_id = object::uid_to_address(&account.id);
    event::emit(ApplicationReceived {
        business_account_id,
        owner,
        ssm_number: account.ssm_number,
        kyb_cid: account.kyb_cid,
    });

    transfer::transfer(account, owner);
}

public fun verify_business(_: &AdminCap, account: &mut BusinessAccount, risk_score: u8) {
    assert!(!account.is_verified, E_ALREADY_VERIFIED);
    account.is_verified = true;
    account.risk_score = risk_score;

    event::emit(BusinessVerified {
        business_account_id: object::uid_to_address(&account.id),
        owner: account.owner,
        risk_score,
    });
}

/// Grant attestation authority to the hot operator server. AdminCap-gated, so
/// only the cold multisig can create it.
/// Withdraw a business's verified status.
///
/// MUST ship before the immutable publish — it cannot be added afterwards.
/// `verify_business` asserts `!is_verified` and there was no inverse anywhere in
/// the package, so an account verified on mainnet was verified FOREVER. For a
/// licensed e-money issuer that is a compliance defect standing on its own: a
/// business whose KYB lapses, whose licence is withdrawn, or which turns out to
/// be a shell cannot be un-verified, and `settle_payment` gates on exactly this
/// flag.
///
/// Deliberately resets `risk_score` to 0 as well — leaving a stale score on an
/// unverified account invites a later reader to treat it as still assessed.
public fun revoke_verification(_: &AdminCap, account: &mut BusinessAccount) {
    assert!(account.is_verified, E_NOT_VERIFIED_YET);
    account.is_verified = false;
    account.risk_score = 0;

    event::emit(BusinessUnverified {
        business_account_id: object::uid_to_address(&account.id),
        owner: account.owner,
    });
}

public fun mint_attestation_cap(_: &AdminCap, holder: address, ctx: &mut TxContext) {
    assert!(holder != @0x0, E_INVALID_HOLDER);

    let cap = AttestationCap { id: object::new(ctx) };
    event::emit(AttestationCapMinted {
        attestation_cap_id: object::uid_to_address(&cap.id),
        holder,
    });
    transfer::transfer(cap, holder);
}

/// Burn an `AttestationCap`. Callable by its holder, which makes routine
/// rotation self-service: the multisig mints a replacement, the server starts
/// using it, then the old cap is burned.
///
/// Note honestly what this is NOT: it cannot claw back a *stolen* cap, since
/// the thief simply never calls this. Containment for a stolen attestation cap
/// is (a) it can move no funds by construction, and (b) off-chain rejection of
/// anchors/receipts bearing the retired cap id. See the key-ceremony runbook.
public fun destroy_attestation_cap(cap: AttestationCap) {
    let AttestationCap { id } = cap;
    event::emit(AttestationCapDestroyed {
        attestation_cap_id: object::uid_to_address(&id),
    });
    object::delete(id);
}

public fun owner(account: &BusinessAccount): address {
    account.owner
}

public fun ssm_number(account: &BusinessAccount): &String {
    &account.ssm_number
}

public fun kyb_cid(account: &BusinessAccount): &String {
    &account.kyb_cid
}

public fun is_verified(account: &BusinessAccount): bool {
    account.is_verified
}

public fun risk_score(account: &BusinessAccount): u8 {
    account.risk_score
}

#[test_only]
public fun admin_cap_for_testing(ctx: &mut TxContext): AdminCap {
    AdminCap { id: object::new(ctx) }
}

#[test_only]
public fun attestation_cap_for_testing(ctx: &mut TxContext): AttestationCap {
    AttestationCap { id: object::new(ctx) }
}

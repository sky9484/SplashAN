module splash_protocol::business_account;

use std::string::String;
use sui::event;

const E_ALREADY_VERIFIED: u64 = 1;
const E_EMPTY_SSM_NUMBER: u64 = 2;
const E_EMPTY_KYB_CID: u64 = 3;

public struct AdminCap has key, store {
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

public struct BusinessVerified has copy, drop {
    business_account_id: address,
    owner: address,
    risk_score: u8,
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

/// Phase 7 — break-glass.
///
/// Phase 6 removed arbitrary capability minting and said plainly what that
/// cost: a LOST `AnchorCap` bricked anchoring in an immutable package, and a
/// STOLEN one could not be clawed back because `destroy_anchor_cap` is callable
/// only by its holder and a thief simply never calls it.
///
/// The tests below are the difference between having said that and having
/// fixed it. The one that matters most is
/// `a_stolen_cap_is_dead_without_its_holders_cooperation` — everything else is
/// scaffolding around that property.
#[test_only]
module splash_core::break_glass_tests;

use splash_core::audit_anchor;
use splash_core::business_account::{Self, AdminCap, AnchorCap};
use splash_core::cap_registry::{Self, CapRegistry};
use splash_core::compliance_config::{Self, ComplianceConfig, ComplianceCap};
use std::unit_test::assert_eq;
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts, Scenario};

const PUBLISHER: address = @0xA11CE;
const OPERATOR: address = @0xBEEF;
const THIEF: address = @0xDEAD;

const HASH: vector<u8> = b"0123456789abcdef0123456789abcdef";
const BLOB: vector<u8> = b"walrus-blob-id";

const DEVIATION: u64 = 5_000;
const STALENESS: u64 = 300_000;
const SLIPPAGE: u64 = 500;
const DEPTH: u64 = 1_000_000;
const FLOOR: u64 = 100_000_000;

fun pool_a(): ID { object::id_from_address(@0xF001) }

/// Publish: both module initialisers, in one transaction, exactly as a real
/// publish runs them.
fun publish(): Scenario {
    let mut scenario = ts::begin(PUBLISHER);
    {
        let ctx = scenario.ctx();
        cap_registry::init_for_testing(ctx);
        business_account::init_for_testing(ctx);
        let mut c = clock::create_for_testing(ctx);
        c.set_for_testing(1_000_000);
        clock::share_for_testing(c);
    };
    scenario
}

/// Anchor something with the cap held by `who`. The whole point of the
/// capability, exercised the way the operator server exercises it.
fun anchor_as(scenario: &mut Scenario, who: address) {
    scenario.next_tx(who);
    let cap = scenario.take_from_sender<AnchorCap>();
    let registry = scenario.take_shared<CapRegistry>();
    let c = scenario.take_shared<Clock>();
    let ctx = scenario.ctx();
    audit_anchor::anchor_audit_hash(
        &cap,
        &registry,
        b"audit-hash".to_string(),
        b"anchor-001".to_string(),
        b"walrus-blob".to_string(),
        @0x0,
        &c,
        ctx,
    );
    ts::return_shared(c);
    ts::return_shared(registry);
    scenario.return_to_sender(cap);
}

fun break_glass(scenario: &mut Scenario, holder: address, reason: vector<u8>) {
    scenario.next_tx(PUBLISHER);
    let admin = scenario.take_from_sender<AdminCap>();
    let mut registry = scenario.take_shared<CapRegistry>();
    let ctx = scenario.ctx();
    business_account::break_glass_anchor_cap(&admin, &mut registry, holder, reason, ctx);
    ts::return_shared(registry);
    scenario.return_to_sender(admin);
}

// ─── Genesis ───────────────────────────────────────────────────────────────

#[test]
/// The two initialisers agree.
///
/// `business_account::init` mints the anchor cap and `cap_registry::init`
/// shares the registry, in the same publish transaction, and neither can read
/// the other's object while it runs — so both hardcode the genesis generation.
/// If they ever disagree the package publishes with a capability that is dead
/// on arrival, which is exactly the kind of thing nobody notices until the
/// first anchor fails.
fun the_publish_mints_a_cap_the_registry_recognises() {
    let mut scenario = publish();
    scenario.next_tx(PUBLISHER);
    {
        let cap = scenario.take_from_sender<AnchorCap>();
        let registry = scenario.take_shared<CapRegistry>();
        assert_eq!(business_account::anchor_cap_generation(&cap), cap_registry::genesis());
        assert_eq!(cap_registry::anchor_generation(&registry), cap_registry::genesis());
        assert_eq!(
            cap_registry::is_current(&registry, cap_registry::kind_anchor(), cap_registry::genesis()),
            true,
        );
        ts::return_shared(registry);
        scenario.return_to_sender(cap);
    };
    // And it works.
    anchor_as(&mut scenario, PUBLISHER);
    scenario.end();
}

// ─── The property Phase 6 could not provide ────────────────────────────────

#[test]
#[expected_failure(abort_code = 210, location = splash_core::cap_registry)]
/// THE headline. A stolen capability dies without its holder's cooperation.
///
/// Phase 6's containment for a stolen anchor cap was, in its own words,
/// "off-chain rejection of anchors bearing the retired cap id" — a hope about
/// what every future consumer would remember to check, not a control. The
/// thief here never calls anything, never consents, and never notices; their
/// object is intact and well-formed, and it stops working.
fun a_stolen_cap_is_dead_without_its_holders_cooperation() {
    let mut scenario = publish();

    // The operator's cap ends up in a thief's hands. Modelled by minting one
    // to them directly — possession is the whole of the attacker's position.
    scenario.next_tx(PUBLISHER);
    {
        let admin = scenario.take_from_sender<AdminCap>();
        let mut registry = scenario.take_shared<CapRegistry>();
        let ctx = scenario.ctx();
        business_account::break_glass_anchor_cap(&admin, &mut registry, THIEF, b"seed", ctx);
        ts::return_shared(registry);
        scenario.return_to_sender(admin);
    };
    // It works, so the abort below is not a false pass.
    anchor_as(&mut scenario, THIEF);

    // Splash revokes. The thief is not consulted.
    break_glass(&mut scenario, OPERATOR, b"suspected compromise");

    anchor_as(&mut scenario, THIEF);
    scenario.end();
}

#[test]
/// And the replacement works immediately, with no old cap surrendered.
///
/// This is the LOST case: `rotate_anchor_cap` consumes the retired cap, so with
/// nothing to consume it cannot help. Break-glass needs no old cap at all.
fun a_lost_cap_is_replaced_without_surrendering_anything() {
    let mut scenario = publish();
    break_glass(&mut scenario, OPERATOR, b"lost with the host");

    scenario.next_tx(OPERATOR);
    {
        let cap = scenario.take_from_sender<AnchorCap>();
        let registry = scenario.take_shared<CapRegistry>();
        assert_eq!(business_account::anchor_cap_generation(&cap), 1);
        assert_eq!(cap_registry::anchor_generation(&registry), 1);
        ts::return_shared(registry);
        scenario.return_to_sender(cap);
    };
    anchor_as(&mut scenario, OPERATOR);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 210, location = splash_core::cap_registry)]
/// The publisher's original cap dies when the operator's replacement is
/// minted. There is never a second live capability — which is the Phase 6
/// property this module had to preserve while fixing the two holes it left.
fun break_glass_leaves_exactly_one_live_capability() {
    let mut scenario = publish();
    anchor_as(&mut scenario, PUBLISHER);
    break_glass(&mut scenario, OPERATOR, b"handover");
    anchor_as(&mut scenario, PUBLISHER);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 210, location = splash_core::cap_registry)]
/// Generations do not wrap or forgive. A cap from two revocations ago is just
/// as dead as one from the last.
fun a_twice_superseded_cap_stays_dead() {
    let mut scenario = publish();
    break_glass(&mut scenario, OPERATOR, b"first");
    break_glass(&mut scenario, PUBLISHER, b"second");

    scenario.next_tx(OPERATOR);
    {
        let registry = scenario.take_shared<CapRegistry>();
        assert_eq!(cap_registry::anchor_generation(&registry), 2);
        ts::return_shared(registry);
    };
    anchor_as(&mut scenario, OPERATOR);
    scenario.end();
}

#[test]
/// Rotation is a custody move and revokes NOTHING. It carries the generation
/// rather than bumping it — bumping there would revoke a capability that is
/// already being consumed in the same call, which is noise in the event stream
/// and a needless generation gap.
fun rotation_moves_custody_without_revoking() {
    let mut scenario = publish();
    scenario.next_tx(PUBLISHER);
    {
        let admin = scenario.take_from_sender<AdminCap>();
        let retired = scenario.take_from_sender<AnchorCap>();
        let ctx = scenario.ctx();
        business_account::rotate_anchor_cap(&admin, retired, OPERATOR, ctx);
        scenario.return_to_sender(admin);
    };
    scenario.next_tx(OPERATOR);
    {
        let cap = scenario.take_from_sender<AnchorCap>();
        let registry = scenario.take_shared<CapRegistry>();
        assert_eq!(business_account::anchor_cap_generation(&cap), cap_registry::genesis());
        assert_eq!(cap_registry::anchor_generation(&registry), cap_registry::genesis());
        ts::return_shared(registry);
        scenario.return_to_sender(cap);
    };
    anchor_as(&mut scenario, OPERATOR);
    scenario.end();
}

// ─── The compliance capability ─────────────────────────────────────────────

fun with_compliance_config(scenario: &mut Scenario) {
    scenario.next_tx(PUBLISHER);
    let admin = scenario.take_from_sender<AdminCap>();
    let registry = scenario.take_shared<CapRegistry>();
    let ctx = scenario.ctx();
    compliance_config::create(
        &admin,
        &registry,
        DEVIATION,
        STALENESS,
        SLIPPAGE,
        DEPTH,
        FLOOR,
        vector[pool_a()],
        ctx,
    );
    ts::return_shared(registry);
    scenario.return_to_sender(admin);
}

#[test]
#[expected_failure(abort_code = 210, location = splash_core::cap_registry)]
/// A compliance key believed compromised could, until now, pause settlement as
/// often as it liked forever: `transfer_cap` is callable only BY ITS HOLDER, so
/// there was no way to take it back. Losing this cap bricks nothing — AdminCap
/// holds strictly larger versions of everything it does — so break-glass here
/// exists for revocation alone.
fun a_compromised_compliance_cap_can_be_taken_back() {
    let mut scenario = publish();
    with_compliance_config(&mut scenario);

    // It works first.
    scenario.next_tx(PUBLISHER);
    {
        let mut config = scenario.take_shared<ComplianceConfig>();
        let cap = scenario.take_from_sender<ComplianceCap>();
        let registry = scenario.take_shared<CapRegistry>();
        compliance_config::pause(&mut config, &cap, &registry);
        assert_eq!(compliance_config::paused(&config), true);
        ts::return_shared(registry);
        scenario.return_to_sender(cap);
        ts::return_shared(config);
    };

    scenario.next_tx(PUBLISHER);
    {
        let admin = scenario.take_from_sender<AdminCap>();
        let mut registry = scenario.take_shared<CapRegistry>();
        let config = scenario.take_shared<ComplianceConfig>();
        let ctx = scenario.ctx();
        compliance_config::break_glass_compliance_cap(
            &admin,
            &mut registry,
            &config,
            OPERATOR,
            b"suspected compromise",
            ctx,
        );
        ts::return_shared(config);
        ts::return_shared(registry);
        scenario.return_to_sender(admin);
    };

    // The old cap is dead. Note it is still bound to the right config and is
    // still a well-formed ComplianceCap — the generation is what kills it.
    scenario.next_tx(PUBLISHER);
    {
        let mut config = scenario.take_shared<ComplianceConfig>();
        let cap = scenario.take_from_sender<ComplianceCap>();
        let registry = scenario.take_shared<CapRegistry>();
        compliance_config::pause(&mut config, &cap, &registry);
        ts::return_shared(registry);
        scenario.return_to_sender(cap);
        ts::return_shared(config);
    };
    scenario.end();
}

#[test]
/// The replacement compliance cap is bound to the same config and works.
fun the_replacement_compliance_cap_works() {
    let mut scenario = publish();
    with_compliance_config(&mut scenario);

    scenario.next_tx(PUBLISHER);
    {
        let admin = scenario.take_from_sender<AdminCap>();
        let mut registry = scenario.take_shared<CapRegistry>();
        let config = scenario.take_shared<ComplianceConfig>();
        let ctx = scenario.ctx();
        compliance_config::break_glass_compliance_cap(
            &admin, &mut registry, &config, OPERATOR, b"rotation", ctx,
        );
        ts::return_shared(config);
        ts::return_shared(registry);
        scenario.return_to_sender(admin);
    };

    scenario.next_tx(OPERATOR);
    {
        let mut config = scenario.take_shared<ComplianceConfig>();
        let cap = scenario.take_from_sender<ComplianceCap>();
        let registry = scenario.take_shared<CapRegistry>();
        assert_eq!(compliance_config::compliance_cap_generation(&cap), 1);
        // Still subtractive: the new cap tightens and cannot loosen.
        compliance_config::tighten(
            &mut config, &cap, &registry, DEVIATION, STALENESS, SLIPPAGE - 100, DEPTH, FLOOR,
        );
        assert_eq!(compliance_config::max_slippage_bps(&config), SLIPPAGE - 100);
        ts::return_shared(registry);
        scenario.return_to_sender(cap);
        ts::return_shared(config);
    };
    scenario.end();
}

#[test]
/// The two generations are independent. Revoking the anchor cap must not
/// invalidate a compliance cap that nobody suspects.
fun the_two_generations_move_independently() {
    let mut scenario = publish();
    with_compliance_config(&mut scenario);
    break_glass(&mut scenario, OPERATOR, b"anchor only");

    scenario.next_tx(PUBLISHER);
    {
        let mut config = scenario.take_shared<ComplianceConfig>();
        let cap = scenario.take_from_sender<ComplianceCap>();
        let registry = scenario.take_shared<CapRegistry>();
        assert_eq!(cap_registry::anchor_generation(&registry), 1);
        assert_eq!(cap_registry::compliance_generation(&registry), 0);
        // Untouched, so it still works.
        compliance_config::pause(&mut config, &cap, &registry);
        assert_eq!(compliance_config::paused(&config), true);
        ts::return_shared(registry);
        scenario.return_to_sender(cap);
        ts::return_shared(config);
    };
    scenario.end();
}

// ─── The registry itself ───────────────────────────────────────────────────

#[test]
#[expected_failure(abort_code = 211, location = splash_core::cap_registry)]
/// The kind is a closed set. A registry that answers for kinds nobody declared
/// would silently approve a capability it knows nothing about.
fun an_unknown_capability_kind_is_refused() {
    let mut scenario = ts::begin(PUBLISHER);
    let ctx = scenario.ctx();
    let registry = cap_registry::new_for_testing(ctx);
    cap_registry::assert_current(&registry, 7, 0);
    cap_registry::share_for_testing(registry);
    scenario.end();
}

#[test]
fun is_current_answers_false_for_an_unknown_kind_rather_than_aborting() {
    let mut scenario = ts::begin(PUBLISHER);
    let ctx = scenario.ctx();
    let registry = cap_registry::new_for_testing(ctx);
    // The non-aborting reader is what off-chain callers poll with, so an
    // unknown kind must be a `false`, not a failed transaction.
    assert_eq!(cap_registry::is_current(&registry, 7, 0), false);
    assert_eq!(cap_registry::is_current(&registry, cap_registry::kind_anchor(), 0), true);
    assert_eq!(cap_registry::is_current(&registry, cap_registry::kind_anchor(), 1), false);
    cap_registry::share_for_testing(registry);
    scenario.end();
}

/// Shared settlement risk controls with a dedicated operator capability.
///
/// The capability pattern follows OpenZeppelin's Sui architecture guidance:
/// privileged authority is represented by an owned, unforgeable object while
/// the bounded configuration remains a shared object usable in PTBs.
module splash_protocol::compliance_config;

use splash_protocol::business_account::AdminCap;
use sui::event;

const MAX_DEVIATION_PPM: u64 = 10_000;
const MAX_STALENESS_MS: u64 = 600_000;
const MAX_SLIPPAGE_BPS: u64 = 1_000;

const E_INVALID_CONFIG: u64 = 350;
const E_INVALID_CAP: u64 = 351;
const E_SETTLEMENT_PAUSED: u64 = 352;

public struct ComplianceConfig has key {
    id: UID,
    max_deviation_ppm: u64,
    max_staleness_ms: u64,
    max_slippage_bps: u64,
    min_depth_base_units: u64,
    paused: bool,
}

public struct ComplianceCap has key {
    id: UID,
    config_id: ID,
}

public struct ComplianceConfigUpdated has copy, drop {
    config_id: address,
    max_deviation_ppm: u64,
    max_staleness_ms: u64,
    max_slippage_bps: u64,
    min_depth_base_units: u64,
    paused: bool,
}

/// Create the shared controls once after a fresh package publish.
public fun create(
    _admin: &AdminCap,
    max_deviation_ppm: u64,
    max_staleness_ms: u64,
    max_slippage_bps: u64,
    min_depth_base_units: u64,
    ctx: &mut TxContext,
) {
    assert_valid(max_deviation_ppm, max_staleness_ms, max_slippage_bps, min_depth_base_units);
    let config = ComplianceConfig {
        id: object::new(ctx),
        max_deviation_ppm,
        max_staleness_ms,
        max_slippage_bps,
        min_depth_base_units,
        paused: false,
    };
    let config_id = object::id(&config);
    let cap = ComplianceCap { id: object::new(ctx), config_id };
    transfer::share_object(config);
    transfer::transfer(cap, ctx.sender());
}

public fun update(
    config: &mut ComplianceConfig,
    cap: &ComplianceCap,
    max_deviation_ppm: u64,
    max_staleness_ms: u64,
    max_slippage_bps: u64,
    min_depth_base_units: u64,
) {
    assert!(cap.config_id == object::id(config), E_INVALID_CAP);
    assert_valid(max_deviation_ppm, max_staleness_ms, max_slippage_bps, min_depth_base_units);
    config.max_deviation_ppm = max_deviation_ppm;
    config.max_staleness_ms = max_staleness_ms;
    config.max_slippage_bps = max_slippage_bps;
    config.min_depth_base_units = min_depth_base_units;
    emit_update(config);
}

public fun set_paused(config: &mut ComplianceConfig, cap: &ComplianceCap, paused: bool) {
    assert!(cap.config_id == object::id(config), E_INVALID_CAP);
    config.paused = paused;
    emit_update(config);
}

public fun assert_active(config: &ComplianceConfig) {
    assert!(!config.paused, E_SETTLEMENT_PAUSED);
}

public fun max_deviation_ppm(config: &ComplianceConfig): u64 { config.max_deviation_ppm }
public fun max_staleness_ms(config: &ComplianceConfig): u64 { config.max_staleness_ms }
public fun max_slippage_bps(config: &ComplianceConfig): u64 { config.max_slippage_bps }
public fun min_depth_base_units(config: &ComplianceConfig): u64 { config.min_depth_base_units }
public fun paused(config: &ComplianceConfig): bool { config.paused }

fun assert_valid(
    max_deviation_ppm: u64,
    max_staleness_ms: u64,
    max_slippage_bps: u64,
    min_depth_base_units: u64,
) {
    assert!(max_deviation_ppm > 0 && max_deviation_ppm <= MAX_DEVIATION_PPM, E_INVALID_CONFIG);
    assert!(max_staleness_ms > 0 && max_staleness_ms <= MAX_STALENESS_MS, E_INVALID_CONFIG);
    assert!(max_slippage_bps > 0 && max_slippage_bps <= MAX_SLIPPAGE_BPS, E_INVALID_CONFIG);
    assert!(min_depth_base_units > 0, E_INVALID_CONFIG);
}

fun emit_update(config: &ComplianceConfig) {
    event::emit(ComplianceConfigUpdated {
        config_id: object::id_address(config),
        max_deviation_ppm: config.max_deviation_ppm,
        max_staleness_ms: config.max_staleness_ms,
        max_slippage_bps: config.max_slippage_bps,
        min_depth_base_units: config.min_depth_base_units,
        paused: config.paused,
    });
}

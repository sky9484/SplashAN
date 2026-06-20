/// Peg monitor — on-chain enforcement of stablecoin peg health.
///
/// `PegState` is a shared object updated periodically by the operator (off-chain
/// daemon reads Pyth Hermes and writes the freshest USDC/USDT deviations on
/// chain). Every settlement reads it and aborts the PTB if either deviation
/// exceeds 30 bps OR the state is older than `MAX_STALENESS_MS`.
///
/// Net effect: even if the off-chain authorize layer is bypassed (compromised
/// sponsor key, direct CLI call with a verified BusinessAccount, etc.), funds
/// cannot leave the settlement pool on a broken peg.
module splash_protocol::peg_monitor;

use splash_protocol::business_account::AdminCap;
use splash_protocol::compliance_config::{Self, ComplianceConfig};
use deepbook::pool::Pool;
use openzeppelin_math::rounding;
use openzeppelin_math::u64 as oz_u64;
use sui::clock::{Self, Clock};
use sui::event;

/// 30 bps = 0.30% = 3,000 ppm — matches what off-chain `lib/server/pyth.ts` uses.
const MAX_DEVIATION_PPM: u64 = 3_000;
const E_PEG_BROKEN_USDC:         u64 = 300;
const E_PEG_BROKEN_USDT:         u64 = 301;
const E_PEG_STALE:               u64 = 302;
const E_TIMESTAMP_REGRESSION:    u64 = 303;
const E_INSUFFICIENT_DEPTH:      u64 = 304;
const E_SLIPPAGE_EXCEEDED:       u64 = 305;
const E_INVALID_MARKET_PRICE:    u64 = 306;

const BPS_DENOMINATOR: u64 = 10_000;
const DEEPBOOK_PRICE_SCALING: u64 = 1_000_000_000;

public struct PegState has key {
    id: UID,
    /// |usdc_price - 1.0| × 1_000_000  (parts per million)
    usdc_deviation_ppm: u64,
    /// |usdt_price - 1.0| × 1_000_000
    usdt_deviation_ppm: u64,
    /// Clock timestamp_ms of the last update.
    last_update_ms: u64,
    /// Monotonic counter of updates pushed.
    update_count: u64,
}

public struct PegUpdated has copy, drop {
    state_id: address,
    sequence: u64,
    usdc_deviation_ppm: u64,
    usdt_deviation_ppm: u64,
    timestamp_ms: u64,
}

/// Bootstrap: admin creates the shared PegState. Call once after publish.
///
/// H-05 fix: initialize deviations *above* MAX_DEVIATION_PPM so any
/// `assert_pegged` call before the first real `update_peg` aborts with
/// `E_PEG_BROKEN_USDC`. Previously this struct was initialized with
/// deviation=0 + a fresh timestamp, which let settlements proceed against
/// zero peg data for up to 60 seconds before the operator daemon had ever
/// pushed a real Pyth reading. Now: the operator MUST push at least one
/// real reading before settlements can fire.
public fun init_peg_state(_admin: &AdminCap, clock: &Clock, ctx: &mut TxContext) {
    let state = PegState {
        id: object::new(ctx),
        // One ppm above the max — fails `assert_pegged` until first real update.
        usdc_deviation_ppm: MAX_DEVIATION_PPM + 1,
        usdt_deviation_ppm: MAX_DEVIATION_PPM + 1,
        last_update_ms: clock::timestamp_ms(clock),
        update_count: 0,
    };
    transfer::share_object(state);
}

/// Operator pushes a fresh Hermes-derived peg reading. AdminCap-gated.
///
/// L-06 fix: assert the new timestamp is strictly newer than the stored
/// one (allowing equality on the first update from genesis) to guard
/// against clock regression bugs or replay-style races.
public fun update_peg(
    state: &mut PegState,
    _admin: &AdminCap,
    usdc_deviation_ppm: u64,
    usdt_deviation_ppm: u64,
    clock: &Clock,
    _ctx: &mut TxContext,
) {
    let now = clock::timestamp_ms(clock);
    // First update from genesis (update_count == 0) is allowed to equal
    // the init timestamp; subsequent updates must strictly advance.
    if (state.update_count > 0) {
        assert!(now > state.last_update_ms, E_TIMESTAMP_REGRESSION);
    };

    state.usdc_deviation_ppm = usdc_deviation_ppm;
    state.usdt_deviation_ppm = usdt_deviation_ppm;
    state.last_update_ms = now;
    state.update_count = state.update_count + 1;

    event::emit(PegUpdated {
        state_id: object::id_address(state),
        sequence: state.update_count,
        usdc_deviation_ppm,
        usdt_deviation_ppm,
        timestamp_ms: now,
    });
}

/// Hot-path check called from settle_payment / settle_batch.
/// Aborts the PTB if peg is broken OR state is stale.
public fun assert_pegged(state: &PegState, config: &ComplianceConfig, clock: &Clock) {
    compliance_config::assert_active(config);
    let now = clock::timestamp_ms(clock);
    let age = if (now > state.last_update_ms) { now - state.last_update_ms } else { 0 };
    assert!(age <= compliance_config::max_staleness_ms(config), E_PEG_STALE);
    assert!(state.usdc_deviation_ppm <= compliance_config::max_deviation_ppm(config), E_PEG_BROKEN_USDC);
    assert!(state.usdt_deviation_ppm <= compliance_config::max_deviation_ppm(config), E_PEG_BROKEN_USDT);
}

/// Independent execution guard. Pyth establishes stablecoin peg truth above;
/// DeepBook only proves that this exact settlement amount can clear inside the
/// configured depth and price-impact limits.
public fun assert_deepbook_liquidity<BaseAsset, QuoteAsset>(
    config: &ComplianceConfig,
    pool: &Pool<BaseAsset, QuoteAsset>,
    base_quantity: u64,
    clock: &Clock,
) {
    let (remaining_base, quote_out, _) = pool.get_quote_quantity_out_input_fee(base_quantity, clock);
    assert!(remaining_base == 0 && quote_out > 0, E_INSUFFICIENT_DEPTH);

    let mid_price = pool.mid_price(clock);
    assert!(mid_price > 0, E_INVALID_MARKET_PRICE);
    let effective_price = mul_div_down(quote_out, DEEPBOOK_PRICE_SCALING, base_quantity);
    let slippage_bps = if (effective_price >= mid_price) {
        0
    } else {
        mul_div_down(mid_price - effective_price, BPS_DENOMINATOR, mid_price)
    };
    assert!(slippage_bps <= compliance_config::max_slippage_bps(config), E_SLIPPAGE_EXCEEDED);

    let price_floor = mul_div_down(
        mid_price,
        BPS_DENOMINATOR - compliance_config::max_slippage_bps(config),
        BPS_DENOMINATOR,
    );
    let (_, quantities) = pool.get_level2_range(price_floor, mid_price, true, clock);
    let depth = quantities.fold!(0, |sum, quantity| sum + quantity);
    assert!(depth >= compliance_config::min_depth_base_units(config), E_INSUFFICIENT_DEPTH);
    assert!(depth >= base_quantity, E_INSUFFICIENT_DEPTH);
}

fun mul_div_down(a: u64, b: u64, denominator: u64): u64 {
    oz_u64::mul_div(a, b, denominator, rounding::down()).destroy_some()
}

// ── views ────────────────────────────────────────────────────────────────
public fun usdc_deviation_ppm(state: &PegState): u64 { state.usdc_deviation_ppm }
public fun usdt_deviation_ppm(state: &PegState): u64 { state.usdt_deviation_ppm }
public fun last_update_ms(state: &PegState):    u64 { state.last_update_ms }
public fun update_count(state: &PegState):      u64 { state.update_count }

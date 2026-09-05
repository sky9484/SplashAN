/// DailyLimit — a 24-hour velocity ceiling on one business account's payouts.
///
/// AUDIT A-11, at the account level. `splash_meter::spend_meter` bounds what the
/// PROTOCOL can move out of pooled custody; this bounds what a single tenant can
/// move in a day. Different object, different lifecycle, different threat: the
/// meter contains a compromised operator key, this contains a compromised
/// tenant key and gives a stolen approver credential a ceiling.
///
/// ─── Why this is not `splash_meter` ─────────────────────────────────────────
///
/// The arithmetic below is deliberately the same shape as `spend_meter`'s, and
/// the obvious move is to depend on it rather than restate it. That is the
/// wrong trade here, for one reason: `splash_meter` publishes UPGRADEABLE under
/// the cold multisig, and `splash_core` burns its `UpgradeCap`. A dependency
/// would make core's payout ceiling mutable through someone else's upgrade,
/// which is exactly the property core exists not to have. `splash_core` also
/// keeps a dependency surface of the Sui framework and nothing else, on the
/// Cetus reasoning in `Move.toml`.
///
/// ─── The window ─────────────────────────────────────────────────────────────
///
/// Twenty-four hourly buckets in a ring, rolled forward lazily by the spender's
/// own transaction. Sui has no cron, so nothing can be scheduled to reset a
/// counter, and any design needing one silently stops working when nobody calls
/// it.
///
/// Buckets rather than a `(window_start, spent)` pair because a TUMBLING window
/// with lazy reset is trivially defeated: spend the ceiling at `t = end - 1ms`
/// and again at `t = end + 1ms` for 2x the advertised cap in two blocks.
/// Twenty-four buckets make it genuinely sliding at one-hour granularity, so
/// that trick buys at most one bucket of slack.
module splash_core::daily_limit;

use sui::clock::{Self, Clock};

// ─── Abort codes (600-block, reserved for daily_limit) ──────────────────────
const E_ZERO_AMOUNT: u64 = 600;
/// The payout would push this account past its 24h ceiling.
const E_CAP_EXCEEDED: u64 = 601;
const E_INVALID_CAP: u64 = 602;

// ─── Window shape: CONSTANTS, not parameters ────────────────────────────────
// A configurable window is a configurable bypass. "How long is a day here?"
// should be answerable by reading this file, not a shared object's state.
const BUCKETS: u64 = 24;
const BUCKET_MS: u64 = 3_600_000;
const WINDOW_MS: u64 = 86_400_000;

/// Deliberately NOT `drop`. A limit must be explicitly destroyed, so removing
/// one from an account is a visible edit rather than a silent omission.
public struct DailyLimit has store {
    buckets: vector<u64>,
    head: u64,
    head_start_ms: u64,
    /// Ceiling in the settled coin's MINOR UNITS — the same unit as
    /// `PaymentIntent.amount_usd` and `ComplianceConfig.min_settlement_amount`.
    /// Never a whole-currency figure: a cap of `1000` on a 6-decimal coin is a
    /// tenth of a cent, which reads like a limit and is a brick.
    cap_minor: u64,
}

public fun new(cap_minor: u64, clock: &Clock): DailyLimit {
    assert!(cap_minor > 0, E_INVALID_CAP);

    let mut buckets = vector<u64>[];
    let mut i = 0;
    while (i < BUCKETS) {
        buckets.push_back(0);
        i = i + 1;
    };

    DailyLimit {
        buckets,
        head: 0,
        head_start_ms: bucket_start(clock::timestamp_ms(clock)),
        cap_minor,
    }
}

public fun destroy(limit: DailyLimit) {
    let DailyLimit { buckets: _, head: _, head_start_ms: _, cap_minor: _ } = limit;
}

fun bucket_start(now_ms: u64): u64 {
    now_ms - (now_ms % BUCKET_MS)
}

/// Advance the window to `now`, zeroing buckets that have aged out.
///
/// Gas is bounded at `BUCKETS` writes worst case, and a full turnover
/// short-circuits: an account untouched for a month costs the same as one
/// untouched for a day.
fun roll_forward(limit: &mut DailyLimit, now_ms: u64) {
    let now_start = bucket_start(now_ms);
    // A clock that reads BACKWARDS (or an unchanged bucket) must not rewind the
    // window — that would resurrect spend that has already aged out.
    if (now_start <= limit.head_start_ms) return;

    let elapsed = (now_start - limit.head_start_ms) / BUCKET_MS;
    if (elapsed >= BUCKETS) {
        let mut i = 0;
        while (i < BUCKETS) {
            *limit.buckets.borrow_mut(i) = 0;
            i = i + 1;
        };
        limit.head = 0;
    } else {
        let mut step = 0;
        while (step < elapsed) {
            limit.head = (limit.head + 1) % BUCKETS;
            *limit.buckets.borrow_mut(limit.head) = 0;
            step = step + 1;
        };
    };
    limit.head_start_ms = now_start;
}

fun total(limit: &DailyLimit): u64 {
    let mut sum = 0;
    let mut i = 0;
    while (i < BUCKETS) {
        sum = sum + *limit.buckets.borrow(i);
        i = i + 1;
    };
    sum
}

/// Charge `amount` against the window, or abort.
///
/// `public(package)` rather than `public`: the only holder of a `&mut
/// DailyLimit` is `business_account`, which owns the field, and nothing outside
/// this package has any business burning a tenant's window. (`spend_meter` had
/// to be `public` because its consumer is a different package; this one does
/// not, so it is not.)
public(package) fun charge(limit: &mut DailyLimit, amount: u64, clock: &Clock) {
    assert!(amount > 0, E_ZERO_AMOUNT);

    let now = clock::timestamp_ms(clock);
    roll_forward(limit, now);

    let spent = total(limit);
    // Written as a subtraction, not `spent + amount <= cap`, so a large amount
    // cannot overflow u64 before the comparison happens.
    assert!(amount <= limit.cap_minor - spent, E_CAP_EXCEEDED);

    let head = limit.head;
    *limit.buckets.borrow_mut(head) = *limit.buckets.borrow(head) + amount;
}

/// Replace the ceiling. Takes effect immediately in both directions.
///
/// Note what this deliberately does NOT do: it does not clear the window.
/// Raising the cap does not forgive spend already made inside the last 24
/// hours, so "raise, drain, lower" moves no more than "raise and drain" would.
public(package) fun set_cap(limit: &mut DailyLimit, cap_minor: u64) {
    assert!(cap_minor > 0, E_INVALID_CAP);
    limit.cap_minor = cap_minor;
}

// ─── Views ─────────────────────────────────────────────────────────────────

public fun cap_minor(limit: &DailyLimit): u64 { limit.cap_minor }

/// Spend inside the trailing 24h AS OF `clock`, without mutating.
///
/// Recomputed rather than read off the stored buckets: a stored total is stale
/// the moment an hour passes, and a view that overstates spend would have
/// off-chain callers refusing payments the chain would accept.
public fun spent(limit: &DailyLimit, clock: &Clock): u64 {
    let now_start = bucket_start(clock::timestamp_ms(clock));
    if (now_start <= limit.head_start_ms) return total(limit);

    let elapsed = (now_start - limit.head_start_ms) / BUCKET_MS;
    if (elapsed >= BUCKETS) return 0;

    // Sum only the buckets that survive the roll. `roll_forward` advances the
    // head `elapsed` times and zeroes each bucket it lands on, and those are
    // the `elapsed` OLDEST — so what survives is the newest
    // `BUCKETS - elapsed`, counted BACKWARDS from the head.
    //
    // Counting backwards is the whole point. `spend_meter::remaining_at`
    // counts forwards from the head, which wraps onto the buckets the roll is
    // about to zero and skips the same number of live ones (see the fix and
    // its regression test in that package).
    let mut sum = 0;
    let mut j = 0;
    while (j < BUCKETS - elapsed) {
        let idx = (limit.head + BUCKETS - j) % BUCKETS;
        sum = sum + *limit.buckets.borrow(idx);
        j = j + 1;
    };
    sum
}

public fun remaining(limit: &DailyLimit, clock: &Clock): u64 {
    let used = spent(limit, clock);
    if (used >= limit.cap_minor) 0 else limit.cap_minor - used
}

public fun window_ms(): u64 { WINDOW_MS }
public fun buckets(): u64 { BUCKETS }
public fun bucket_ms(): u64 { BUCKET_MS }

#[test_only]
public fun charge_for_testing(limit: &mut DailyLimit, amount: u64, clock: &Clock) {
    charge(limit, amount, clock)
}

#[test_only]
public fun set_cap_for_testing(limit: &mut DailyLimit, cap_minor: u64) {
    set_cap(limit, cap_minor)
}

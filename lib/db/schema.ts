import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * W1 — persistence & state: the single relational source of truth.
 *
 * Rules (from the mainnet readiness prompt):
 * - Every money column is BIGINT MINOR UNITS plus a currency code — never
 *   numeric/float. Display formatting happens at the edge, never here.
 * - Every table carries created_at/updated_at.
 * - FX rates are `numeric` (exact decimal, surfaces as string in JS) — a
 *   rate is a ratio, not money.
 * - Redis stays cache/rate-limit only; nothing here ever lives only there.
 *
 * Host: DigitalOcean Managed PostgreSQL (0xSky decision 2026-07-18) —
 * daily backups + PITR come with the managed cluster; see docs/W1-BACKUPS.md.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const userRole = pgEnum('user_role', ['maker', 'checker', 'admin', 'viewer']);
export const kybStatus = pgEnum('kyb_status', ['none', 'pending', 'basic', 'full', 'rejected']);
export const intentState = pgEnum('intent_state', [
  'AUTHORIZED', 'DEPOSIT_CONFIRMED', 'EXCHANGING', 'EXCHANGED', 'QUEUED', 'SETTLING', 'SETTLED',
  'SWEEPING', 'DISBURSED', 'CREDITED', 'FAILED', 'REFUNDING', 'REFUNDED', 'OPS_HOLD', 'COMPLIANCE_HOLD',
]);
/** Individual or business. FATF R.16 requires different identifying data for each. */
export const beneficiaryType = pgEnum('beneficiary_type', ['INDIVIDUAL', 'BUSINESS']);

/**
 * The identifier a corridor's banking system actually routes on.
 *
 * Not cosmetic: PH clears on a bank code through PESONet/InstaPay, the EU and
 * UK on IBAN, GB domestic on sort code, and most of ASEAN on SWIFT plus a
 * local account number. A beneficiary row that stores only "account number"
 * cannot be paid in most of these corridors, which is the state this replaces.
 */
export const bankIdScheme = pgEnum('bank_id_scheme', [
  'SWIFT_BIC',
  'IBAN',
  'LOCAL_BANK_CODE',
  'GB_SORT_CODE',
  'US_ROUTING_ABA',
  'AU_BSB',
  'IN_IFSC',
  'PROXY_ID',
]);

export const screeningVerdict = pgEnum('screening_verdict', ['CLEAR', 'REVIEW', 'BLOCK', 'ERROR']);
export const webhookStatus = pgEnum('webhook_status', ['RECEIVED', 'PROCESSED', 'FAILED', 'SKIPPED']);

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  kybStatus: kybStatus('kyb_status').notNull().default('none'),
  kybTier: text('kyb_tier'),
  /** Wallet spec §3 — the accountable onboarding lifecycle:
   *  REGISTERED → KYB_SUBMITTED → KYB_PROVIDER_APPROVED → KYB_ADMIN_APPROVED →
   *  ACTIVE, plus REJECTED / SUSPENDED. Money movement unlocks only at ACTIVE.
   *
   *  Text, not a pgEnum, deliberately: lib/compliance/kyb-state.ts is the
   *  authority on legal transitions (same rationale as proposals.status), and a
   *  text column means adding a state is a code change, not an ALTER TYPE
   *  migration. The coarse `kyb_status` enum above is left untouched. */
  kybLifecycle: text('kyb_lifecycle').notNull().default('REGISTERED'),
  /** Wallet spec §2.3 — the org's on-chain BusinessAccount object id. Null
   *  until the AdminCap-gated business_account::verify_business has run. */
  suiBusinessAccountId: text('sui_business_account_id'),
  ...timestamps,
});

/**
 * A person. Identity only.
 *
 * This table used to carry `org_id` and `role` directly, which made every row
 * simultaneously an identity and a membership — so a user could not exist
 * without belonging to an organisation with a role. That is what made the auth
 * bypass structural rather than a slip: signup needed a row, a row needed a
 * role, and the role it got was one that can approve payments.
 *
 * Membership is its own table now. A user with no membership row is exactly
 * what signup produces: able to log in, able to see an empty workspace, and
 * able to authorise nothing.
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  /**
   * scrypt, formatted by lib/auth/password.ts. Nullable because an identity
   * can exist without one — an invited user before they set a password, or a
   * zkLogin identity that never has one at all.
   */
  passwordHash: text('password_hash'),
  /** Null until the address is proven. Not a boolean: when it happened is the
   *  auditable fact, and `true` cannot answer that. */
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex('users_email_unique').on(table.email),
]);

/**
 * Who belongs to which organisation, and as what.
 *
 * There is deliberately no default role. Drizzle would accept
 * `.default('viewer')` and the previous schema did exactly that, which means
 * an insert that forgets the role still produces a member. Every membership
 * here states its role, or the insert fails.
 *
 * A row in this table is a grant. Nothing creates one implicitly: not signup,
 * not login, and not a failed authority lookup.
 */
export const memberships = pgTable('memberships', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgId: text('org_id').notNull().references(() => organizations.id),
  role: userRole('role').notNull(),
  /** Who granted it. Null for the first membership in a new organisation,
   *  which has no prior member to do the granting. */
  grantedBy: text('granted_by'),
  ...timestamps,
}, (table) => [
  uniqueIndex('memberships_user_org_unique').on(table.userId, table.orgId),
  index('memberships_org_idx').on(table.orgId),
  index('memberships_user_idx').on(table.userId),
]);

/**
 * Failed login attempts, for the rate limit.
 *
 * Postgres rather than Redis: Redis is cache-only here by rule, and a lockout
 * that evaporates when the cache restarts is not a lockout. Rows are pruned by
 * the limiter as it reads them, so the table stays small without a separate
 * job.
 */
export const loginAttempts = pgTable('login_attempts', {
  id: text('id').primaryKey(),
  /** Lowercased email as submitted. Scopes the per-email limit; it is a login
   *  identifier, not proof anyone owns the address. */
  email: text('email').notNull(),
  ip: text('ip').notNull(),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('login_attempts_email_idx').on(table.email, table.attemptedAt),
  index('login_attempts_ip_idx').on(table.ip, table.attemptedAt),
]);

/**
 * Enrolled passkey credentials — SIP-9 secp256r1 signers.
 *
 * The public key column is the reason this table exists, and it is the single
 * most important detail in the passkey design.
 *
 * WebAuthn returns a credential's public key exactly once, in the attestation
 * at creation. A later assertion — an actual signature — returns the signature
 * and the credential id, and no key. So a server that did not store the key at
 * enrolment cannot identify which Sui address just signed. The SDK's own
 * workaround for that situation is `PasskeyKeypair.signAndRecover` plus
 * `findCommonPublicKey`: sign two different messages, recover the candidate
 * keys from each, and intersect them. That is two extra user gestures and a
 * guess, on the approval path, to recover something we were handed for free
 * once and threw away.
 *
 * So: persist it at enrolment, and never need recovery.
 *
 * `sui_address` is derived from the public key at enrolment and stored beside
 * it. It is not a cache — it is what an approval is checked against, and
 * recomputing it per request would mean the check depends on the derivation
 * being stable forever rather than on a value we committed to.
 *
 * One credential per origin per user. A person may hold a passkey for
 * localhost and another for the production host — those are different
 * credentials at the WebAuthn level and cannot be interchanged — but not two
 * for the same origin, because then "which key approved this" has more than
 * one answer.
 */
export const passkeyCredentials = pgTable('passkey_credentials', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** WebAuthn credential id, base64url. Returned on every assertion, so it is
   *  how an incoming signature is matched to a stored key. */
  credentialId: text('credential_id').notNull(),
  /** 33-byte compressed secp256r1 point, base64. Captured at creation because
   *  the authenticator will never send it again. */
  publicKey: text('public_key').notNull(),
  /** Derived from the public key at enrolment, with the SIP-9 0x06 flag. The
   *  address an approval's sender must equal. */
  suiAddress: text('sui_address').notNull(),
  /**
   * The WebAuthn relying-party id this credential is bound to.
   *
   * A credential enrolled on `localhost` cannot be used on `v1.splashz.xyz`:
   * the browser scopes it to the rpId and simply will not offer it elsewhere.
   * Storing it makes that visible — a credential that cannot be used on the
   * current host is a row we can explain rather than a silent absence.
   */
  rpId: text('rp_id').notNull(),
  /** Set when the credential is retired. Revocation is a tombstone, not a
   *  delete: an approval already anchored on chain names this credential, and
   *  removing the row would orphan that evidence. */
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex('passkey_credentials_credential_unique').on(table.credentialId),
  /* One ACTIVE credential per origin, not one row ever. An unconditional
     unique index would let a revoked row occupy the origin permanently, so
     revoking would lock the user out of re-enrolling — the opposite of what a
     tombstone is for. Postgres partial index: the constraint applies only
     where revoked_at IS NULL. */
  uniqueIndex('passkey_credentials_active_user_rp_unique')
    .on(table.userId, table.rpId)
    .where(sql`${table.revokedAt} is null`),
  index('passkey_credentials_address_idx').on(table.suiAddress),
]);

/**
 * Wallet spec §2.3 — per-human zkLogin signer ↔ record mapping.
 *
 * One org has ONE on-chain BusinessAccount but MANY individual signers: a
 * zkLogin address is derived from (iss, sub, aud, salt), so `ceo@acme.com` and
 * `controller@acme.com` get different Sui addresses. That is what gives
 * maker-checker per-human signer attribution.
 *
 * `oauth_sub` is a provider user id — treat it as PII: never log it raw.
 */
export const walletIdentities = pgTable('wallet_identities', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  orgId: text('org_id').notNull().references(() => organizations.id),
  /** Derived from sub/iss/aud/salt — the address that signs this human's intents. */
  suiAddress: text('sui_address').notNull(),
  oauthIss: text('oauth_iss').notNull(),
  oauthSub: text('oauth_sub').notNull(),
  /** Our OAuth client id for THIS environment — a separate client per env is
   *  both a Mysten best practice and an IACR 2026/227 mitigation. */
  oauthAud: text('oauth_aud').notNull(),
  emailAtLogin: text('email_at_login'),
  ...timestamps,
}, (table) => [
  uniqueIndex('wallet_identities_sui_address_unique').on(table.suiAddress),
  // One address per identity per app — the cross-app impersonation guard.
  uniqueIndex('wallet_identities_oauth_subject_unique').on(table.oauthIss, table.oauthSub, table.oauthAud),
  index('wallet_identities_user_idx').on(table.userId),
  index('wallet_identities_org_idx').on(table.orgId),
]);

/** Suppliers — the relationship-first noun (today's "recipients"). */
/**
 * A beneficiary — the party who receives money.
 *
 * Until now this held a name, a country, a bank name, an optional SWIFT and an
 * account reference. That is enough to display a row and not enough to pay
 * anyone: a regulated cross-border payout needs the beneficiary's legal
 * identity and address, the bank's routing identifier for that specific
 * corridor, and — at the point of payment — a stated purpose and source of
 * funds. Partners ask for all of it during onboarding, and FATF
 * Recommendation 16 (the travel rule) requires the originator and beneficiary
 * data to travel WITH the transfer, not sit in a file somewhere.
 *
 * The split is deliberate: identity and bank routing are properties of the
 * BENEFICIARY and live here; purpose of payment, source of funds and the
 * relationship are properties of a PAYMENT and live on `payment_intents`,
 * because the same supplier can be paid for different reasons.
 *
 * Columns are nullable because an existing row predates them and because the
 * required set differs by corridor. What is required is enforced in
 * `lib/compliance/travel-rule.ts` per destination country, at the point the
 * payment is authorized — not by the column definition, which cannot know the
 * corridor.
 */
export const suppliers = pgTable('suppliers', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  country: text('country').notNull(),
  bankName: text('bank_name'),
  swift: text('swift'),
  accountRef: text('account_ref'),
  kybStatus: kybStatus('kyb_status').notNull().default('none'),
  /** Set when the counterparty claims a Splash account ("On Splash"). */
  claimedAt: timestamp('claimed_at', { withTimezone: true }),

  // ── Legal identity (FATF R.16 beneficiary data) ──────────────────────────
  /** INDIVIDUAL or BUSINESS. Decides which identity fields are required. */
  beneficiaryType: beneficiaryType('beneficiary_type'),
  /** Registered legal name, when it differs from the trading name in `name`. */
  legalName: text('legal_name'),
  /** Company registration number (BUSINESS) — SSM, UEN, DTI, NPWP and so on. */
  registrationNumber: text('registration_number'),
  /** Date of birth, ISO date (INDIVIDUAL). One of the R.16 identifiers. */
  dateOfBirth: text('date_of_birth'),
  /** National identity document number (INDIVIDUAL), where the corridor asks. */
  nationalIdNumber: text('national_id_number'),

  // ── Address. R.16 accepts an address as the originator identifier and most
  //    SEA partners require the beneficiary's too. ISO 3166-1 alpha-2 country.
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  addressCity: text('address_city'),
  addressState: text('address_state'),
  addressPostalCode: text('address_postal_code'),
  addressCountry: text('address_country'),

  // ── Bank routing ─────────────────────────────────────────────────────────
  /** Which identifier the destination banking system routes on. */
  bankIdScheme: bankIdScheme('bank_id_scheme'),
  /** The value for `bankIdScheme` — a BIC, an IBAN, a local bank code, a sort code. */
  bankIdValue: text('bank_id_value'),
  /** Branch code, where the corridor separates it from the bank code (SG, TH). */
  bankBranchCode: text('bank_branch_code'),
  /** ISO 3166-1 alpha-2 of the BANK, which is not always the beneficiary's. */
  bankCountry: text('bank_country'),
  /** Local account number, when the scheme is not itself the account (IBAN is). */
  bankAccountNumber: text('bank_account_number'),
  /** Account holder name exactly as the bank has it, for name-matching checks. */
  bankAccountName: text('bank_account_name'),

  // ── KYT / screening, the last result for this beneficiary ────────────────
  screeningVerdict: screeningVerdict('screening_verdict'),
  screenedAt: timestamp('screened_at', { withTimezone: true }),
  /** Provider's reference, so a verdict can be re-fetched and audited. */
  screeningReference: text('screening_reference'),

  // ── Operational record ───────────────────────────────────────────────────
  /** PAYOUT_ONLY, SWEEP_ACCOUNT or STORED_BALANCE — read on the settlement path. */
  tier: text('tier'),
  /** Venue, destination bank and account, delay. One object, queried by nobody. */
  sweepConfig: jsonb('sweep_config'),
  demo: boolean('demo').notNull().default(false),
  /** Contact email for the KYB invite, whether one was sent, and whether this
   *  beneficiary was typed in or created by an invoice link. */
  recipientMetadata: jsonb('recipient_metadata'),

  ...timestamps,
}, (table) => [
  index('suppliers_org_idx').on(table.orgId),
  index('suppliers_org_created_idx').on(table.orgId, table.createdAt),
  index('suppliers_screening_idx').on(table.screeningVerdict),
]);

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  supplierId: text('supplier_id').references(() => suppliers.id),
  issuerOrg: text('issuer_org').notNull(),
  payerName: text('payer_name'),
  payerEmail: text('payer_email'),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(),
  targetCurrency: text('target_currency').notNull(),
  dueDate: text('due_date'),
  status: text('status').notNull().default('draft'),
  memo: text('memo'),
  walrusBlobId: text('walrus_blob_id'),
  sealPolicyId: text('seal_policy_id'),
  payLinkSlug: text('pay_link_slug'),
  ...timestamps,
}, (table) => [
  index('invoices_org_idx').on(table.orgId),
  index('invoices_supplier_idx').on(table.supplierId),
  uniqueIndex('invoices_pay_link_unique').on(table.payLinkSlug),
]);

export const paymentIntents = pgTable('payment_intents', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  supplierId: text('supplier_id').references(() => suppliers.id),
  invoiceId: text('invoice_id').references(() => invoices.id),
  state: intentState('state').notNull(),
  sourceAmountMinor: bigint('source_amount_minor', { mode: 'bigint' }).notNull(),
  sourceCurrency: text('source_currency').notNull(),
  targetAmountMinor: bigint('target_amount_minor', { mode: 'bigint' }).notNull(),
  targetCurrency: text('target_currency').notNull(),
  feeMinor: bigint('fee_minor', { mode: 'bigint' }),
  /** Exact decimal ratio (not money) — string in JS. */
  exchangeRate: numeric('exchange_rate'),
  quoteId: text('quote_id'),
  quoteExpiresAt: timestamp('quote_expires_at', { withTimezone: true }),
  fundingSessionId: text('funding_session_id'),
  fundingMethod: text('funding_method'),
  fundingProvider: text('funding_provider'),
  suiTxDigest: text('sui_tx_digest'),
  receiptObjectId: text('receipt_object_id'),
  walrusBlobId: text('walrus_blob_id'),
  auditAnchorId: text('audit_anchor_id'),
  failureReason: text('failure_reason'),
  failedAtState: text('failed_at_state'),
  demo: boolean('demo').notNull().default(false),
  idempotencyKey: text('idempotency_key'),

  // ── Travel-rule context that belongs to the PAYMENT, not the beneficiary ──
  /** Purpose-of-payment code. BNM, BSP and BI all require one on inbound wires. */
  purposeCode: text('purpose_code'),
  /** Free-text purpose, shown to the partner alongside the code. */
  purposeDescription: text('purpose_description'),
  /** Where the money came from — required above threshold in most corridors. */
  sourceOfFunds: text('source_of_funds'),
  /** Payer's relationship to the beneficiary (supplier, employee, intragroup). */
  beneficiaryRelationship: text('beneficiary_relationship'),
  /**
   * The originator and beneficiary data as transmitted, frozen at authorization.
   *
   * A snapshot, not a join: R.16 is about what travelled WITH the payment, and
   * a beneficiary edited next week must not change what this payment carried.
   */
  travelRuleSnapshot: jsonb('travel_rule_snapshot'),

  // ── Settlement detail ────────────────────────────────────────────────────
  /** The beneficiary as the operator typed it, before it resolves to a supplier. */
  recipientName: text('recipient_name'),
  /** PAYOUT_ONLY, SWEEP_ACCOUNT or STORED_BALANCE — read on the settlement path. */
  deliveryTier: text('delivery_tier'),
  /**
   * The rest of one settlement's own detail: stablecoin and rail chosen, DAX
   * tier, peg-check verdict, Seal policy id, the composed on-chain actions.
   *
   * One jsonb rather than twenty sparse columns because these are attributes of
   * a single settlement, not dimensions anyone queries across. Anything that
   * later needs an index earns a column of its own.
   */
  settlementMetadata: jsonb('settlement_metadata'),

  ...timestamps,
}, (table) => [
  index('intents_org_idx').on(table.orgId),
  index('intents_org_created_idx').on(table.orgId, table.createdAt),
  index('intents_supplier_idx').on(table.supplierId),
  index('intents_state_idx').on(table.state),
  /** Scoped to the org, like `proposals_idempotency_unique` already is.
   *  Unscoped, the first tenant to use "payroll-friday" would block every
   *  other tenant from that key forever — a cross-tenant denial of service
   *  through a field the client chooses. */
  uniqueIndex('intents_idempotency_unique').on(table.orgId, table.idempotencyKey),
]);

/** Lifecycle audit trail — one row per state transition (statusHistory). */
export const intentTransitions = pgTable('intent_transitions', {
  id: text('id').primaryKey(),
  intentId: text('intent_id').notNull().references(() => paymentIntents.id),
  fromState: text('from_state'),
  toState: text('to_state').notNull(),
  /** Why. FAILED without one sends an operator to a restarted process's logs. */
  reason: text('reason'),
  actor: text('actor'),
  ...timestamps,
}, (table) => [index('transitions_intent_idx').on(table.intentId)]);

/** Track A — server-owned policy record. Thresholds are BIGINT USD micro
 *  units; the client can never supply any of these. */
export const orgPolicies = pgTable('org_policies', {
  orgId: text('org_id').primaryKey().references(() => organizations.id),
  tier1ThresholdUsdMicro: bigint('tier1_threshold_usd_micro', { mode: 'bigint' }).notNull(),
  dualApprovalThresholdUsdMicro: bigint('dual_approval_threshold_usd_micro', { mode: 'bigint' }).notNull(),
  whitelistedAutoKinds: jsonb('whitelisted_auto_kinds').notNull(),
  operatingMinimumByCorridor: jsonb('operating_minimum_by_corridor').notNull(),
  perCorridorState: jsonb('per_corridor_state').notNull(),
  globalState: text('global_state').notNull().default('ARMED'),
  ...timestamps,
});

export const proposals = pgTable('proposals', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  idempotencyKey: text('idempotency_key').notNull(),
  kind: text('kind').notNull(),
  /** Text, not enum: the agent lifecycle (DRAFTED…ANCHORED/REVERSED) is the
   *  authority (lib/queue/proposal-state.ts); freeze to an enum post-W6. */
  status: text('status').notNull(),
  tier: text('tier').notNull(),
  corridor: text('corridor'),
  createdBy: text('created_by').notNull(),
  unsignedTxBytes: text('unsigned_tx_bytes'),
  explain: jsonb('explain').notNull(),
  simulation: jsonb('simulation'),
  settlement: jsonb('settlement'),
  requiredApprovers: bigint('required_approvers', { mode: 'number' }).notNull().default(1),
  /** Track A §1.4 — canon versioning: any mutation to a canon field bumps the
   *  version, recomputes approval_hash, and voids all prior approvals. */
  version: bigint('version', { mode: 'number' }).notNull().default(1),
  approvalHash: text('approval_hash'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [
  index('proposals_org_idx').on(table.orgId),
  index('proposals_status_idx').on(table.status),
  uniqueIndex('proposals_idempotency_unique').on(table.orgId, table.idempotencyKey),
]);

export const approvals = pgTable('approvals', {
  id: text('id').primaryKey(),
  proposalId: text('proposal_id').notNull().references(() => proposals.id),
  userId: text('user_id').notNull(),
  role: text('role').notNull(),
  signatureRef: text('signature_ref'),
  signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex('approvals_one_per_user').on(table.proposalId, table.userId),
]);

export const fundingEvents = pgTable('funding_events', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  sessionId: text('session_id').notNull(),
  provider: text('provider').notNull(),
  method: text('method').notNull(),
  status: text('status').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(),
  providerReference: text('provider_reference'),
  kytStatus: text('kyt_status'),
  ...timestamps,
}, (table) => [
  index('funding_org_idx').on(table.orgId),
  uniqueIndex('funding_provider_ref_unique').on(table.provider, table.providerReference),
]);

export const payouts = pgTable('payouts', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  intentId: text('intent_id').references(() => paymentIntents.id),
  rail: text('rail').notNull(),
  provider: text('provider').notNull(),
  status: text('status').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(),
  providerReference: text('provider_reference'),
  ...timestamps,
}, (table) => [index('payouts_intent_idx').on(table.intentId)]);

export const treasuryMoves = pgTable('treasury_moves', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(),
  approvedBy: text('approved_by'),
  ...timestamps,
}, (table) => [index('treasury_org_idx').on(table.orgId)]);

export const complianceCases = pgTable('compliance_cases', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  subjectKind: text('subject_kind').notNull(),
  subjectId: text('subject_id').notNull(),
  status: text('status').notNull().default('OPEN'),
  reason: text('reason'),
  releasedBy: text('released_by'),
  releaseReason: text('release_reason'),
  ...timestamps,
}, (table) => [index('cases_subject_idx').on(table.subjectKind, table.subjectId)]);

export const screeningResults = pgTable('screening_results', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  subjectKind: text('subject_kind').notNull(),
  subjectId: text('subject_id').notNull(),
  provider: text('provider').notNull(),
  verdict: screeningVerdict('verdict').notNull(),
  riskScore: numeric('risk_score'),
  raw: jsonb('raw'),
  screenedAt: timestamp('screened_at', { withTimezone: true }).notNull(),
  ...timestamps,
}, (table) => [index('screening_subject_idx').on(table.subjectKind, table.subjectId)]);

export const auditAnchors = pgTable('audit_anchors', {
  id: text('id').primaryKey(),
  orgId: text('org_id').references(() => organizations.id),
  batchDate: text('batch_date').notNull(),
  walrusBlobId: text('walrus_blob_id'),
  auditHash: text('audit_hash'),
  suiDigest: text('sui_digest'),
  ...timestamps,
});

export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  payload: jsonb('payload').notNull(),
  status: webhookStatus('status').notNull().default('RECEIVED'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [
  // Replay/dupe rejection: a provider event lands exactly once.
  uniqueIndex('webhook_event_unique').on(table.provider, table.eventId),
]);

/* ── Double-entry ledger ─────────────────────────────────────────────
   Every money movement writes a journal entry whose postings sum to
   zero per currency, in the SAME transaction as the state change. */

export const journalEntries = pgTable('journal_entries', {
  id: text('id').primaryKey(),
  orgId: text('org_id').references(() => organizations.id),
  kind: text('kind').notNull(),
  intentId: text('intent_id'),
  /** What this movement refers to — the sweep job, funding session, intent.
   *  `kind` says which. Without it these rode in `intent_id`, which means an
   *  intent and nothing else. */
  refId: text('ref_id'),
  /** Chain evidence for a ledger line, so reconciling the ledger against the
   *  chain is a join rather than parsing prose out of `description`. */
  suiTxDigest: text('sui_tx_digest'),
  description: text('description'),
  ...timestamps,
}, (table) => [index('journal_intent_idx').on(table.intentId)]);

export const ledgerPostings = pgTable('ledger_postings', {
  id: text('id').primaryKey(),
  journalId: text('journal_id').notNull().references(() => journalEntries.id),
  account: text('account').notNull(),
  currency: text('currency').notNull(),
  /** Signed minor units: debits positive, credits negative. */
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  ...timestamps,
}, (table) => [
  index('postings_journal_idx').on(table.journalId),
  index('postings_account_idx').on(table.account, table.currency),
  /** One account's movements newest-first: the ledger page and every balance
   *  check. Carries the ordering so the read is a scan, not a sort. */
  index('postings_account_created_idx').on(table.account, table.currency, table.createdAt),
]);

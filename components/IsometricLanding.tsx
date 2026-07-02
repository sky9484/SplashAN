import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BanknoteArrowDown,
  Check,
  CircleDollarSign,
  ClockArrowUp,
  FileCheck2,
  Landmark,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
  TrendingUp,
  WalletCards,
} from 'lucide-react';

import { EnvironmentRibbon } from '@/components/EnvironmentRibbon';
import { SourceBadge } from '@/components/SourceBadge';
import { DashboardPreview } from '@/components/landing/DashboardPreview';
import { claims, lockedCopy } from '@/content/claims';
import { formatMoney } from '@/lib/formatMoney';

import styles from './IsometricLanding.module.css';

const navItems = [
  ['Product', '#product'],
  ['How it works', '#how-it-works'],
  ['Security', '#security'],
  ['Corridors', '#corridors'],
  ['Pricing', '#pricing'],
] as const;

const trustTiers = [
  {
    title: 'Compliance and custody',
    items: [
      ['Labuan FSA', 'licence application in progress', claims.labuanApplication.status],
      ['Sumsub', 'KYB workflow', claims.sumsub.status],
      ['Elliptic', 'KYT and sanctions gate', claims.elliptic.status],
      ['BitGo', 'qualified custody option', claims.custody.status],
      ['CoKeeps / Gambit', 'Malaysia local custody options', claims.custody.status],
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      ['Sui', 'settlement network', 'testnet-verified'],
      ['Circle USDC', 'settlement asset', 'modeled'],
      ['Walrus', 'stored proof', 'testnet-verified'],
      ['DeepBook', 'liquidity reference', 'modeled'],
      ['Pyth', 'market rate reference', 'modeled'],
    ],
  },
] as const;

const jobs = [
  {
    icon: CircleDollarSign,
    title: 'Money in',
    line: 'Invoice and collect USD from global customers.',
    support: 'Pay links create structured payment context with review before settlement.',
    href: '#product',
  },
  {
    icon: BanknoteArrowDown,
    title: 'Money out',
    line: 'Pay suppliers and payroll across SEA in local currency.',
    support: 'Approval-led transfers, batches and receipts stay in one operating desk.',
    href: '#how-it-works',
  },
  {
    icon: ClockArrowUp,
    title: 'Get paid early',
    line: 'Turn accepted invoices into cash today - you set the rate.',
    support: 'The v3 receivable path keeps buyer acceptance and proof attached.',
    href: '#receivables',
  },
  {
    icon: TrendingUp,
    title: 'Money working',
    line: 'Idle balance earns variable T-bill-backed yield.',
    support: 'Treasury floor protection stays visible before any approval.',
    href: '#treasury',
  },
] as const;

const flow = [
  ['01', 'Collect USD', 'Create an invoice or pay link and keep the original document access-controlled.'],
  ['02', 'Review and approve', 'KYB, recipient, rate, fee and evidence labels appear before signature.'],
  ['03', 'Settle in one signature', 'The transaction either completes as approved or safely stops.'],
  ['04', 'Anchor the proof', 'Receipt, Walrus record and Sui anchor stay available for audit.'],
] as const;

const modules = [
  {
    title: 'Receivables',
    copy: 'Buyer-accepted invoices become working-capital objects when the Phase C primitive ships.',
    metric: formatMoney(BigInt(9840000), 'USD'),
    badge: 'modeled',
    icon: ReceiptText,
  },
  {
    title: 'Transfers and batches',
    copy: 'Queue, approve and trace payouts from quote to receipt.',
    metric: lockedCopy.fee,
    badge: claims.fee.status,
    icon: BanknoteArrowDown,
  },
  {
    title: 'Treasury controls',
    copy: 'See available cash, operating floor, modeled yield and pending outflows together.',
    metric: lockedCopy.yield,
    badge: claims.treasuryYield.status,
    icon: Landmark,
  },
  {
    title: 'Reconciliation and audit',
    copy: 'Store proof, verify batches and export the evidence trail.',
    metric: '12 proof batches',
    badge: claims.auditTrail.status,
    icon: FileCheck2,
  },
  {
    title: 'Early Pay',
    copy: 'Offer inbox ranks supplier discounts by APR-equivalent and treasury comparison.',
    metric: '12.4% APR-equiv - 38 days early',
    badge: claims.receivable.status,
    icon: ClockArrowUp,
  },
] as const;

const comparison = [
  ['Local delivery', 'Manual rail', 'Transfer only', 'Payment plus proof'],
  ['Approval controls', 'Email and portals', 'Limited', 'Maker-checker and roles'],
  ['Idle cash earns yield', 'No', 'No', 'Variable, T-bill-backed'],
  ['Early payment on invoices', 'No', 'No', 'You set the discount'],
  ['Bilateral netting', 'No', 'No', 'Settle only the difference'],
  ['Audit trail', 'Siloed statements', 'Platform history', 'Stored proof and Sui anchor'],
] as const;

const securityBlocks = [
  {
    icon: LockKeyhole,
    title: 'Private business records',
    copy: 'Encrypted at rest today; threshold-encrypted mode activates only when live Seal is configured.',
    badge: 'modeled',
  },
  {
    icon: ShieldCheck,
    title: 'Approval-led controls',
    copy: 'Maker-checker, thresholds and deterministic policy evaluation sit before submit.',
    badge: 'testnet-verified',
  },
  {
    icon: FileCheck2,
    title: 'Independent audit trail',
    copy: 'Stored proof, ciphertext hash and Sui anchor are exposed through the proof drawer pattern.',
    badge: 'testnet-verified',
  },
  {
    icon: WalletCards,
    title: 'Qualified custody options',
    copy: 'Governance and client-asset custody remain clearly labeled until contracts and licenses are final.',
    badge: 'modeled',
  },
] as const;

const routes = [
  ['MY -> PH', 'live corridor (testnet)', 'testnet-verified'],
  ['MY -> SG', 'in development - modeled', 'modeled'],
  ['SG -> ID', 'in development - modeled', 'modeled'],
  ['TH -> PH', 'in development - modeled', 'modeled'],
  ['IN -> MY', 'in development - modeled', 'modeled'],
] as const;

export default function IsometricLanding() {
  return (
    <main className={styles.landing}>
      <EnvironmentRibbon />
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Splash home">
          <Image src="/splash-main-icon.png" alt="" width={38} height={38} priority />
          <span>Splash</span>
        </Link>
        <nav className={styles.nav} aria-label="Primary navigation">
          {navItems.map(([label, href]) => <a href={href} key={label}>{label}</a>)}
        </nav>
        <div className={styles.headerActions}>
          <Link href="/login">Sign in</Link>
          <Link href="/signup" className={styles.primarySmall}>Book demo</Link>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroArt} aria-hidden="true">
          <Image src="/isometric/v3/hero-network.svg" alt="" width={960} height={640} priority />
        </div>
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Built for regulated cross-border operations</p>
            <h1>
              Collect USD. Pay <br className={styles.mobileBreak} />Southeast Asia. <br className={styles.mobileBreak} />Keep cash <span>working.</span>
            </h1>
            <p>{claims.heroSub.claim}</p>
            <div className={styles.actions}>
              <Link href="/signup" className={styles.primary}>Book demo <ArrowRight aria-hidden="true" /></Link>
              <Link href="/dashboard" className={styles.secondary}>Explore sandbox</Link>
            </div>
            <div className={styles.trustPills} aria-label="Trust signals">
              {['KYB-ready', 'Approval-led controls', 'Audit trail', 'Qualified custody'].map((item) => (
                <span key={item}><Check aria-hidden="true" />{item}</span>
              ))}
            </div>
          </div>
          <div className={styles.previewWrap}>
            <DashboardPreview />
          </div>
        </div>
      </section>

      <section className={styles.trustStrip} aria-label="Trust and infrastructure">
        {trustTiers.map((tier) => (
          <div className={styles.trustTier} key={tier.title}>
            <h2>{tier.title}</h2>
            <div>
              {tier.items.map(([name, role, status]) => (
                <article key={name}>
                  <strong>{name}</strong>
                  <span>{role}</span>
                  <SourceBadge state={status} />
                </article>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section id="product" className={styles.section}>
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>Product</p>
          <h2>Four jobs, one operating account.</h2>
          <p>Clean product surfaces first; isometric identity only where it helps people remember the network.</p>
        </div>
        <div className={styles.jobGrid}>
          {jobs.map(({ icon: Icon, title, line, support, href }) => (
            <a href={href} className={styles.jobCard} key={title}>
              <span><Icon aria-hidden="true" /></span>
              <strong>{title}</strong>
              <p>{line}</p>
              <small>{support}</small>
            </a>
          ))}
        </div>
      </section>

      <section id="how-it-works" className={`${styles.section} ${styles.how}`}>
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>How it works</p>
          <h2>Money movement with fewer blind spots.</h2>
        </div>
        <div className={styles.flowGrid}>
          {flow.map(([number, title, copy]) => (
            <article key={number}>
              <span>{number}</span>
              <strong>{title}</strong>
              <p>{copy}</p>
            </article>
          ))}
          <a href="#receivables" className={styles.branchChip}>Or get paid early <ArrowRight aria-hidden="true" /></a>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>Modules</p>
          <h2>Live UI crops, not raster screenshots.</h2>
        </div>
        <div className={styles.moduleGrid}>
          {modules.map(({ title, copy, metric, badge, icon: Icon }) => (
            <article className={styles.moduleCard} key={title}>
              <div className={styles.moduleTop}>
                <span><Icon aria-hidden="true" /></span>
                <SourceBadge state={badge} />
              </div>
              <strong>{title}</strong>
              <p>{copy}</p>
              <div className={styles.metricLine}>{metric}</div>
            </article>
          ))}
        </div>
      </section>

      <section id="receivables" className={`${styles.section} ${styles.split}`}>
        <div className={styles.scene}>
          <Image src="/isometric/v3/receivable-flow.svg" alt="Isometric receivable lifecycle from invoice to anchored receipt" width={960} height={520} />
        </div>
        <div>
          <p className={styles.eyebrow}>Receivable lifecycle</p>
          <h2>An accepted invoice becomes a settled promise.</h2>
          <p>An invoice your buyer accepts becomes a settled promise. Offer a discount you choose, get paid in one signature, keep the proof forever.</p>
          <div className={styles.factChips}>
            {['Buyer-signed on-chain', 'Funds move atomically', 'Treasury floor enforced'].map((fact) => (
              <span key={fact}>{fact}<SourceBadge state="testnet-verified" href="/dashboard/history" /></span>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>Compare</p>
          <h2>Operator outcomes, not protocol theater.</h2>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.compareTable}>
            <thead>
              <tr><th>Capability</th><th>Bank</th><th>Transfer app</th><th>Splash</th></tr>
            </thead>
            <tbody>
              {comparison.map(([capability, bank, app, splash]) => (
                <tr key={capability}>
                  <th scope="row">{capability}</th>
                  <td>{bank}</td>
                  <td>{app}</td>
                  <td>{splash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="security" className={`${styles.section} ${styles.split}`}>
        <div>
          <p className={styles.eyebrow}>Security and compliance</p>
          <h2>Controls people can understand.</h2>
          <p>Every financial figure and claim is labeled by source state. Every money action keeps human approval as the final boundary.</p>
          <Link href="/dashboard/history" className={styles.textLink}>View security details <ArrowRight aria-hidden="true" /></Link>
        </div>
        <div className={styles.securityGrid}>
          {securityBlocks.map(({ icon: Icon, title, copy, badge }) => (
            <article key={title}>
              <Icon aria-hidden="true" />
              <strong>{title}</strong>
              <p>{copy}</p>
              <SourceBadge state={badge} />
            </article>
          ))}
        </div>
        <div className={styles.sceneWide}>
          <Image src="/isometric/v3/security-vault.svg" alt="Isometric security vault with two custodian towers" width={960} height={520} />
        </div>
      </section>

      <section id="corridors" className={`${styles.section} ${styles.corridors}`}>
        <div>
          <p className={styles.eyebrow}>Corridors</p>
          <h2>Live in one corridor. Expanding on demand, not on a map.</h2>
          <p>MY to PH is the current testnet corridor. Other routes stay modeled until partner, liquidity and compliance gates are ready.</p>
          <div className={styles.routeList}>
            {routes.map(([route, label, state]) => (
              <span key={route}><strong>{route}</strong>{label}<SourceBadge state={state} /></span>
            ))}
          </div>
        </div>
        <div className={styles.scene}>
          <Image src="/isometric/v3/corridors-map.svg" alt="Isometric Southeast Asia corridors map with route status badges" width={960} height={640} />
        </div>
      </section>

      <section id="pricing" className={`${styles.section} ${styles.pricing}`}>
        <article>
          <p className={styles.eyebrow}>Pilot</p>
          <h2>Custom pricing</h2>
          <ul>
            <li>Sandbox access</li>
            <li>Corridor review</li>
            <li>White-glove onboarding</li>
          </ul>
          <div className={styles.metricLine}>{lockedCopy.fee}<SourceBadge state={claims.fee.status} /></div>
          <small>{lockedCopy.feeFootnote}</small>
        </article>
        <div>
          <h2>Ready to modernize your payout operations?</h2>
          <p>{lockedCopy.speed}. {lockedCopy.speedFootnote}</p>
          <div className={styles.actions}>
            <Link href="/signup" className={styles.primary}>Talk to operations <ArrowRight aria-hidden="true" /></Link>
            <Link href="/dashboard" className={styles.secondary}>Request sandbox</Link>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div>
          <Image src="/splash-main-logo.png" alt="Splash" width={172} height={50} />
          <p>{claims.footerLegal.claim}</p>
          <SourceBadge state={claims.footerLegal.status} />
        </div>
        <nav aria-label="Footer">
          <a href="#product">Product</a>
          <a href="#how-it-works">Solutions</a>
          <a href="#security">Security</a>
          <a href="#corridors">Resources</a>
          <Link href="/login">Company</Link>
          <a href="#pricing">Legal</a>
        </nav>
      </footer>
    </main>
  );
}

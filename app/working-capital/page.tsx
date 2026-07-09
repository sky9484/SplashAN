import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, FileCheck2, History, Landmark, ReceiptText, ShieldCheck, Undo2 } from 'lucide-react';

import RoadmapChip from '@/components/supply/RoadmapChip';
import WorkingCapitalFlywheel from '@/components/supply/WorkingCapitalFlywheel';

export const metadata: Metadata = {
  title: 'Dynamic discounting for Southeast Asia — early invoice payment on Splash (roadmap)',
  description:
    'Splash is building buyer-funded dynamic discounting for the Philippines and Southeast Asia: early payment on verified invoices over the same Sui settlement rail that moves payouts today. Coming capability, subject to licensing.',
  keywords: [
    'dynamic discounting Philippines',
    'early payment program Southeast Asia',
    'invoice early payment',
    'buyer-funded discounting',
    'working capital Southeast Asia',
  ],
};

const receivableFacts = [
  {
    icon: ShieldCheck,
    title: 'Issued between verified businesses',
    copy: 'A Receivable would only exist between two KYB-verified counterparties already transacting on Splash — the same verification that gates every payout today.',
  },
  {
    icon: History,
    title: 'Carries its own settlement history',
    copy: 'Quotes, approvals, receipts, and settlement proof would anchor to the invoice itself — an invoice that shows how reliably it gets paid.',
  },
  {
    icon: FileCheck2,
    title: 'Safe to pay early',
    copy: 'A receivable with a clean, verifiable history is the safest thing to fund early. That is the whole idea — no guesswork, no external credit file.',
  },
];

const discountSteps = [
  {
    number: '01',
    icon: Landmark,
    title: 'Buyer offers early payment',
    copy: 'Your buyer sees an approved 90-day invoice and offers to pay it now — with their own USD already on the settlement rail.',
  },
  {
    number: '02',
    icon: ReceiptText,
    title: 'Supplier accepts a discount',
    copy: 'You choose per invoice: the full amount on the due date, or a small discount today. No obligation either way.',
  },
  {
    number: '03',
    icon: Undo2,
    title: 'Settlement — no third-party lender',
    copy: 'The buyer’s own funds would settle the early payment over Splash. No factoring house, no credit line, no lender between you.',
  },
];

export default function WorkingCapitalPage() {
  return (
    <main className="wc-page">
      <header className="wc-topbar">
        <div className="iso-shell wc-topbar-inner">
          <Link href="/" className="iso-brand" aria-label="Splash Finance home">
            <Image src="/splash-main-icon.png" alt="" width={841} height={823} className="iso-header-brand-icon" priority />
            <span className="iso-header-wordmark"><strong>Splash</strong></span>
          </Link>
          <nav className="wc-topbar-nav" aria-label="Page navigation">
            <Link href="/" className="wc-back-link">
              <ArrowLeft aria-hidden="true" /> Back to Splash
            </Link>
            <Link href="/signup" className="iso-button iso-button-small">
              Start sending
              <ArrowRight aria-hidden="true" />
            </Link>
          </nav>
        </div>
      </header>

      <section className="iso-section wc-hero">
        <div className="iso-shell">
          <p className="iso-kicker">Supply loop</p>
          <div className="wc-hero-chiprow">
            <RoadmapChip detail="coming capability, subject to licensing" />
          </div>
          <h1 className="iso-section-title wc-hero-title">
            Your invoices are
            <span>working capital.</span>
          </h1>
          <p className="wc-hero-desc">
            Splash is building buyer-funded early payment on the same settlement rail that moves your
            payouts today. No third-party lender — your buyer&apos;s approved USD, released early
            against an invoice you both already trust.
          </p>
          <div className="wc-hero-actions">
            <Link href="/signup?interest=financing" className="iso-button">
              Register financing interest
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link href="/" className="iso-button iso-button-ghost">
              See live settlement first
            </Link>
          </div>
        </div>
      </section>

      <section className="iso-section wc-receivable">
        <div className="iso-shell">
          <div className="iso-section-heading iso-heading-split">
            <div>
              <p className="iso-kicker">The Receivable</p>
              <h2 className="iso-section-title">
                An invoice that carries
                <span>its own settlement history.</span>
              </h2>
            </div>
            <p>
              In plain finance terms: a Receivable would be an invoice object that remembers how it
              gets paid — who approved it, on what rail, with what proof. History a lender would
              charge you to underwrite, your buyer can simply read.
            </p>
          </div>
          <div className="wc-cards">
            {receivableFacts.map((fact) => (
              <article className="wc-card" key={fact.title}>
                <span className="iso-loops-icon"><fact.icon aria-hidden="true" /></span>
                <h3>{fact.title}</h3>
                <p>{fact.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="iso-section wc-mechanics">
        <div className="iso-shell">
          <div className="iso-section-heading iso-heading-split">
            <div>
              <p className="iso-kicker">Buyer-funded discounting</p>
              <h2 className="iso-section-title">
                Early payment,
                <span>without a lender.</span>
              </h2>
            </div>
            <p>
              Dynamic discounting is a trade between two parties who already trust each other: the
              buyer puts idle USD to work, the supplier turns a due date into cash flow. Splash would
              only referee the exchange.
            </p>
          </div>
          <ol className="wc-steps">
            {discountSteps.map((step) => (
              <li className="wc-step" key={step.number}>
                <span className="wc-step-number">{step.number}</span>
                <span className="iso-loops-icon"><step.icon aria-hidden="true" /></span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="iso-section iso-loops wc-flywheel">
        <div className="iso-shell">
          <div className="iso-section-heading iso-heading-split">
            <div>
              <p className="iso-kicker">Where Supply fits</p>
              <h2 className="iso-section-title">
                One rail,
                <span>three loops.</span>
              </h2>
            </div>
            <p>
              Settle is live and feeds the loop with verified counterparties and settlement history.
              Supply would compound it into working capital. Save keeps idle balances tidy in between.
            </p>
          </div>
          <WorkingCapitalFlywheel variant="full" />
        </div>
      </section>

      <section className="iso-section wc-cta">
        <div className="iso-shell wc-cta-inner">
          <div>
            <h2 className="iso-section-title">
              Early interest shapes
              <span>the corridor order.</span>
            </h2>
            <p className="wc-legal">
              Dynamic discounting is a coming capability, subject to licensing. Registering interest
              does not create a financing commitment — it tells us which corridors to build first.
            </p>
          </div>
          <div className="wc-hero-actions">
            <Link href="/signup?interest=financing" className="iso-button">
              Register financing interest
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="wc-footer">
        <div className="iso-shell wc-footer-inner">
          <span>© 2026 Splash Financial Labuan Ltd.</span>
          <span>Supply loop: roadmap · Settle loop: live on testnet</span>
        </div>
      </footer>
    </main>
  );
}

import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';

import { SourceBadge } from '@/components/SourceBadge';
import { formatMoney } from '@/lib/formatMoney';

import styles from './DashboardPreview.module.css';

const queue = [
  {
    title: 'Approve supplier payout',
    meta: 'MY -> PH - transfer',
    amount: formatMoney(BigInt(2480000), 'USD'),
  },
  {
    title: 'Early-pay offer ready',
    meta: '38 days early - receivable',
    amount: '12.4% APR-equiv',
  },
  {
    title: 'Treasury floor warning',
    meta: 'Safe-to-deploy check',
    amount: formatMoney(BigInt(14800000), 'USD'),
  },
];

export function DashboardPreview() {
  return (
    <div className={styles.frame} aria-label="Simulated Splash dashboard preview">
      <div className={styles.chrome}>
        <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>
        <SourceBadge state="simulated" />
      </div>
      <div className={styles.body}>
        <div className={styles.header}>
          <div>
            <h3>Needs your attention</h3>
            <p>Operating queue for approvals, holds, quotes and proof.</p>
          </div>
          <CheckCircle2 aria-hidden="true" />
        </div>
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span>Available</span>
            <strong>{formatMoney(BigInt(18425000), 'USD')}</strong>
            <SourceBadge state="modeled" />
          </div>
          <div className={styles.metric}>
            <span>Pending out</span>
            <strong>{formatMoney(BigInt(4200000), 'USD')}</strong>
            <SourceBadge state="simulated" />
          </div>
          <div className={styles.metric}>
            <span>Audit batches</span>
            <strong>12</strong>
            <SourceBadge state="testnet-verified" href="/dashboard/history" />
          </div>
        </div>
        <div className={styles.grid}>
          <div className={styles.queue}>
            {queue.map((item) => (
              <div className={styles.row} key={item.title}>
                <span className={styles.chip}><AlertTriangle aria-hidden="true" size={17} /></span>
                <span>
                  <strong>{item.title}</strong>
                  <span>{item.meta}</span>
                </span>
                <span className={styles.mono}>{item.amount}</span>
              </div>
            ))}
          </div>
          <div className={styles.card}>
            <strong>0xWal prepares. You approve.</strong>
            <p>Simulation deltas, evidence labels and approver requirements sit before any signature.</p>
            <div className={styles.bars} aria-hidden="true"><i /><i /><i /></div>
            <span className={styles.mono}>1 approval <ArrowRight aria-hidden="true" size={13} /> Sign</span>
          </div>
        </div>
      </div>
    </div>
  );
}

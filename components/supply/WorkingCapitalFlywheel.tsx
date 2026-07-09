'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Landmark, ReceiptText, Sprout } from 'lucide-react';

import RoadmapChip from '@/components/supply/RoadmapChip';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const rise = {
  hidden: { opacity: 0, y: 24 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE_OUT_EXPO } },
};

const riseParent = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

type Loop = {
  id: 'settle' | 'supply' | 'save';
  icon: typeof Landmark;
  status: 'live' | 'roadmap';
  name: string;
  role: string;
  copy: string;
  meta: string;
};

const LOOPS: Loop[] = [
  {
    id: 'settle',
    icon: Landmark,
    status: 'live',
    name: 'Settle',
    role: 'The feeding wedge',
    copy: 'Collect USD, pay Southeast Asia. Every approved payout builds verified counterparties and settlement history.',
    meta: 'USD → PHP · live on testnet',
  },
  {
    id: 'supply',
    icon: ReceiptText,
    status: 'roadmap',
    name: 'Supply',
    role: 'Working capital',
    copy: 'Invoices would become working capital: your buyer funds early payment against a receivable whose settlement history both sides can verify.',
    meta: 'Buyer-funded · no third-party lender',
  },
  {
    id: 'save',
    icon: Sprout,
    status: 'live',
    name: 'Save',
    role: 'Balance hygiene',
    copy: 'Idle USD follows a projected, variable treasury posture. Your business approves every move.',
    meta: 'Projected · variable · human-approved',
  },
];

const HANDOFFS = ['settlement history feeds', 'freed cash returns'];

/**
 * The three-loop flywheel: Settle (live wedge) → Supply (coral-weighted
 * roadmap moat) → Save (small hygiene ring), joined by a conveyor with a
 * loop-back — money that finishes one loop is ready to start the next.
 * `variant="band"` renders the landing strip; `variant="full"` is the
 * /working-capital hero diagram.
 */
export default function WorkingCapitalFlywheel({ variant = 'band' }: { variant?: 'band' | 'full' }) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      className={`iso-loops-wheel is-${variant}`}
      variants={riseParent}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: '-80px' }}
    >
      {/* Loop-back conveyor: value exits Save ready to Settle again. */}
      <svg className="iso-loops-orbit" viewBox="0 0 1160 84" aria-hidden="true" preserveAspectRatio="none">
        <path
          d="M 1096 76 C 1128 76 1148 58 1148 34 C 1148 12 1128 4 1096 4 L 64 4 C 32 4 12 12 12 34 C 12 58 32 76 64 76"
          fill="none"
          className={reducedMotion ? '' : 'is-flowing'}
        />
        <text x="580" y="24" textAnchor="middle">ready to settle again</text>
      </svg>

      <div className="iso-loops-track">
        {LOOPS.map((loop, index) => (
          <div className="iso-loops-station" key={loop.id}>
            <motion.article variants={rise} className={`iso-loops-card is-${loop.id}`}>
              <div className="iso-loops-card-head">
                <span className="iso-loops-icon"><loop.icon aria-hidden="true" /></span>
                {loop.status === 'roadmap' ? (
                  <RoadmapChip />
                ) : (
                  <span className="iso-loops-live"><i aria-hidden="true" /> Live</span>
                )}
              </div>
              <h3>
                {loop.name}
                <span>{loop.role}</span>
              </h3>
              <p>{loop.copy}</p>
              <small>{loop.meta}</small>
            </motion.article>
            {index < LOOPS.length - 1 ? (
              <motion.div variants={rise} className="iso-loops-handoff" aria-hidden="true">
                <span>{HANDOFFS[index]}</span>
                <ArrowRight />
              </motion.div>
            ) : null}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

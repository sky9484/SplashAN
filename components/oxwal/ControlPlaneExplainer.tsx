import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

/**
 * Public explainer for the SHIPPED 0xWal control plane, in the §S card
 * grammar (iso-ctrl-card = meta / art / copy, mirroring iso-supply-card).
 * Every phase names the real module that implements it and renders the
 * actual ProposalStatus values from lib/agent/types.ts — the UI matches the
 * engine, not a marketing diagram of it.
 */
const PHASES = [
  {
    number: '01',
    title: 'Propose',
    module: 'lib/agent/oxwal.ts',
    copy: '0xWal drafts an unsigned proposal and dry-runs it against live balances. Gas is sponsored — nothing is signed, nothing moves.',
    states: ['DRAFTED', 'SIMULATED'],
    image: '/isometric/blocks-icon.svg',
    imageAlt: 'Isometric stacked blocks representing a drafted proposal',
  },
  {
    number: '02',
    title: 'Policy',
    module: 'lib/policy/evaluate.ts',
    copy: 'Deterministic rules — approval thresholds, corridor arm/pause state, operating minimums — evaluate the proposal. Code, not judgement.',
    states: ['POLICY_EVALUATED'],
    image: '/isometric/checklist-icon.svg',
    imageAlt: 'Isometric checklist representing deterministic policy evaluation',
  },
  {
    number: '03',
    title: 'Guards',
    module: 'lib/safety/*',
    copy: 'Anomaly screens, a circuit breaker, and a submit guard sit between the proposal and the queue. Any trip stops the pipeline.',
    states: ['PENDING_APPROVAL'],
    image: '/isometric/secure-icon.svg',
    imageAlt: 'Isometric shield representing the safety guards',
  },
  {
    number: '04',
    title: 'You approve',
    module: 'app/queue',
    copy: 'A human signs in the Action Queue — maker-checker, with dual approval above your threshold. This is the only gate that releases money.',
    states: ['APPROVED', 'SIGNED'],
    image: '/isometric/stats-icon.svg',
    imageAlt: 'Isometric approval console representing the human release gate',
  },
  {
    number: '05',
    title: 'Execute & prove',
    module: 'lib/evidence/settlement.ts',
    copy: 'The approved transaction settles on Sui, and Seal-encrypted evidence lands on Walrus, anchored on-chain for audit.',
    states: ['SUBMITTED', 'SETTLED', 'ANCHORED'],
    image: '/isometric/arrow-coin.svg',
    imageAlt: 'Isometric coin on a rail representing settlement and anchored proof',
  },
];

export default function ControlPlaneExplainer() {
  return (
    <div className="iso-ctrl">
      <div className="iso-ctrl-claim">
        <p>
          <strong>0xWal prepares, you approve.</strong> 0xWal never moves money — deterministic
          policy and your approval do. This pipeline is shipped code, not a roadmap.
        </p>
        <Link href="/queue" className="iso-button iso-button-small">
          Open the Action Queue
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>

      <ol className="iso-ctrl-grid">
        {PHASES.map((phase) => (
          <li className="iso-ctrl-card" key={phase.title}>
            <div className="iso-ctrl-meta">
              <span>{phase.number}</span>
              <p>{phase.title}</p>
            </div>
            <div className="iso-ctrl-art">
              <Image src={phase.image} alt={phase.imageAlt} width={480} height={360} />
            </div>
            <div className="iso-ctrl-copy">
              <p>{phase.copy}</p>
              <div className="iso-ctrl-states">
                {phase.states.map((state) => (
                  <code key={state}>{state}</code>
                ))}
              </div>
              <code className="iso-ctrl-module">{phase.module}</code>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

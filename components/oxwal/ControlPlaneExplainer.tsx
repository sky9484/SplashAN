import Link from 'next/link';
import { ArrowRight, BrainCircuit, FileLock2, Scale, ShieldAlert, UserCheck } from 'lucide-react';

/**
 * Public explainer for the SHIPPED 0xWal control plane. Every phase names the
 * real module that implements it, and the status chain below renders the
 * actual ProposalStatus values from lib/agent/types.ts — the UI matches the
 * engine, not a marketing diagram of it.
 */
const PHASES = [
  {
    icon: BrainCircuit,
    module: 'lib/agent/oxwal.ts',
    title: 'Propose',
    copy: '0xWal drafts an unsigned proposal and dry-runs it against live balances. Gas is sponsored — nothing is signed, nothing moves.',
    states: ['DRAFTED', 'SIMULATED'],
  },
  {
    icon: Scale,
    module: 'lib/policy/evaluate.ts',
    title: 'Policy',
    copy: 'Deterministic rules — approval thresholds, corridor arm/pause state, operating minimums — evaluate the proposal. Code, not judgement.',
    states: ['POLICY_EVALUATED'],
  },
  {
    icon: ShieldAlert,
    module: 'lib/safety/*',
    title: 'Guards',
    copy: 'Anomaly screens, a circuit breaker, and a submit guard sit between the proposal and the queue. Any trip stops the pipeline.',
    states: ['PENDING_APPROVAL'],
  },
  {
    icon: UserCheck,
    module: 'app/queue',
    title: 'You approve',
    copy: 'A human signs in the Action Queue — maker-checker, with dual approval above your threshold. This is the only gate that releases money.',
    states: ['APPROVED', 'SIGNED'],
  },
  {
    icon: FileLock2,
    module: 'lib/evidence/settlement.ts',
    title: 'Execute & prove',
    copy: 'The approved transaction settles on Sui, and Seal-encrypted evidence lands on Walrus, anchored on-chain for audit.',
    states: ['SUBMITTED', 'SETTLED', 'ANCHORED'],
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

      <ol className="iso-ctrl-rail">
        {PHASES.map((phase, index) => (
          <li className="iso-ctrl-phase" key={phase.title}>
            <div className="iso-ctrl-head">
              <span className="iso-loops-icon"><phase.icon aria-hidden="true" /></span>
              <code>{phase.module}</code>
            </div>
            <h3>
              <em>{String(index + 1).padStart(2, '0')}</em> {phase.title}
            </h3>
            <p>{phase.copy}</p>
            <div className="iso-ctrl-states">
              {phase.states.map((state) => (
                <code key={state}>{state}</code>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

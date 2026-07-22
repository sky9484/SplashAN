'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRight, BadgeCheck, Mail } from 'lucide-react';

/**
 * "Join the waitlist" CTA for the landing page.
 *
 * Ghost-styled on purpose: the row's single primary action stays "Start
 * sending". The button expands in place into a one-field email form posting
 * to /api/waitlist, with inline success and error states. `variant` maps to
 * the desktop (iso-*) or phone (mob-*) button system so both landings reuse
 * the same behavior.
 */
export default function WaitlistCta({ variant = 'iso' }: { variant?: 'iso' | 'mob' }) {
  const [phase, setPhase] = useState<'idle' | 'open' | 'submitting' | 'done'>('idle');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const buttonClass = variant === 'mob'
    ? 'mob-btn mob-btn-ghost'
    : 'iso-button iso-button-dark-ghost';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === 'submitting') return;
    setPhase('submitting');
    setError('');
    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: `landing-${variant}` }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Something went sideways — try again.');
      setPhase('done');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Something went sideways — try again.');
      setPhase('open');
    }
  }

  if (phase === 'done') {
    return (
      <p className="iso-waitlist-done" role="status">
        <BadgeCheck aria-hidden="true" />
        You&apos;re on the list — we&apos;ll email you when your corridor opens.
      </p>
    );
  }

  if (phase === 'idle') {
    return (
      <button type="button" className={buttonClass} onClick={() => setPhase('open')}>
        Join the waitlist
      </button>
    );
  }

  return (
    <form className="iso-waitlist-form" onSubmit={onSubmit} aria-label="Join the waitlist">
      <label className="iso-waitlist-field">
        <Mail aria-hidden="true" />
        <input
          type="email"
          required
          autoFocus
          autoComplete="email"
          aria-label="Work email"
          placeholder="name@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={phase === 'submitting'}
        />
      </label>
      {/* Honeypot — humans never see it, bots fill it. */}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" className="iso-waitlist-trap" />
      <button type="submit" className={buttonClass} disabled={phase === 'submitting'}>
        {phase === 'submitting' ? 'Joining…' : 'Join'}
        {phase !== 'submitting' ? <ArrowRight aria-hidden="true" /> : null}
      </button>
      {error ? <p className="iso-waitlist-error" role="alert">{error}</p> : null}
    </form>
  );
}

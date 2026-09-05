'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Mail } from 'lucide-react';
import { toast } from 'sonner';

import IsometricAuthShell from '@/components/auth/IsometricAuthShell';

type RecoveryResponse = {
  message?: string;
  recoveryEmail?: string;
  error?: string;
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [recovery, setRecovery] = useState<RecoveryResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/auth/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => ({})) as RecoveryResponse;

      if (!response.ok) {
        throw new Error(body.error ?? 'Recovery instructions are unavailable. Try again or contact support.');
      }

      setRecovery(body);
      toast.success('Recovery instructions ready');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Recovery instructions are unavailable. Try again or contact support.';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <IsometricAuthShell
      eyebrow="Account recovery"
      title={recovery ? 'Verify through support.' : 'Recover workspace access.'}
      description={recovery
        ? 'For treasury safety, workspace recovery is handled by verified support instead of an automated reset link.'
        : 'Enter your business email and we will show the secure recovery path for your workspace.'}
      art="/isometric/treasury.svg"
      artAlt="Isometric smart treasury"
      visualTitle="Secure by default"
      visualCopy="Recover access without compromising your treasury."
    >
      {recovery ? (
        <section className="iso-auth-success">
          <CheckCircle2 aria-hidden="true" />
          <h2>Recovery instructions ready</h2>
          <p>{recovery.message}</p>
          {recovery.recoveryEmail ? (
            <Link href={`mailto:${recovery.recoveryEmail}?subject=Splash workspace recovery&body=Business email: ${encodeURIComponent(email)}`}>
              Contact {recovery.recoveryEmail}
            </Link>
          ) : null}
          <button type="button" onClick={() => { setRecovery(null); setError(''); }}>
            <ArrowLeft aria-hidden="true" /> Use another email
          </button>
        </section>
      ) : (
        <form onSubmit={onSubmit} className="iso-auth-form">
          <label className="iso-auth-field" htmlFor="recovery-email">
            <span>Business email</span>
            <div>
              <Mail aria-hidden="true" />
              <input
                id="recovery-email"
                type="email"
                required
                autoComplete="email"
                placeholder="name@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          </label>
          <button type="submit" disabled={!email.includes('@') || submitting} className="iso-auth-submit">
            {submitting ? 'Checking recovery path...' : 'Show recovery path'}
            {!submitting ? <ArrowRight aria-hidden="true" /> : null}
          </button>
          {error ? <p className="iso-auth-error" role="alert">{error}</p> : null}
        </form>
      )}

      <div className="iso-auth-help">
        <strong>Still locked out?</strong>
        <span>Contact support after verifying your business identity.</span>
      </div>

      <p className="iso-auth-switch">
        Remembered your password? <Link href="/login">Back to sign in</Link>
      </p>
    </IsometricAuthShell>
  );
}

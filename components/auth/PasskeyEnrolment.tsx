'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Enrol a passkey as this account's approval signer.
 *
 * `authenticatorAttachment: 'platform'` — the approver is on their own phone
 * or laptop, and the key lives in its secure enclave. A roaming security key
 * would work cryptographically but is the wrong shape for the flow: it has to
 * be carried, and an approval is something a named human does from the device
 * already in their hand.
 *
 * The public key is sent to the server the instant it exists. WebAuthn hands
 * it over once, in the attestation, and never again — a later signature comes
 * back with a credential id and no key. Losing it here means the only way to
 * identify a signer later is to make them sign twice and intersect the
 * recovered candidates, which is two extra biometric prompts on the approval
 * path to rebuild something we already had.
 *
 * This screen enrols a signer. It does not approve anything: the queue stays
 * as it is until the Move `approve` entry point exists.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'none'; rpId: string }
  | { kind: 'enrolled'; rpId: string; suiAddress: string };

export default function PasskeyEnrolment() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** Reads the current state. Pure: it does not touch React state, so the
   *  effect below can decide whether the component is still mounted. */
  const readPasskeyState = useCallback(async (): Promise<State> => {
    try {
      if (typeof window === 'undefined' || !window.PublicKeyCredential) {
        return { kind: 'unsupported' };
      }
      const res = await fetch('/api/auth/passkey', { cache: 'no-store' });
      if (!res.ok) throw new Error('could not read passkey status');
      const body = (await res.json()) as { rpId: string; credential: { suiAddress: string } | null };
      return body.credential
        ? { kind: 'enrolled', rpId: body.rpId, suiAddress: body.credential.suiAddress }
        : { kind: 'none', rpId: body.rpId };
    } catch {
      return { kind: 'unsupported' };
    }
  }, []);

  const load = useCallback(async () => {
    setState(await readPasskeyState());
  }, [readPasskeyState]);

  useEffect(() => {
    // An inline async IIFE, not a call to the useCallback above: the effect
    // lint rule reads the callee's body and cannot see that every setState in
    // it is already behind an await. `cancelled` is the real reason for the
    // shape anyway — a component unmounted mid-fetch must not set state.
    let cancelled = false;
    void (async () => {
      const next = await readPasskeyState();
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [readPasskeyState]);

  async function enrol() {
    if (state.kind !== 'none') return;
    setBusy(true);
    setError('');
    try {
      const { BrowserPasskeyProvider, PasskeyKeypair } = await import('@mysten/sui/keypairs/passkey');

      const provider = new BrowserPasskeyProvider('Splash approval signer', {
        rp: { name: 'Splash', id: state.rpId },
        authenticatorSelection: {
          // The approver's own device, not a key on a lanyard.
          authenticatorAttachment: 'platform',
          // A biometric or PIN per approval is the point: possession of an
          // unlocked laptop must not be sufficient to release a payment.
          userVerification: 'required',
          residentKey: 'required',
        },
      });

      // Creation returns the public key. This is the only time it exists
      // outside the authenticator.
      const keypair = await PasskeyKeypair.getPasskeyInstance(provider);
      const publicKey = keypair.getPublicKey();

      const res = await fetch('/api/auth/passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentialId: publicKey.toSuiAddress(),
          publicKey: publicKey.toBase64(),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Enrolment could not be saved.');
      }
      await load();
    } catch (err) {
      // A user who dismisses the biometric prompt gets NotAllowedError; that is
      // a cancellation, not a fault worth an alarming message.
      const name = (err as { name?: string })?.name;
      setError(
        name === 'NotAllowedError'
          ? 'Enrolment was cancelled.'
          : err instanceof Error
            ? err.message
            : 'Enrolment failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError('');
    try {
      await fetch('/api/auth/passkey', { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === 'loading') return <p className="iso-passkey-status">Checking this device…</p>;

  if (state.kind === 'unsupported') {
    return (
      <p className="iso-passkey-status">
        This browser cannot hold a passkey. Approvals will need a device with a biometric or PIN — a phone, or a
        laptop with Touch ID or Windows Hello.
      </p>
    );
  }

  return (
    <div className="iso-passkey">
      {state.kind === 'enrolled' ? (
        <>
          <p className="iso-passkey-status">
            This account has an approval signer on <strong>{state.rpId}</strong>.
          </p>
          <p className="iso-passkey-address" title="The Sui address derived from your passkey">
            {state.suiAddress}
          </p>
          <p className="iso-passkey-note">
            Approvals signed by this device carry that address. It is bound to <strong>{state.rpId}</strong> and will
            not be offered on another host — enrol again there when you need it.
          </p>
          <button type="button" className="iso-passkey-revoke" onClick={() => void revoke()} disabled={busy}>
            {busy ? 'Removing…' : 'Remove this signer'}
          </button>
        </>
      ) : (
        <>
          <p className="iso-passkey-status">No approval signer on this account yet.</p>
          <p className="iso-passkey-note">
            Your device holds the key and never releases it. Splash stores only the public half, so an approval can be
            attributed to you without anyone — including us — being able to produce one on your behalf.
          </p>
          <button type="button" className="iso-passkey-enrol" onClick={() => void enrol()} disabled={busy}>
            {busy ? 'Waiting for your device…' : 'Set up an approval signer'}
          </button>
        </>
      )}
      {error ? (
        <p className="iso-passkey-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

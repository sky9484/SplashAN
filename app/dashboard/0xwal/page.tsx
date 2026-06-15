'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bot, CheckCircle2, Copy, Database, FileUp, Lock, ShieldCheck, Sparkles, XCircle, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';

import StatusBadge from '@/components/StatusBadge';
import MemWalBehaviorCard from '@/components/MemWalBehaviorCard';
import type { CopilotSuggestion } from '@/lib/server/copilot';
import type { InvoiceRecord } from '@/lib/server/operations';

type Extraction = { amount: number; currency: string; recipient: string; confidence: number };
type WalrusProof = { blobId: string; sizeBytes: number; epochs: number; mode: 'mock' | 'live'; createdAt: string };

export default function OxWalPage() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [selected, setSelected] = useState<InvoiceRecord | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [suggestion, setSuggestion] = useState<CopilotSuggestion | null>(null);
  const [access, setAccess] = useState<Record<string, boolean>>({});
  const [proof, setProof] = useState<WalrusProof | null>(null);
  const [uploading, setUploading] = useState(false);

  async function load() {
    const response = await fetch('/api/invoices');
    const result = (await response.json()) as { invoices: InvoiceRecord[] };
    setInvoices(result.invoices);
    setSelected((current) => current ?? result.invoices[0] ?? null);
  }
  useEffect(() => {
    let active = true;
    void fetch('/api/invoices')
      .then((response) => response.json())
      .then((result: { invoices: InvoiceRecord[] }) => {
        if (!active) return;
        setInvoices(result.invoices);
        setSelected((current) => current ?? result.invoices[0] ?? null);
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!selected?.walrusBlobId) return;
    let active = true;
    void fetch(`/api/walrus/${encodeURIComponent(selected.walrusBlobId)}`)
      .then((response) => response.ok ? response.json() as Promise<WalrusProof> : null)
      .then((result) => { if (active) setProof(result); })
      .catch(() => { if (active) setProof(null); });
    return () => { active = false; };
  }, [selected?.walrusBlobId]);

  async function upload(file: File) {
    setUploading(true);
    const documentBase64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(file);
    });
    const response = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issuerOrg: 'Splash Demo Ltd',
        payerOrgName: 'Acme Manufacturing PH',
        payerOrgEmail: 'finance@acme-ph.example',
        amountUsd: 5000,
        targetCurrency: 'PHP',
        dueDate: '2026-06-28',
        memo: 'Acme PH component supply',
        documentBase64,
      }),
    });
    const result = (await response.json()) as { invoice?: InvoiceRecord };
    setUploading(false);
    if (!response.ok || !result.invoice) return toast.error('Invoice upload failed');
    setSelected(result.invoice);
    setExtraction(null);
    setSuggestion(null);
    await load();
    toast.success('Encrypted and stored on Walrus');
  }

  async function checkAccess(identity: string) {
    if (!selected?.sealPolicyId) return;
    const response = await fetch('/api/seal/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policyId: selected.sealPolicyId, identity }) });
    const result = (await response.json()) as { granted: boolean };
    setAccess((current) => ({ ...current, [identity]: result.granted }));
  }

  async function extract() {
    if (!selected) return;
    const response = await fetch('/api/copilot/extract-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: selected.id }) });
    const result = (await response.json()) as { extraction: Extraction; suggestion: CopilotSuggestion };
    setExtraction(result.extraction);
    setSuggestion(result.suggestion);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><span className="dash-kicker">Sui Overflow · Walrus track</span><h1 className="dash-title mt-2">0xWal invoice-to-payment loop</h1><p className="mt-1 text-sm text-foreground/55">Private documents become verifiable, approval-ready payment intents.</p></div>
        <Link href="/dashboard/copilot" className="inline-flex items-center gap-2 rounded-xl border border-primary/20 bg-card px-4 py-2 text-sm font-black text-primary"><Bot className="h-4 w-4" /> Chat with 0xWal</Link>
      </header>
      <MemWalBehaviorCard />

      <Panel number="01" icon={FileUp} title="Upload invoice" subtitle="The original document is encrypted before it leaves the app.">
        <label className="flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-8 text-center">
          <FileUp className="h-8 w-8 text-primary" /><strong className="mt-3">{uploading ? 'Encrypting and storing...' : 'Drop or choose a PDF/image'}</strong><small className="mt-1 text-foreground/45">Demo defaults to Acme PH · $5,000 · due Jun 28</small>
          <input type="file" accept=".pdf,image/*" className="hidden" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">{invoices.map((invoice) => <button key={invoice.id} onClick={() => { setSelected(invoice); setExtraction(null); setSuggestion(null); }} className={`rounded-full px-3 py-1.5 text-xs font-black ${selected?.id === invoice.id ? 'bg-foreground text-card' : 'bg-muted/60 text-foreground/60'}`}>{invoice.payerOrgName ?? invoice.id}</button>)}</div>
      </Panel>

      <Panel number="02" icon={Database} title="Walrus proof" subtitle="Ciphertext-only storage with a durable blob identifier.">
        {selected?.walrusBlobId ? <div className="rounded-xl bg-muted/50 p-4"><div className="flex flex-wrap items-center gap-3"><Database className="h-5 w-5 text-primary" /><code className="min-w-0 flex-1 break-all text-xs font-bold">{selected.walrusBlobId}</code><button aria-label="Copy Walrus blob ID" onClick={() => { void navigator.clipboard.writeText(selected.walrusBlobId!); toast.success('Blob ID copied'); }}><Copy className="h-4 w-4" /></button>{proof?.mode === 'mock' ? <StatusBadge status="demo" /> : <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-black uppercase text-primary">Live</span>}</div>{proof && <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-foreground/50"><span>{proof.sizeBytes.toLocaleString()} encrypted bytes</span><span>{proof.epochs} epochs</span><span>{proof.mode} storage</span></div>}</div> : <p className="text-sm text-foreground/50">Select an invoice with a document proof or upload one above.</p>}
      </Panel>

      <Panel number="03" icon={Lock} title="Seal access policy" subtitle="Only named organisations and the auditor role can decrypt.">
        <div className="flex flex-wrap gap-2">{[selected?.issuerOrg, selected?.payerOrgEmail ?? selected?.payerOrgName, 'auditor'].filter(Boolean).map((identity) => <span key={identity} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-black text-primary">{identity}</span>)}</div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {['Splash Demo Ltd', 'unknown@org'].map((identity) => <button key={identity} disabled={!selected?.sealPolicyId} onClick={() => void checkAccess(identity)} className="flex items-center justify-between rounded-xl border border-foreground/10 bg-card p-3 text-left text-sm font-black"><span>Check access: {identity}</span>{access[identity] === true ? <CheckCircle2 className="h-5 w-5 text-primary" /> : access[identity] === false ? <XCircle className="h-5 w-5 text-accent" /> : <ShieldCheck className="h-5 w-5 text-foreground/30" />}</button>)}
        </div>
      </Panel>

      <Panel number="04" icon={Sparkles} title="0xWal extraction" subtitle="The copilot suggests a delivery route; the user must authorize execution.">
        <button disabled={!selected} onClick={() => void extract()} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-black text-card">Extract and recommend route</button>
        {extraction && suggestion && <div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-xl bg-muted/50 p-4 text-sm"><strong className="block">{extraction.recipient || selected?.payerOrgName}</strong><span className="mt-2 block">${extraction.amount.toLocaleString()} · {extraction.currency}</span><span className="mt-2 block font-black text-primary">{Math.round(suggestion.confidence * 100)}% confidence</span></div><div className="rounded-xl border border-accent/25 bg-accent/10 p-4 text-sm"><strong>{suggestion.title}</strong><p className="mt-2 text-foreground/60">{suggestion.description}</p><span className="mt-3 inline-block rounded-full bg-accent/15 px-2 py-1 text-[10px] font-black uppercase text-accent">Approval required</span></div></div>}
      </Panel>

      <Panel number="05" icon={ArrowRight} title="Create payment intent" subtitle="Carry the extracted invoice into the real delivery ladder and authorization flow.">
        <Link href={selected ? `/dashboard/transfer?invoiceId=${selected.id}` : '/dashboard/transfer'} className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-black text-card">Open payment intent <ArrowRight className="h-4 w-4" /></Link>
      </Panel>
    </div>
  );
}

function Panel({ number, icon: Icon, title, subtitle, children }: { number: string; icon: LucideIcon; title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="dash-surface p-5 md:p-6"><div className="flex items-start gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-foreground font-black text-card">{number}</span><div className="flex-1"><div className="flex items-center gap-2"><Icon className="h-5 w-5 text-primary" /><h2 className="text-lg font-black">{title}</h2></div><p className="mt-1 text-sm text-foreground/50">{subtitle}</p><div className="mt-5">{children}</div></div></div></section>;
}

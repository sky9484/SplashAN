'use client';

import { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, CheckCircle2, LockKeyhole } from 'lucide-react';

import StatusBadge from '@/components/StatusBadge';

type Memory = { text: string; confidence: number; demo: boolean };

export default function MemWalBehaviorCard({ compact = false }: { compact?: boolean }) {
  const [memories, setMemories] = useState<Memory[]>([]);

  useEffect(() => {
    let active = true;
    void fetch('/api/memwal/behaviors')
      .then((response) => response.json())
      .then((result: { memories?: Memory[] }) => {
        if (active) setMemories(Array.isArray(result.memories) ? result.memories : []);
      });
    return () => { active = false; };
  }, []);

  const displayMemories = useMemo(() => {
    const seen = new Set<string>();
    return memories.filter((memory) => {
      const normalized = typeof memory.text === 'string' ? memory.text.trim().toLowerCase() : '';
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }, [memories]);

  const memoryCards = displayMemories.length > 0
    ? displayMemories
    : [{ text: 'Recalling behavior patterns...', confidence: 0, demo: false }];

  return (
    <section className="dash-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-primary/10 p-2 text-primary"><BrainCircuit className="h-5 w-5" /></span>
          <div>
            <h2 className="font-black text-foreground">MemWal behavior memory</h2>
            <p className="mt-1 text-xs text-foreground/55">Safe operating patterns that sharpen suggestions.</p>
          </div>
        </div>
        {displayMemories.some((memory) => memory.demo) && <StatusBadge status="demo" />}
      </div>
      <div className={`mt-4 grid gap-2 ${compact ? '' : 'sm:grid-cols-3'}`}>
        {memoryCards.map((memory) => (
          <div key={memory.text.trim().toLowerCase()} className="rounded-xl bg-muted/55 p-3">
            <div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><strong className="text-sm">{memory.text}</strong></div>
            {memory.confidence > 0 && <div className="mt-2 text-[10px] font-black uppercase tracking-[0.12em] text-foreground/40">{Math.round(memory.confidence * 100)}% pattern confidence</div>}
          </div>
        ))}
      </div>
      <p className="mt-4 flex items-center gap-2 text-[11px] font-bold text-foreground/45"><LockKeyhole className="h-3.5 w-3.5" /> Behavioral text only. No amounts, accounts, or KYC data.</p>
    </section>
  );
}

import { NextResponse } from 'next/server';

import { recallMemories } from '@/lib/server/memwal';

const demoBehaviors = [
  'Pays PH suppliers weekly',
  'Batches on Friday',
  'Prefers USD settlement',
];

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const recalled = await recallMemories('business payment behavior patterns', 3);
    const seen = new Set<string>();
    const uniqueRecalled = recalled.filter((memory) => {
      const normalized = memory.text.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
    const recalledMemories = uniqueRecalled.map((memory) => ({
      text: memory.text,
      confidence: Math.max(0, 1 - memory.distance),
      demo: false,
    }));
    const fallbackMemories = demoBehaviors
      .filter((text) => !seen.has(text.toLowerCase()))
      .map((text, index) => ({ text, confidence: 0.94 - index * 0.03, demo: true }));
    const memories = [...recalledMemories, ...fallbackMemories].slice(0, 3);
    return NextResponse.json({ memories }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.warn('[memwal] behavior route fallback:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({
      memories: demoBehaviors.map((text, index) => ({ text, confidence: 0.94 - index * 0.03, demo: true })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
}

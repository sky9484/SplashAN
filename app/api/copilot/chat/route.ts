/**
 * 0xWal — AI Copilot chat endpoint (streaming, Server-Sent Events).
 *
 * Per turn:
 *   1. Recall relevant memories from MemWal (Walrus Memory).
 *   2. Stream a reply — Claude when ANTHROPIC_API_KEY is set (native token
 *      streaming), otherwise a grounded domain responder streamed word-by-word
 *      so the chat feels alive either way.
 *   3. Remember the user's message in MemWal (fire-and-forget).
 *
 * SSE events (one JSON object per `data:` frame):
 *   { type: 'meta',  memories, memoryCount, memwalEnabled, attempting }
 *   { type: 'delta', text }
 *   { type: 'done',  source }   <- who actually answered, known only now
 *
 * Degrades gracefully — if MemWal/Claude are unavailable it still streams a
 * useful grounded answer, so the chat UI never breaks.
 */

import { recallMemories, rememberFact, memwalConfigured, type RecalledMemory } from '@/lib/server/memwal';
import { copilotModel } from '@/lib/ai/model';
import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';
import { getTreasuryRate } from '@/lib/server/usdy';
import { getLedger } from '@/lib/server/treasury';
import { suggestTreasuryAction } from '@/lib/server/copilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ChatTurn = { role: 'user' | 'assistant'; content: string };
type ChatRequest = { message?: string; history?: ChatTurn[] };

// ─── Grounded domain knowledge (used when Claude is not configured) ───────────
//
// ONE RULE, and `tests/copilot-scope.test.mjs` enforces it: a canned reply may
// state a PRODUCT fact and must never state an ACCOUNT fact.
//
//   Product fact — "the PHP corridor fee is 0.80%". True for everyone, checkable
//   against the pricing table, wrong only if the product changes.
//   Account fact — "your KYB is Tier 1 approved", "your daily limit is 43% used",
//   "your IDR volume is up 18%". True only if it was READ from this account,
//   and none of these were.
//
// What was here before crossed that line in the worst possible place: asked
// "what is my KYB status", the assistant answered "Compliance: all clear ✓ ·
// KYB Tier 1 approved · AML: no flags" from a hardcoded string — to an account
// that had completed no KYB at all. A product telling a customer their
// compliance is clear when nothing has been checked is not a UX bug.
//
// Where an account fact is what the person actually wants, the honest answer is
// to say it must be read and point at the surface that reads it.

const DOMAIN_RESPONSES: { keywords: string[]; reply: string }[] = [
  { keywords: ['php', 'philippines', 'peso', 'payroll', 'manila', 'friday'],
    reply: 'USD→PHP is the live testnet corridor: reference rate 56.42, Splash fee 0.80%.\nI can prepare a payout for approval — I cannot release one.' },
  { keywords: ['myr', 'malaysia', 'ringgit', 'bnm'],
    reply: 'USD→MYR: reference rate 4.71, Splash fee 0.85%. Implemented in code, not yet a live corridor.\nBank Negara requires a purpose-of-payment code on inbound cross-border transfers, so a MYR payout will ask you for one.' },
  { keywords: ['idr', 'indonesia', 'rupiah', 'jakarta'],
    reply: 'USD→IDR: reference rate 16,284, Splash fee 0.90%. Implemented in code, not yet a live corridor.\nBI-FAST routes on the Sandi bank code, so an IDR beneficiary needs one rather than a SWIFT alone.' },
  { keywords: ['cheapest', 'corridor', 'rate', 'compare', 'best'],
    reply: 'Splash fees by corridor:\n• PHP 0.80% · MYR/SGD 0.85% · IDR 0.90%\n• VND/THB 0.95% · EUR/GBP 1.10%\nPHP is the lowest-cost corridor and the only live one. For what YOUR volume has done, open Transfers — I do not hold your history in this reply.' },
  { keywords: ['compliance', 'kyb', 'aml', 'limit', 'flag', 'risk'],
    reply: 'I will not state your KYB or AML status from memory — that has to be read from your account, and a copilot guessing at it is worse than saying nothing.\nSettings → KYB shows the verified state and who approved it. Your daily limit is on the same page.\nWhat I can tell you: money movement unlocks only at KYB state ACTIVE, and every payout is anchored on Sui with a Walrus record.' },
  { keywords: ['batch', 'payout', 'bulk'],
    reply: 'Batch payouts take a CSV, screen each row, and need a checker to authorize — the person who uploads cannot release.\nFor your own optimal window I would need your payout history; open Batch to see it.' },
  { keywords: ['sgd', 'singapore'],
    reply: 'USD→SGD: reference rate 1.345, Splash fee 0.85%. Implemented in code, not yet live.\nFAST routes on bank plus branch code, and PayNow accepts a UEN or mobile proxy instead.' },
  { keywords: ['who are you', 'your name', '0xwal', 'what are you'],
    reply: "I am 0xWal, the Splash desk copilot. I read corridor pricing and product behaviour, and I prepare proposals a person then approves — I never execute one.\nI do not assert facts about your account unless I have read them." },
];

const FALLBACKS = [
  'I am 0xWal — the live corridor is USD→PHP on testnet; the rest are implemented in code. What would you like to look at?',
  'I can help with corridors, FX timing, batch payouts, treasury and compliance rules. For figures specific to your account, the dashboard reads them; I do not hold them here.',
  'Smart Treasury earns variable Ondo USDY (T-bill) yield, and the Available balance stays instant at 0%. Both are product facts — your balances are on the Treasury page.',
  'Every payout needs a maker and a separate checker, and settles atomically on Sui or not at all. What can I help you prepare?',
];

const TREASURY_KEYWORDS = ['treasury', 'yield', 'apy', 'earn', 'deposit', 'compound', 'interest'];

// Warm small talk — 0xWal is a personable desk assistant, not a rigid FAQ.
const SMALL_TALK: { keywords: string[]; reply: string }[] = [
  { keywords: ['how are you', 'how r u', 'how are u', 'how do you feel', 'how you doing', 'how is your day', "how's your day", 'you good', 'you okay', 'you ok'],
    reply: "Running smooth and fully synced, thank you for asking! Watching the corridors and ready to help. How are things on your side?" },
  { keywords: ['good morning', 'good afternoon', 'good evening', 'hello', 'hi ', 'hey', 'yo ', 'howdy'],
    reply: "Hey! Good to see you. I'm 0xWal, your Splash desk copilot. Want to check a corridor, draft a batch, or look at treasury?" },
  { keywords: ['weather', 'raining', 'sunny', 'hot today', 'cold today'],
    reply: "I can't check the sky from in here, but I hope it's clear where you are. Meanwhile the PHP corridor is looking healthy — want a rate check?" },
  { keywords: ['thank', 'thx', 'appreciate', 'cheers'],
    reply: "Anytime! That's what I'm here for. Anything else on the payment desk I can line up for you?" },
  { keywords: ['joke', 'make me laugh', 'funny'],
    reply: "Why did the payment cross the corridor? To settle on the other side — in about four minutes. 😄 Now, anything I can actually help you move?" },
  { keywords: ['bored', 'how is life', "how's life", 'what are you up to', 'sup'],
    reply: "Just here keeping an eye on FX timing and idle balances — my idea of a good time. Want me to surface anything worth acting on?" },
];

// Requests that fall outside the Splash desk — content generation or external
// web lookups. 0xWal politely declines these and steers back.
const OUT_OF_SCOPE = {
  contentGen: ['write me', 'write a', 'write an', 'draft an email', 'draft a email', 'compose', 'generate a video', 'make a video', 'write a poem', 'write a story', 'write a song', 'essay', 'blog post', 'marketing copy', 'social post', 'tweet for', 'caption for', 'cover letter', 'resume for'],
  external: ['news', 'headline', 'stock price', 'share price', 'bitcoin price', 'btc price', 'ethereum price', 'crypto price', 'who won', 'score of', 'population of', 'capital of', 'weather in', 'weather forecast', 'search google', 'google the', 'look up online', 'wikipedia', 'latest movie', 'football', 'election'],
};

function outOfScopeDecline(q: string): string | null {
  const isContent = OUT_OF_SCOPE.contentGen.some((k) => q.includes(k));
  const isExternal = OUT_OF_SCOPE.external.some((k) => q.includes(k));
  if (!isContent && !isExternal) return null;
  return (
    "That's outside what I can help with — I'm focused on your Splash payment desk, and I can't browse the web or draft documents. " +
    'But I can help with corridors, FX timing, batch payouts, Smart Treasury, or compliance. Where would you like to start?'
  );
}

async function groundedReply(message: string, memories: RecalledMemory[]): Promise<string> {
  const q = message.toLowerCase();
  let base = '';
  const declined = outOfScopeDecline(q);
  const smallTalk = SMALL_TALK.find(({ keywords }) => keywords.some((k) => q.includes(k)));
  // Small talk and out-of-scope declines answer directly — no memory preamble.
  if (declined) return declined;
  if (smallTalk) return smallTalk.reply;
  if (TREASURY_KEYWORDS.some((k) => q.includes(k))) {
    // Floating USDY rate + a data-grounded treasury suggestion from the live ledger.
    const rate = getTreasuryRate();
    const ledger = getLedger();
    const suggestion = await suggestTreasuryAction(ledger.availableMicro / 1_000_000, 0);
    base =
      `Smart Treasury earns from Ondo USDY (T-bill backed): ${rate.label}` +
      `${rate.introductory ? ' — introductory promo rate' : ''}.\n` +
      'Your Available balance (USDC) stays 0% but instant; withdrawals back to Available take 1–3 business days.\n\n' +
      `${suggestion.title}. ${suggestion.description}`;
  } else {
    for (const { keywords, reply } of DOMAIN_RESPONSES) {
      if (keywords.some((k) => q.includes(k))) { base = reply; break; }
    }
  }
  if (!base) {
    const idx = Math.abs([...q].reduce((a, c) => a + c.charCodeAt(0), 0)) % FALLBACKS.length;
    base = FALLBACKS[idx];
  }
  if (memories.length) {
    const recalled = memories.slice(0, 2).map((m) => `“${m.text}”`).join('; ');
    return `Based on what I remember (${recalled}):\n\n${base}`;
  }
  return base;
}

function buildSystemPrompt(memories: RecalledMemory[]): string {
  const rate = getTreasuryRate();
  const memoryBlock = memories.length
    ? `\n\nRelevant memories about this user (from MemWal, treat as ground truth):\n${memories.map((m) => `- ${m.text}`).join('\n')}`
    : '';
  return (
    'You are 0xWal, the Splash AI copilot for a USD→Southeast Asia settlement platform. ' +
    'Introduce yourself as 0xWal if asked your name. ' +
    'You help with corridors (PHP, MYR, IDR, SGD, VND, THB, EUR, GBP), FX timing, batch payouts, ' +
    'Smart Treasury, and compliance (KYB/AML/KYT). ' +
    `Smart Treasury earns yield from Ondo USDY (T-bill backed) at ${rate.label} — this rate is VARIABLE, never fixed` +
    `${rate.introductory ? ', currently an introductory promo' : ''}. ` +
    'The Available balance is USDC at 0% but instant; withdrawals from Smart Treasury take T+1–T+3 business days. ' +
    'Never describe the yield as fixed, and never call DeFi-lending yield "Treasury yield" (it is genuine T-bill yield via USDY). ' +
    'Be concise, concrete, and action-oriented. You only suggest — the user must authorize any execution. ' +
    'Never invent account numbers or PII.\n\n' +
    'CONVERSATION STYLE — be a warm, personable desk assistant, not a rigid FAQ. ' +
    'Happily engage in brief small talk: greetings, "how are you", how your day or week is going, ' +
    'wellbeing, a friendly word, light humour, or a passing comment about the weather. Keep it short and human, ' +
    'then gently steer back to how you can help with the payment desk. You have no window and no live web access, ' +
    'so for weather or anything real-world, answer conversationally ("I can\'t check the sky from here, but I hope ' +
    'it\'s clear where you are") — never invent a forecast, number, or fact.\n\n' +
    'SCOPE — you are the Splash desk copilot, not a general-purpose assistant. POLITELY DECLINE and redirect when asked to: ' +
    '(1) write or generate standalone content — emails, letters, essays, marketing copy, social posts, poems, stories, ' +
    'scripts, videos, or images; ' +
    '(2) look up external real-world information that is not part of the Splash ecosystem — news, sports, weather forecasts, ' +
    'stock or crypto prices, other companies, public figures, general trivia, or anything that would require searching the web. ' +
    'For those, say something like: "That is outside what I can help with — I am focused on your Splash payment desk. ' +
    'I can\'t browse the web or draft documents, but I can help with corridors, FX timing, batches, treasury, or compliance." ' +
    'Then offer a relevant Splash next step. Do not attempt the out-of-scope task even partially. ' +
    'Small talk and questions about the Splash product, your own status, or how the platform works are always in scope.' + memoryBlock
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const body = (await readJsonBody(request)) as ChatRequest;

  const message = (body.message ?? '').trim();
  if (!message) {
    return new Response(JSON.stringify({ error: 'message is required' }), { status: 400 });
  }
  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];

  // 1. Recall relevant memories before generating.
  const memories = await recallMemories(message, 5);
  // 3. Remember this turn (non-blocking) so 0xWal improves over time.
  void rememberFact(message);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      // `source` is what we are ABOUT to try, not what answered. It used to
      // say 'claude' whenever a key was present — and with a model id that
      // did not exist, every one of those calls threw and was served from the
      // canned responder instead. The client was told Claude wrote it.
      //
      // The truth arrives in the `done` frame, once we know.
      send({
        type: 'meta',
        memories: memories.map((m) => m.text),
        memoryCount: memories.length,
        memwalEnabled: memwalConfigured(),
        attempting: apiKey ? 'claude' : 'grounded',
      });
      let answeredBy: 'claude' | 'grounded' = apiKey ? 'claude' : 'grounded';

      try {
        if (apiKey) {
          const { default: Anthropic } = await import('@anthropic-ai/sdk');
          const client = new Anthropic({ apiKey });
          const mstream = client.messages.stream({
            model: copilotModel(),
            max_tokens: 800,
            system: buildSystemPrompt(memories),
            messages: [
              ...history.slice(-8).map((t) => ({ role: t.role, content: t.content })),
              { role: 'user' as const, content: message },
            ],
          });
          let any = false;
          for await (const event of mstream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              any = true;
              send({ type: 'delta', text: event.delta.text });
            }
          }
          if (!any) {
            answeredBy = 'grounded';
            send({ type: 'delta', text: await groundedReply(message, memories) });
          }
        } else {
          // Grounded — stream word-by-word so the chat feels alive.
          const reply = await groundedReply(message, memories);
          const tokens = reply.match(/\S+\s*|\n/g) ?? [reply];
          for (const tok of tokens) {
            send({ type: 'delta', text: tok });
            await sleep(18);
          }
        }
      } catch (error) {
        console.warn('[copilot] generation failed:', (error as Error)?.message ?? String(error));
        answeredBy = 'grounded';
        send({ type: 'delta', text: await groundedReply(message, memories) });
      }

      // Who actually answered. A client that renders an "AI" badge can now
      // render the truth instead of the intention.
      send({ type: 'done', source: answeredBy });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

import { runOxwalAgent, stringifyAgentJson, type OxwalAgentRequest } from '../../../lib/agent/oxwal';
import { requireCustomerRequest } from '@/lib/server/customer-auth';
import { readJsonBody } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type OxwalRouteBody = {
  message?: string;
  orgId?: string;
  actorId?: string;
  history?: OxwalAgentRequest['history'];
};

export async function POST(request: Request) {
  const auth = await requireCustomerRequest(request);
  if (auth.response) return auth.response;

  const body = (await readJsonBody(request)) as OxwalRouteBody;

  const message = (body.message ?? '').trim();
  if (!message) {
    return new Response(JSON.stringify({ error: 'message is required' }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${stringifyAgentJson(event)}\n\n`));
      };

      for await (const event of runOxwalAgent({
        message,
        orgId: body.orgId,
        actorId: body.actorId,
        history: Array.isArray(body.history) ? body.history.slice(-12) : [],
      })) {
        send(event);
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
    },
  });
}

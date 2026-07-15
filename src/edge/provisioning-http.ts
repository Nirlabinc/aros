import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EdgeProvisioningService, ProvisioningAuth } from './provisioning.js';

const reply = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const part=Buffer.from(chunk); size+=part.length; if(size>32_768) throw new Error('BODY_TOO_LARGE'); chunks.push(part); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

export async function handleEdgeProvisioningRequest(
  req: IncomingMessage, res: ServerResponse, pathname: string, auth: ProvisioningAuth, service: EdgeProvisioningService,
): Promise<boolean> {
  try {
    if (pathname === '/api/edge/activation-codes' && req.method === 'POST') {
      const input = await body(req);
      if (typeof input.storeId !== 'string' || (input.connectorId !== undefined && typeof input.connectorId !== 'string')) {
        reply(res, 400, { error: 'invalid_activation_request' }); return true;
      }
      reply(res, 201, await service.createActivationCode(auth, {
        storeId: input.storeId, connectorId: input.connectorId as string | undefined,
        expiresInMinutes: input.expiresInMinutes as number | undefined,
        setup: input.setup as any,
      })); return true;
    }
    if (pathname === '/api/edge/devices' && req.method === 'GET') {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      reply(res, 200, { devices: await service.listDevices(auth, url.searchParams.get('storeId') ?? undefined) }); return true;
    }
    if (pathname === '/api/edge/onboarding/status' && req.method === 'GET') {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const storeId = url.searchParams.get('storeId');
      if (!storeId) { reply(res, 400, { error: 'store_id_required' }); return true; }
      reply(res, 200, await service.onboardingStatus(auth, storeId)); return true;
    }
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'EDGE_FORBIDDEN') reply(res, 403, { error: 'insufficient_role' });
    else if (message === 'EDGE_STORE_NOT_FOUND' || message === 'EDGE_CONNECTOR_NOT_FOUND') reply(res, 404, { error: 'resource_not_found' });
    else if (message === 'EDGE_INVALID_EXPIRY') reply(res, 400, { error: 'invalid_expiry' });
    else if (message === 'EDGE_INVALID_SETUP') reply(res, 400, { error: 'invalid_setup_preferences' });
    else if (message === 'BODY_TOO_LARGE') reply(res, 413, { error: 'payload_too_large' });
    else if (error instanceof SyntaxError) reply(res, 400, { error: 'invalid_json' });
    else reply(res, 500, { error: 'edge_provisioning_failure' });
    return true;
  }
}

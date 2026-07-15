import type { IncomingMessage } from 'node:http';

export function getTrustedClientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();
    const forwarded = req.headers['x-forwarded-for'];
    const values = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded || '')
      .split(',').map((value) => value.trim()).filter(Boolean);
    if (values.length) return values[values.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

export function isPublicRouterPath(pathname: string): boolean {
  const normalized = pathname.replace(/^\/api(?=\/v1\/)/, '');
  return normalized === '/v1/chat'
    || normalized === '/v1/chat/public'
    || normalized === '/v1/demo/enable'
    || normalized === '/v1/demo/activation';
}

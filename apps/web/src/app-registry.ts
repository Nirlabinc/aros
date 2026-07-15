export const AROS_APPS = [
  { id:'storepulse', name:'StorePulse', url:'https://storepulse.aros.live', repo:'Shreai/shreai/apps/storepulse-ui', scopes:['stores:read','pos:read'], vault:'shre/aros/storepulse-ui' },
  { id:'storepulse-hq', name:'StorePulse HQ', url:'https://storepulse-hq.aros.live', repo:'Planned/control-plane package — canonical repo pending', scopes:['stores:read','fleet:read'], vault:'shre/aros/storepulse-hq' },
  { id:'cpg', name:'CPG Intelligence', url:'https://cpg.aros.live', repo:'Nirpat3/cpg-intelligence', scopes:['cpg:read','stores:read'], vault:'nirlab/cpg-intelligence' },
  { id:'mib', name:'MIB', url:'https://mib.aros.live', repo:'Shreai/shre-command-center (legacy Nirpat3/MIB)', scopes:['workspace:admin'], vault:'shre/mib' },
  { id:'centrix', name:'Centrix', url:'https://centrix.aros.live', repo:'Nirpat3/centrix', scopes:['crm:read','tickets:write'], vault:'nirlab/centrix' },
  { id:'rapidsupport', name:'RapidSupport', url:'https://rapidsupport.aros.live', repo:'Nirlabinc/RapidSupport', scopes:['support:read','support:write'], vault:'nirlab/rapidsupport' },
  { id:'aichatbot', name:'AI Call Bot', url:'https://aichatbot.aros.live', repo:'Nirpat3/ai-call-assistant', scopes:['calls:read','calls:write'], vault:'nirlab/ai-call-assistant' },
] as const;

const ALLOWED_RETURN_HOSTS = new Set(['app.aros.live', ...AROS_APPS.map(app => new URL(app.url).hostname)]);
export function safeReturnTo(value: string | null): string {
  if (!value) return '/dashboard';
  try { const target = new URL(value, window.location.origin); return target.protocol === 'https:' && ALLOWED_RETURN_HOSTS.has(target.hostname) ? target.toString() : '/dashboard'; }
  catch { return '/dashboard'; }
}

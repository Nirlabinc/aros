// ── RapidRMS EDI Connector ──────────────────────────────────────
// Native EDI invoice API exposed by RapidRMS on the SAME host + SAME auth as
// the rest of its API. We reuse the existing RapidRMS connector session (no new
// login): the EDI endpoints accept the identical Bearer token + DbName +
// ClientId that authenticate() already obtains via POST /api/Login/Auth.
//
// Environment note: EDI defaults to STAGING. Because staging needs staging
// credentials, we authenticate against the SAME base URL we query — see
// resolveEdiBaseUrl + buildEdiSession. A per-request override is honored ONLY
// in non-production and only for allow-listed hosts (SSRF guard).

import type { RapidRmsApiConfig, RapidRmsSession } from './types.js';
import { authenticate, request } from './rapidrms-api.js';

// ── Base-URL resolution + SSRF allowlist ────────────────────────

/** Staging default. EDI is staging-first; prod is opt-in via env/override. */
export const EDI_STAGING_BASE_URL = 'http://rapidrmsapi-staging.azurewebsites.net';

/** Hosts an EDI base URL may point at. Anything else is rejected (SSRF guard). */
export const EDI_ALLOWED_HOSTS = new Set([
  'rapidrmsapi.azurewebsites.net',
  'rapidrmsapi-staging.azurewebsites.net',
]);

/** True when `candidate` is a well-formed http(s) URL whose host is allow-listed. */
export function isAllowedEdiBaseUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return EDI_ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Resolve the EDI base URL to use for BOTH auth and EDI calls (same env end to
 * end). Precedence:
 *   1. validated dev override  (only when allowOverride && allow-listed)
 *   2. RAPIDRMS_EDI_BASE_URL env
 *   3. staging default
 * A per-request override is only consulted when `allowOverride` is true
 * (callers pass `NODE_ENV !== 'production'`); in prod the override is ignored.
 * The env default is operator-controlled and trusted, but falls back to staging
 * if it is not a valid URL.
 */
export function resolveEdiBaseUrl(
  override?: string | null,
  opts: { allowOverride?: boolean } = {},
): string {
  const allowOverride = opts.allowOverride ?? process.env.NODE_ENV !== 'production';
  if (allowOverride && override && isAllowedEdiBaseUrl(override)) {
    return normalizeBaseUrl(override);
  }
  const envDefault = process.env.RAPIDRMS_EDI_BASE_URL?.trim();
  if (envDefault) {
    try {
      // Trust the operator env var (not user-controlled), but require a valid URL.
      // eslint-disable-next-line no-new
      new URL(envDefault);
      return normalizeBaseUrl(envDefault);
    } catch {
      /* fall through to staging */
    }
  }
  return EDI_STAGING_BASE_URL;
}

// ── EDI session ─────────────────────────────────────────────────

/**
 * Build an EDI session by authenticating against `ediBaseUrl` with the tenant's
 * stored RapidRMS email/password refs + clientId. The resulting session's
 * config.baseUrl is the EDI base URL, so request() targets the same env for
 * every EDI call (auth + data hit the same host).
 */
export async function buildEdiSession(input: {
  clientId: string;
  sessionTimeout?: number;
  emailRef: string;
  passwordRef: string;
  ediBaseUrl: string;
}): Promise<RapidRmsSession> {
  const config: RapidRmsApiConfig = {
    baseUrl: normalizeBaseUrl(input.ediBaseUrl),
    clientId: input.clientId,
    sessionTimeout: input.sessionTimeout || 420,
  };
  return authenticate(config, input.emailRef, input.passwordRef);
}

// ── EDI data shapes ─────────────────────────────────────────────

export interface EdiFile {
  edi_Id: number;
  fileName: string;
  uploadDate: string;
  supplier: string;
  fileType: string;
  status: string;
  receiveId: number;
  userName: string;
  createdBy: string;
}

export interface EdiUpload {
  EDIId: number; // 0 = new
  BranchId: number;
  FileName: string;
  UploadDate: string;
  Comment?: string;
  Supplier: string;
  FileType: string;
  CreatedBy: string;
  CreatedDate: string;
  IsExistingPO?: boolean;
  InvoiceNo: string;
  Status?: string;
  InvoiceAmount: number;
}

export interface EdiReceiveItem {
  Description: string;
  ItemNo?: string;
  Quantity: number;
  CaseQtyRecived: number;
  PackQtyReceived: number;
  Cost: number;
  Price: number;
  UPC?: string;
  CaseUPC?: string;
  PackUPC?: string;
  CaseCost: number;
  PackCost: number;
  CasePrice: number;
  PackPrice: number;
  CaseQty: number;
  PackQty: number;
  CreateDate: string;
  UserID: number;
  RegisterId: number;
  IsDeleted: boolean;
  ItemCode?: string;
  IsNewItem?: boolean;
  Deptid: number;
  SubDeptid: number;
  Categoryid: number;
}

export interface EdiUploadPayload {
  EDIUpload: EdiUpload;
  EDIReceiveItem: EdiReceiveItem[];
}

export interface EdiItemDetail {
  description: string;
  itemNo: string;
  quantity: number;
  caseQtyReceived: number;
  packQtyReceived: number;
  cost: number;
  price: number;
  upc: string;
  caseUPC: string;
  packUPC: string;
  caseCost: number;
  packCost: number;
  casePrice: number;
  packPrice: number;
  caseQty: number;
  packQty: number;
  createDate: string;
  userID: number;
  registerId: number;
  isDeleted: boolean;
  isNewItem: boolean;
  deptid: number;
  subDeptid: number;
  categoryid: number;
}

/** Upload / revert result. `status` is 'Success' | 'Fail'; surface `message` on Fail. */
export interface EdiWriteResult {
  status: string;
  message: string;
  /** Upload returns the new receiveId here; revert has no data payload. */
  data?: number;
}

// The EDI list + item-detail endpoints are NOT the {code:'999'} envelope.
// request() runs unwrapEnvelope, which returns the body unchanged when
// code !== '999', so `body.data` is intact.
interface EdiListEnvelope {
  isError?: number;
  data?: EdiFile[];
}
interface EdiItemsEnvelope {
  isError?: number;
  data?: EdiItemDetail[];
}

// ── EDI operations ──────────────────────────────────────────────

/** LIST — GET /api/EDI → { isError, data:[EdiFile] }. Reads body.data directly. */
export async function listEdiFiles(session: RapidRmsSession): Promise<EdiFile[]> {
  const body = (await request(session, 'GET', '/api/EDI')) as EdiListEnvelope;
  return Array.isArray(body?.data) ? body.data : [];
}

/** UPLOAD — POST /api/EDI { EDIUpload, EDIReceiveItem } → { status, message, data:<receiveId> }. */
export async function uploadEdi(
  session: RapidRmsSession,
  payload: EdiUploadPayload,
): Promise<EdiWriteResult> {
  const body = (await request(session, 'POST', '/api/EDI', payload as unknown as Record<string, unknown>)) as EdiWriteResult;
  return {
    status: String(body?.status ?? ''),
    message: String(body?.message ?? ''),
    data: typeof body?.data === 'number' ? body.data : Number(body?.data) || undefined,
  };
}

/** ITEM DETAILS — GET /api/EDI/{ReceiveId} → { isError, data:[EdiItemDetail] }. */
export async function getEdiItems(
  session: RapidRmsSession,
  receiveId: number,
): Promise<EdiItemDetail[]> {
  const body = (await request(session, 'GET', `/api/EDI/${encodeURIComponent(String(receiveId))}`)) as EdiItemsEnvelope;
  return Array.isArray(body?.data) ? body.data : [];
}

/**
 * REVERT — POST /api/EDI/Revert { RecieveId, BranchId } → { status, message }.
 * NOTE: the key is intentionally the misspelled "RecieveId" — that is what the
 * real RapidRMS API expects. Do not "correct" it.
 */
export async function revertEdi(
  session: RapidRmsSession,
  input: { receiveId: number; branchId: number },
): Promise<EdiWriteResult> {
  const body = (await request(session, 'POST', '/api/EDI/Revert', {
    RecieveId: input.receiveId, // misspelling required by the API — keep as-is
    BranchId: input.branchId,
  })) as EdiWriteResult;
  return { status: String(body?.status ?? ''), message: String(body?.message ?? '') };
}

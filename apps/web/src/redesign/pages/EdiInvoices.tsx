// ── RapidRMS EDI Invoices ────────────────────────────────────────
// Section page for the native RapidRMS EDI invoice API. Reuses the tenant's
// existing RapidRMS connector login (the server re-authenticates on the user's
// behalf) — the browser never handles a RapidRMS token. Three screens: a list
// table, an invoice detail (header + line items + Revert), and an Upload modal.
// Dev-only base-URL control lets a developer target staging vs prod; the server
// re-validates every target against its allowlist.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../../contexts/AuthContext';

// ── Types (mirror connectors/rapidrms-edi.ts) ───────────────────

interface EdiFile {
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

interface EdiItemDetail {
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

interface EdiWriteResponse { status: string; message: string; receiveId?: number | null }

// ── API client (mirrors pages/connections/api.ts conventions) ───

type AuthScope = { accessToken?: string; tenantId?: string; apiUrl?: string | null };

const apiBase = () => (window as Window & { __AROS_API_URL__?: string }).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

// Allow-listed EDI targets — must match the server's SSRF allowlist. The dev
// picker only ever offers these; the server re-validates regardless.
const EDI_STAGING_BASE_URL = 'http://rapidrmsapi-staging.azurewebsites.net';
const EDI_PROD_BASE_URL = 'https://rapidrmsapi.azurewebsites.net';

function headers(auth: AuthScope): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
    ...(auth.tenantId ? { 'X-AROS-Tenant-Id': auth.tenantId } : {}),
  };
}

/** Append the dev override as a query param (GET) — server ignores it in prod. */
function withApiUrl(path: string, auth: AuthScope): string {
  if (!auth.apiUrl) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}apiUrl=${encodeURIComponent(auth.apiUrl)}`;
}

async function request<T>(path: string, auth: AuthScope, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, { ...init, headers: { ...headers(auth), ...init.headers } });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function listEdi(auth: AuthScope): Promise<EdiFile[]> {
  return (await request<{ files?: EdiFile[] }>(withApiUrl('/api/rapidrms/edi', auth), auth)).files || [];
}
async function fetchEdiItems(auth: AuthScope, receiveId: number): Promise<EdiItemDetail[]> {
  return (await request<{ items?: EdiItemDetail[] }>(withApiUrl(`/api/rapidrms/edi/${receiveId}`, auth), auth)).items || [];
}
async function uploadEdi(auth: AuthScope, payload: Record<string, unknown>): Promise<EdiWriteResponse> {
  return request<EdiWriteResponse>('/api/rapidrms/edi', auth, {
    method: 'POST', body: JSON.stringify({ ...payload, ...(auth.apiUrl ? { apiUrl: auth.apiUrl } : {}) }),
  });
}
async function revertEdi(auth: AuthScope, receiveId: number, branchId: number): Promise<EdiWriteResponse> {
  return request<EdiWriteResponse>('/api/rapidrms/edi/revert', auth, {
    method: 'POST', body: JSON.stringify({ receiveId, branchId, ...(auth.apiUrl ? { apiUrl: auth.apiUrl } : {}) }),
  });
}

// ── Helpers ─────────────────────────────────────────────────────

const isReceived = (status: string) => /success|received|complete/i.test(status);
function pill(status: string): 'on' | 'warn' | 'off' {
  if (isReceived(status)) return 'on';
  if (/fail|error|revert/i.test(status)) return 'off';
  return 'warn';
}
function fmtDate(value: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
const money = (n: number) => (Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00');

// ── Line-item form model ────────────────────────────────────────

interface LineItemForm { Description: string; ItemNo: string; UPC: string; Quantity: string; Cost: string; Price: string; CaseQty: string; PackQty: string }
const emptyLine = (): LineItemForm => ({ Description: '', ItemNo: '', UPC: '', Quantity: '1', Cost: '0', Price: '0', CaseQty: '0', PackQty: '0' });

// ============================================================================

export function EdiInvoices() {
  const { session, tenant, user } = useAuth();
  const devMode = import.meta.env.DEV;
  const [apiUrl, setApiUrl] = useState<string>(EDI_STAGING_BASE_URL);
  const auth = useMemo<AuthScope>(
    () => ({ accessToken: session?.access_token, tenantId: tenant?.id, apiUrl: devMode ? apiUrl : null }),
    [session?.access_token, tenant?.id, devMode, apiUrl],
  );

  const [files, setFiles] = useState<EdiFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<EdiFile | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setFiles(await listEdi(auth)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load EDI invoices'); }
    finally { setLoading(false); }
  }, [auth]);
  useEffect(() => { void load(); }, [load]);

  const devBar = devMode && (
    <div className="edi-devbar">
      <span className="edi-devbar__label">Dev · API target</span>
      <select value={apiUrl} onChange={e => setApiUrl(e.target.value)} aria-label="EDI API base URL">
        <option value={EDI_STAGING_BASE_URL}>Staging — rapidrmsapi-staging.azurewebsites.net</option>
        <option value={EDI_PROD_BASE_URL}>Production — rapidrmsapi.azurewebsites.net</option>
      </select>
    </div>
  );

  // ── Detail screen ──────────────────────────────────────────────
  if (selected) {
    return (
      <EdiDetail
        file={selected}
        auth={auth}
        devBar={devBar}
        onBack={() => setSelected(null)}
        onReverted={() => { setSelected(null); void load(); }}
      />
    );
  }

  // ── List screen ────────────────────────────────────────────────
  return (
    <div className="rsx-panel">
      <div className="rsx-panel__head">
        <div>
          <div className="rsx-panel__eyebrow">RapidRMS</div>
          <p className="rsx-panel__lead">Electronic supplier invoices from RapidRMS. Open one to review its received line items, or upload a new EDI file. Credentials are reused from your RapidRMS connection — no separate sign-in.</p>
        </div>
        <button className="rsx-panel__cta" type="button" onClick={() => setUploadOpen(true)}>Upload invoice</button>
      </div>

      {devBar}

      {error && (
        <div className="rsx-note" role="alert" style={{ borderColor: 'var(--danger-line)', background: 'var(--danger-soft)' }}>
          <div className="rsx-note__title" style={{ color: 'var(--danger-ink)' }}>Could not reach RapidRMS EDI</div>
          <div className="rsx-note__body" style={{ color: 'var(--danger-ink)' }}>{error}</div>
          <button className="rsx-row__btn" style={{ marginTop: 10 }} onClick={() => void load()}>Retry</button>
        </div>
      )}

      <div className="edi-toolbar">
        <span className="rsx-panel__eyebrow" style={{ margin: 0 }}>{files.length} invoice{files.length === 1 ? '' : 's'}</span>
        <span className="edi-toolbar__spacer" />
        <button className="rsx-row__btn" type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {loading ? (
        <div className="rsx2-empty"><div className="rsx2-empty__text">Loading EDI invoices…</div></div>
      ) : files.length === 0 && !error ? (
        <div className="rsx2-empty">
          <div className="rsx2-empty__icon">◇</div>
          <div className="rsx2-empty__title">No EDI invoices yet</div>
          <div className="rsx2-empty__text">Supplier invoices received through RapidRMS EDI appear here. Upload one to get started.</div>
          <button className="rsx-panel__cta" onClick={() => setUploadOpen(true)}>Upload invoice</button>
        </div>
      ) : (
        <div className="edi-tablewrap">
          <table className="rsx2-table">
            <thead>
              <tr>
                <th>File</th><th>Supplier</th><th>Type</th><th>Status</th><th>Uploaded</th><th>Received by</th>
              </tr>
            </thead>
            <tbody>
              {files.map(f => (
                <tr
                  key={`${f.edi_Id}-${f.receiveId}`}
                  className="edi-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(f)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(f); } }}
                >
                  <td className="edi-cell--wrap" style={{ fontWeight: 600 }}>{f.fileName || `Invoice #${f.receiveId}`}</td>
                  <td>{f.supplier || '—'}</td>
                  <td><span className="edi-badge">{f.fileType || '—'}</span></td>
                  <td><span className={`rsx-pill rsx-pill--${pill(f.status)}`}>{f.status || 'Unknown'}</span></td>
                  <td>{fmtDate(f.uploadDate)}</td>
                  <td>{f.userName || f.createdBy || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {uploadOpen && (
        <EdiUploadModal
          auth={auth}
          defaultCreatedBy={user?.email || (user as { user_metadata?: { name?: string } } | null)?.user_metadata?.name || ''}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => { setUploadOpen(false); void load(); }}
        />
      )}
    </div>
  );
}

// ── Detail screen ────────────────────────────────────────────────

function EdiDetail({ file, auth, devBar, onBack, onReverted }: {
  file: EdiFile; auth: AuthScope; devBar: React.ReactNode; onBack: () => void; onReverted: () => void;
}) {
  const [items, setItems] = useState<EdiItemDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revertOpen, setRevertOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    fetchEdiItems(auth, file.receiveId)
      .then(rows => { if (alive) setItems(rows); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not load line items'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [auth, file.receiveId]);

  const totalCost = items.reduce((sum, it) => sum + (Number(it.cost) || 0) * (Number(it.quantity) || 0), 0);

  return (
    <div className="rsx-panel">
      <div className="edi-toolbar">
        <button className="rsx-row__btn" type="button" onClick={onBack}>← Back to invoices</button>
        <span className="edi-toolbar__spacer" />
        <button className="rsx-row__btn" type="button" onClick={() => setRevertOpen(true)} style={{ borderColor: 'var(--danger-line)', color: 'var(--danger-ink)' }}>Revert receiving</button>
      </div>

      {devBar}

      <div className="rsx-panel__head" style={{ marginBottom: 12 }}>
        <div>
          <div className="rsx-panel__eyebrow">EDI invoice</div>
          <p className="rsx-panel__lead" style={{ fontSize: 18, color: 'var(--ink)', fontWeight: 600 }}>{file.fileName || `Invoice #${file.receiveId}`}</p>
        </div>
        <span className={`rsx-pill rsx-pill--${pill(file.status)}`} style={{ marginLeft: 'auto' }}>{file.status || 'Unknown'}</span>
      </div>

      <div className="edi-detail__grid">
        <div className="edi-field"><div className="edi-field__label">Supplier</div><div className="edi-field__value">{file.supplier || '—'}</div></div>
        <div className="edi-field"><div className="edi-field__label">File type</div><div className="edi-field__value">{file.fileType || '—'}</div></div>
        <div className="edi-field"><div className="edi-field__label">Receive ID</div><div className="edi-field__value">{file.receiveId}</div></div>
        <div className="edi-field"><div className="edi-field__label">Uploaded</div><div className="edi-field__value">{fmtDate(file.uploadDate)}</div></div>
        <div className="edi-field"><div className="edi-field__label">Received by</div><div className="edi-field__value">{file.userName || file.createdBy || '—'}</div></div>
      </div>

      {error && (
        <div className="edi-banner edi-banner--fail" role="alert">{error}</div>
      )}

      {loading ? (
        <div className="rsx2-empty"><div className="rsx2-empty__text">Loading line items…</div></div>
      ) : items.length === 0 && !error ? (
        <div className="rsx2-empty">
          <div className="rsx2-empty__icon">◇</div>
          <div className="rsx2-empty__title">No line items</div>
          <div className="rsx2-empty__text">This receiving has no line items to show.</div>
        </div>
      ) : (
        <div className="edi-tablewrap">
          <table className="rsx2-table">
            <thead>
              <tr>
                <th>Description</th><th>Item #</th><th>UPC</th><th className="edi-num">Qty</th>
                <th className="edi-num">Cost</th><th className="edi-num">Price</th><th className="edi-num">Case / Pack</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={`${it.itemNo || it.upc || 'row'}-${i}`}>
                  <td className="edi-cell--wrap" style={{ fontWeight: 600 }}>{it.description || '—'}{it.isNewItem ? <span className="edi-badge" style={{ marginLeft: 8 }}>New</span> : null}</td>
                  <td>{it.itemNo || '—'}</td>
                  <td>{it.upc || '—'}</td>
                  <td className="edi-num">{Number(it.quantity) || 0}</td>
                  <td className="edi-num">{money(Number(it.cost) || 0)}</td>
                  <td className="edi-num">{money(Number(it.price) || 0)}</td>
                  <td className="edi-num">{Number(it.caseQty) || 0} / {Number(it.packQty) || 0}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{items.length} line item{items.length === 1 ? '' : 's'}</td>
                <td className="edi-num" style={{ fontWeight: 700 }}>{money(totalCost)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {revertOpen && (
        <EdiRevertModal
          file={file}
          auth={auth}
          onClose={() => setRevertOpen(false)}
          onReverted={onReverted}
        />
      )}
    </div>
  );
}

// ── Revert confirm modal ─────────────────────────────────────────

function EdiRevertModal({ file, auth, onClose, onReverted }: {
  file: EdiFile; auth: AuthScope; onClose: () => void; onReverted: () => void;
}) {
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const branch = Number(branchId);
      if (!Number.isFinite(branch) || branch <= 0) throw new Error('Enter a valid branch ID');
      const result = await revertEdi(auth, file.receiveId, branch);
      if (!isReceived(result.status)) throw new Error(result.message || 'Revert failed');
      onReverted();
    } catch (e2) { setError(e2 instanceof Error ? e2.message : 'Revert failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="rsx-modal" onMouseDown={e => { if (e.currentTarget === e.target) onClose(); }}>
      <form className="rsx-modal__card" style={{ maxWidth: 440 }} role="dialog" aria-modal="true" aria-label="Revert receiving" onSubmit={submit}>
        <div className="rsx-modal__head">
          <span className="rsx-modal__title">Revert receiving</span>
          <button className="rsx-modal__x" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="rsx-modal__body">
          <p className="rsx-modal__p">This reverts <strong>{file.fileName || `receiving #${file.receiveId}`}</strong> in RapidRMS, undoing its inventory receiving. This cannot be undone from here.</p>
          {error && <div className="edi-banner edi-banner--fail" role="alert">{error}</div>}
          <label className="rsx-form__field">
            <span className="rsx-form__label">Branch ID</span>
            <input className="rsx-form__input" inputMode="numeric" value={branchId} onChange={e => setBranchId(e.target.value)} placeholder="e.g. 1" autoFocus />
          </label>
          <div className="edi-actions">
            <button className="rsx-row__btn" type="button" onClick={onClose}>Cancel</button>
            <button className="rsx-panel__cta" type="submit" disabled={busy} style={{ background: 'var(--danger)', marginLeft: 0 }}>{busy ? 'Reverting…' : 'Revert receiving'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ── Upload modal ─────────────────────────────────────────────────

function EdiUploadModal({ auth, defaultCreatedBy, onClose, onUploaded }: {
  auth: AuthScope; defaultCreatedBy: string; onClose: () => void; onUploaded: () => void;
}) {
  const [fileName, setFileName] = useState('');
  const [supplier, setSupplier] = useState('');
  const [fileType, setFileType] = useState('837');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [branchId, setBranchId] = useState('');
  const [comment, setComment] = useState('');
  const [lines, setLines] = useState<LineItemForm[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<EdiWriteResponse | null>(null);

  const setLine = (i: number, patch: Partial<LineItemForm>) =>
    setLines(cur => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines(cur => [...cur, emptyLine()]);
  const removeLine = (i: number) => setLines(cur => (cur.length === 1 ? cur : cur.filter((_, idx) => idx !== i)));

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setResult(null);
    try {
      const branch = Number(branchId);
      if (!fileName.trim()) throw new Error('File name is required');
      if (!supplier.trim()) throw new Error('Supplier is required');
      if (!invoiceNo.trim()) throw new Error('Invoice number is required');
      if (!Number.isFinite(branch) || branch <= 0) throw new Error('Enter a valid branch ID');
      const validLines = lines.filter(l => l.Description.trim());
      if (validLines.length === 0) throw new Error('Add at least one line item with a description');

      const now = new Date().toISOString();
      const EDIUpload = {
        EDIId: 0,
        BranchId: branch,
        FileName: fileName.trim(),
        UploadDate: now,
        Comment: comment.trim() || undefined,
        Supplier: supplier.trim(),
        FileType: fileType.trim(),
        CreatedBy: defaultCreatedBy || 'aros',
        CreatedDate: now,
        IsExistingPO: false,
        InvoiceNo: invoiceNo.trim(),
        Status: 'Received',
        InvoiceAmount: Number(invoiceAmount) || 0,
      };
      const EDIReceiveItem = validLines.map(l => ({
        Description: l.Description.trim(),
        ItemNo: l.ItemNo.trim() || undefined,
        Quantity: Number(l.Quantity) || 0,
        CaseQtyRecived: 0,
        PackQtyReceived: 0,
        Cost: Number(l.Cost) || 0,
        Price: Number(l.Price) || 0,
        UPC: l.UPC.trim() || undefined,
        CaseUPC: undefined,
        PackUPC: undefined,
        CaseCost: 0,
        PackCost: 0,
        CasePrice: 0,
        PackPrice: 0,
        CaseQty: Number(l.CaseQty) || 0,
        PackQty: Number(l.PackQty) || 0,
        CreateDate: now,
        UserID: 0,
        RegisterId: 0,
        IsDeleted: false,
        IsNewItem: false,
        Deptid: 0,
        SubDeptid: 0,
        Categoryid: 0,
      }));

      const res = await uploadEdi(auth, { EDIUpload, EDIReceiveItem });
      setResult(res);
      if (isReceived(res.status)) {
        // Brief success confirmation, then close + refresh the list.
        setTimeout(() => onUploaded(), 1200);
      }
    } catch (e2) { setError(e2 instanceof Error ? e2.message : 'Upload failed'); }
    finally { setBusy(false); }
  }

  const num = (value: string, on: (v: string) => void, label: string) => (
    <label className="rsx-form__field">
      <span className="rsx-form__label">{label}</span>
      <input className="rsx-form__input" inputMode="decimal" value={value} onChange={e => on(e.target.value)} />
    </label>
  );

  return (
    <div className="rsx-modal" onMouseDown={e => { if (e.currentTarget === e.target) onClose(); }}>
      <form className="rsx-modal__card" style={{ maxWidth: 720 }} role="dialog" aria-modal="true" aria-label="Upload EDI invoice" onSubmit={submit}>
        <div className="rsx-modal__head">
          <span className="rsx-modal__title">Upload EDI invoice</span>
          <button className="rsx-modal__x" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="rsx-modal__body">
          {result && (
            <div className={`edi-banner edi-banner--${isReceived(result.status) ? 'ok' : 'fail'}`} role="status">
              {isReceived(result.status)
                ? `Uploaded — Receive ID ${result.receiveId ?? '—'}.`
                : (result.message || 'Upload failed.')}
            </div>
          )}
          {error && <div className="edi-banner edi-banner--fail" role="alert">{error}</div>}

          <p className="rsx-modal__p" style={{ marginBottom: 12 }}>Invoice details</p>
          <div className="edi-detail__grid" style={{ marginBottom: 16 }}>
            <label className="rsx-form__field"><span className="rsx-form__label">File name</span><input className="rsx-form__input" value={fileName} onChange={e => setFileName(e.target.value)} placeholder="McLane_0714.edi" /></label>
            <label className="rsx-form__field"><span className="rsx-form__label">Supplier</span><input className="rsx-form__input" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="McLane" /></label>
            <label className="rsx-form__field"><span className="rsx-form__label">File type</span><input className="rsx-form__input" value={fileType} onChange={e => setFileType(e.target.value)} placeholder="837" /></label>
            <label className="rsx-form__field"><span className="rsx-form__label">Invoice #</span><input className="rsx-form__input" value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} placeholder="INV-00123" /></label>
            <label className="rsx-form__field"><span className="rsx-form__label">Invoice amount</span><input className="rsx-form__input" inputMode="decimal" value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} placeholder="0.00" /></label>
            <label className="rsx-form__field"><span className="rsx-form__label">Branch ID</span><input className="rsx-form__input" inputMode="numeric" value={branchId} onChange={e => setBranchId(e.target.value)} placeholder="1" /></label>
          </div>
          <label className="rsx-form__field" style={{ marginBottom: 18 }}><span className="rsx-form__label">Comment (optional)</span><input className="rsx-form__input" value={comment} onChange={e => setComment(e.target.value)} /></label>

          <div className="edi-toolbar" style={{ marginBottom: 10 }}>
            <p className="rsx-modal__p" style={{ margin: 0 }}>Line items</p>
            <span className="edi-toolbar__spacer" />
            <button className="rsx-row__btn" type="button" onClick={addLine}>+ Add line</button>
          </div>
          <div className="edi-lineitems">
            {lines.map((l, i) => (
              <div className="edi-lineitem" key={i}>
                <label className="rsx-form__field"><span className="rsx-form__label">Description</span><input className="rsx-form__input" value={l.Description} onChange={e => setLine(i, { Description: e.target.value })} /></label>
                <label className="rsx-form__field"><span className="rsx-form__label">Item #</span><input className="rsx-form__input" value={l.ItemNo} onChange={e => setLine(i, { ItemNo: e.target.value })} /></label>
                <label className="rsx-form__field"><span className="rsx-form__label">UPC</span><input className="rsx-form__input" value={l.UPC} onChange={e => setLine(i, { UPC: e.target.value })} /></label>
                {num(l.Quantity, v => setLine(i, { Quantity: v }), 'Qty')}
                {num(l.Cost, v => setLine(i, { Cost: v }), 'Cost')}
                {num(l.Price, v => setLine(i, { Price: v }), 'Price')}
                {num(l.CaseQty, v => setLine(i, { CaseQty: v }), 'Case qty')}
                {num(l.PackQty, v => setLine(i, { PackQty: v }), 'Pack qty')}
                <button className="edi-lineitem__remove" type="button" onClick={() => removeLine(i)} disabled={lines.length === 1} aria-label="Remove line">Remove</button>
              </div>
            ))}
          </div>

          <p className="rsx-modal__p" style={{ marginTop: 16 }}>Credentials are reused from your RapidRMS connection — the invoice is submitted directly to RapidRMS.</p>
          <div className="edi-actions">
            <button className="rsx-row__btn" type="button" onClick={onClose}>Cancel</button>
            <button className="rsx-panel__cta" type="submit" disabled={busy} style={{ marginLeft: 0 }}>{busy ? 'Uploading…' : 'Upload invoice'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

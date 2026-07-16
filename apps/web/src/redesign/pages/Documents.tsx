import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  createFolder, createShare, deleteFile, deleteFolder, fetchContentObjectUrl, formatBytes, getFile,
  getFolder, getTree, isImage, listFolder, listShares, moveFile, moveFolder, renameFile, renameFolder,
  revokeShare, uploadFile,
  type AuthScope, type DocFile, type DocFolder, type DocShare, type FolderListing, type ShareMode,
} from './documentsApi';

type Selection = { kind: 'file' | 'folder'; id: string } | null;
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

// ── Folder tree (left rail) ──────────────────────────────────────
function TreeNode({ node, childrenOf, currentId, depth, onOpen }: {
  node: DocFolder; childrenOf: Map<string | null, DocFolder[]>; currentId: string | null; depth: number; onOpen: (id: string | null) => void;
}) {
  const kids = childrenOf.get(node.id) || [];
  return (
    <div>
      <button
        className="docs-tree__row"
        aria-current={currentId === node.id}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => onOpen(node.id)}
      >
        <span className="docs-tree__glyph" aria-hidden>{kids.length ? '▸' : '·'}</span>
        <span className="docs-tree__label">{node.name}</span>
      </button>
      {kids.map(child => (
        <TreeNode key={child.id} node={child} childrenOf={childrenOf} currentId={currentId} depth={depth + 1} onOpen={onOpen} />
      ))}
    </div>
  );
}

// ── Share dialog ─────────────────────────────────────────────────
function ShareDialog({ auth, target, onClose }: {
  auth: AuthScope; target: { kind: 'file' | 'folder'; id: string; name: string }; onClose: () => void;
}) {
  const [shares, setShares] = useState<DocShare[]>([]);
  const [mode, setMode] = useState<ShareMode>('view');
  const [expiresAt, setExpiresAt] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const reload = useCallback(async () => {
    try { setShares((await listShares(auth, target.kind, target.id)).shares); }
    catch (e) { setError(msg(e)); }
  }, [auth, target.kind, target.id]);
  useEffect(() => { void reload(); }, [reload]);

  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await createShare(auth, {
        targetType: target.kind, targetId: target.id, mode,
        password: password.trim() || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      setPassword(''); setExpiresAt(''); await reload();
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true); setError('');
    try { await revokeShare(auth, id); await reload(); }
    catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }

  async function copy(url: string, id: string) {
    try { await navigator.clipboard.writeText(url); setCopied(id); setTimeout(() => setCopied(''), 1600); } catch { /* ignore */ }
  }

  const active = shares.filter(s => !s.revokedAt);
  return (
    <div className="setup-modal-backdrop" onMouseDown={e => { if (e.currentTarget === e.target) onClose(); }}>
      <div className="setup-modal docs-sharemodal" role="dialog" aria-modal="true" aria-label={`Share ${target.name}`}>
        <div className="modal-title">
          <div><p className="setup-eyebrow">Share link</p><h2>Share “{target.name}”</h2></div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        {error && <div className="rsx-note" role="alert"><div className="rsx-note__body">{error}</div></div>}
        <form className="docs-shareform" onSubmit={create}>
          <label>Access
            <select value={mode} onChange={e => setMode(e.target.value as ShareMode)}>
              <option value="view">View only</option>
              <option value="download">View &amp; download</option>
            </select>
          </label>
          <label>Expires (optional)
            <input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
          </label>
          <label>Password (optional)
            <input type="password" autoComplete="new-password" value={password} placeholder="Protect with a password" onChange={e => setPassword(e.target.value)} />
          </label>
          <button className="setup-primary" disabled={busy}>{busy ? 'Creating…' : 'Create link'}</button>
        </form>
        <div className="docs-sharelist">
          {active.length === 0 ? <p className="docs-muted">No active links yet.</p> : active.map(s => (
            <div className="docs-sharerow" key={s.id}>
              <div className="docs-sharerow__main">
                <input className="docs-sharerow__url" readOnly value={s.url} onFocus={e => e.currentTarget.select()} />
                <div className="docs-sharerow__meta">
                  <span className="rsx-pill rsx-pill--on">{s.mode === 'download' ? 'View & download' : 'View only'}</span>
                  {s.hasPassword && <span className="rsx-pill rsx-pill--warn">Password</span>}
                  {s.expiresAt && <span className="docs-muted">Expires {new Date(s.expiresAt).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="docs-sharerow__actions">
                <button className="rsx-row__btn" type="button" onClick={() => void copy(s.url, s.id)}>{copied === s.id ? 'Copied' : 'Copy'}</button>
                <button className="rsx-row__btn" type="button" disabled={busy} onClick={() => void revoke(s.id)}>Revoke</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Move dialog (pick a destination folder) ──────────────────────
function MoveDialog({ tree, current, onClose, onMove }: {
  tree: DocFolder[]; current: { name: string; excludeId?: string }; onClose: () => void; onMove: (dest: string | null) => void;
}) {
  const [dest, setDest] = useState<string | null>(null);
  const childrenOf = useMemo(() => buildChildrenMap(tree), [tree]);
  const roots = childrenOf.get(null) || [];
  const disabled = (id: string) => id === current.excludeId;
  return (
    <div className="setup-modal-backdrop" onMouseDown={e => { if (e.currentTarget === e.target) onClose(); }}>
      <div className="setup-modal" role="dialog" aria-modal="true" aria-label={`Move ${current.name}`}>
        <div className="modal-title">
          <div><p className="setup-eyebrow">Move</p><h2>Move “{current.name}”</h2></div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="docs-movepick">
          <button className={`docs-tree__row ${dest === null ? 'is-dest' : ''}`} onClick={() => setDest(null)}>
            <span className="docs-tree__glyph" aria-hidden>⌂</span><span className="docs-tree__label">All files (root)</span>
          </button>
          {roots.map(node => <MoveNode key={node.id} node={node} childrenOf={childrenOf} dest={dest} depth={1} disabled={disabled} onPick={setDest} />)}
        </div>
        <div className="modal-actions">
          <button className="setup-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="setup-primary" type="button" onClick={() => onMove(dest)}>Move here</button>
        </div>
      </div>
    </div>
  );
}
function MoveNode({ node, childrenOf, dest, depth, disabled, onPick }: {
  node: DocFolder; childrenOf: Map<string | null, DocFolder[]>; dest: string | null; depth: number; disabled: (id: string) => boolean; onPick: (id: string) => void;
}) {
  const kids = childrenOf.get(node.id) || [];
  const off = disabled(node.id);
  return (
    <div>
      <button className={`docs-tree__row ${dest === node.id ? 'is-dest' : ''}`} disabled={off} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => onPick(node.id)}>
        <span className="docs-tree__glyph" aria-hidden>▸</span><span className="docs-tree__label">{node.name}</span>
      </button>
      {kids.map(child => <MoveNode key={child.id} node={child} childrenOf={childrenOf} dest={dest} depth={depth + 1} disabled={disabled} onPick={onPick} />)}
    </div>
  );
}

function buildChildrenMap(folders: DocFolder[]): Map<string | null, DocFolder[]> {
  const map = new Map<string | null, DocFolder[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    const arr = map.get(key) || [];
    arr.push(f);
    map.set(key, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

// ── Inline image preview for a selected image file ───────────────
function ImagePreview({ auth, file }: { auth: AuthScope; file: DocFile }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let revoked = ''; let alive = true;
    fetchContentObjectUrl(auth, file.id).then(u => { if (alive) { setUrl(u); revoked = u; } }).catch(() => {});
    return () => { alive = false; if (revoked) URL.revokeObjectURL(revoked); };
  }, [auth, file.id]);
  if (!url) return <div className="docs-preview__ph">Loading preview…</div>;
  return <img className="docs-preview__img" src={url} alt={file.name} />;
}

// ── Main page ────────────────────────────────────────────────────
export function DocumentsPage() {
  const { session, tenant } = useAuth();
  const auth = useMemo<AuthScope>(() => ({ accessToken: session?.access_token, tenantId: tenant?.id }), [session?.access_token, tenant?.id]);

  const [tree, setTree] = useState<DocFolder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<DocFolder[]>([]);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<Selection>(null);
  const [selectedFile, setSelectedFile] = useState<DocFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [shareTarget, setShareTarget] = useState<{ kind: 'file' | 'folder'; id: string; name: string } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ kind: 'file' | 'folder'; id: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bootstrapped = useRef(false);

  const childrenOf = useMemo(() => buildChildrenMap(tree), [tree]);
  const roots = childrenOf.get(null) || [];

  const refreshTree = useCallback(async () => {
    try { setTree((await getTree(auth)).folders); } catch { /* tree is best-effort */ }
  }, [auth]);

  const syncUrl = useCallback((folderId: string | null, fileId?: string | null) => {
    const params = new URLSearchParams();
    if (folderId) params.set('folder', folderId);
    if (fileId) params.set('file', fileId);
    const qs = params.toString();
    window.history.replaceState({}, '', `/documents${qs ? `?${qs}` : ''}`);
  }, []);

  const load = useCallback(async (folderId: string | null, keepSelection = false) => {
    setLoading(true); setError('');
    try {
      if (folderId) {
        const data = await getFolder(auth, folderId);
        setListing({ parentId: data.folder.parentId, folders: data.folders, files: data.files });
        setBreadcrumb(data.path);
      } else {
        const data = await listFolder(auth, null);
        setListing(data); setBreadcrumb([]);
      }
      setCurrentFolderId(folderId);
      if (!keepSelection) { setSelected(null); setSelectedFile(null); }
    } catch (e) { setError(msg(e)); } finally { setLoading(false); }
  }, [auth]);

  const openFolder = useCallback((folderId: string | null) => { syncUrl(folderId); void load(folderId); }, [load, syncUrl]);

  // Bootstrap: honor deep-link (?folder / ?file), else load root.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void refreshTree();
    const params = new URLSearchParams(window.location.search);
    const fileParam = params.get('file');
    const folderParam = params.get('folder');
    (async () => {
      if (fileParam) {
        try {
          const file = await getFile(auth, fileParam);
          await load(file.folderId, true);
          setSelected({ kind: 'file', id: file.id }); setSelectedFile(file);
          syncUrl(file.folderId, file.id);
          return;
        } catch { /* fall back to folder/root */ }
      }
      void load(folderParam || null);
    })();
  }, [auth, load, refreshTree, syncUrl]);

  async function onSelectFile(file: DocFile) {
    setSelected({ kind: 'file', id: file.id }); setSelectedFile(file);
    syncUrl(currentFolderId, file.id);
  }
  function onSelectFolderTile(folder: DocFolder) {
    setSelected({ kind: 'folder', id: folder.id }); setSelectedFile(null);
  }

  async function doUpload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy('upload'); setError('');
    try {
      for (const file of list) await uploadFile(auth, { folderId: currentFolderId, file });
      await load(currentFolderId, true);
    } catch (e) { setError(msg(e)); } finally { setBusy(''); }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault(); setDragOver(false);
    if (event.dataTransfer?.files?.length) void doUpload(event.dataTransfer.files);
  }

  async function submitNewFolder(event: FormEvent) {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    setBusy('folder'); setError('');
    try {
      await createFolder(auth, { parentId: currentFolderId, name });
      setNewFolderName(''); setNewFolderOpen(false);
      await Promise.all([load(currentFolderId, true), refreshTree()]);
    } catch (e) { setError(msg(e)); } finally { setBusy(''); }
  }

  async function rename(target: { kind: 'file' | 'folder'; id: string; name: string }) {
    const next = window.prompt(`Rename “${target.name}”`, target.name);
    if (!next || next.trim() === target.name) return;
    setBusy(`rename:${target.id}`); setError('');
    try {
      if (target.kind === 'file') await renameFile(auth, target.id, next.trim());
      else await renameFolder(auth, target.id, next.trim());
      await Promise.all([load(currentFolderId, true), refreshTree()]);
    } catch (e) { setError(msg(e)); } finally { setBusy(''); }
  }

  async function remove(target: { kind: 'file' | 'folder'; id: string; name: string }) {
    if (!window.confirm(`Delete “${target.name}”? ${target.kind === 'folder' ? 'Everything inside it will be removed.' : ''}`)) return;
    setBusy(`del:${target.id}`); setError('');
    try {
      if (target.kind === 'file') await deleteFile(auth, target.id);
      else await deleteFolder(auth, target.id);
      setSelected(null); setSelectedFile(null);
      await Promise.all([load(currentFolderId, true), refreshTree()]);
    } catch (e) { setError(msg(e)); } finally { setBusy(''); }
  }

  async function doMove(dest: string | null) {
    if (!moveTarget) return;
    const target = moveTarget; setMoveTarget(null);
    setBusy(`move:${target.id}`); setError('');
    try {
      if (target.kind === 'file') await moveFile(auth, target.id, dest);
      else await moveFolder(auth, target.id, dest);
      await Promise.all([load(currentFolderId, true), refreshTree()]);
    } catch (e) { setError(msg(e)); } finally { setBusy(''); }
  }

  async function download(file: DocFile) {
    setBusy(`dl:${file.id}`); setError('');
    try {
      const url = await fetchContentObjectUrl(auth, file.id, true);
      const a = document.createElement('a');
      a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { setError(msg(e)); } finally { setBusy(''); }
  }

  const folders = listing?.folders ?? [];
  const files = listing?.files ?? [];
  const empty = !loading && folders.length === 0 && files.length === 0;

  return (
    <div className="rsx-panel docs">
      <div className="rsx-panel__head">
        <div>
          <div className="rsx-panel__eyebrow">Documents</div>
          <p className="rsx-panel__lead">Store, organize, and share your workspace files — folders, uploads, and secure links.</p>
        </div>
        <div className="docs-actions">
          <button className="rsx-row__btn" type="button" onClick={() => setNewFolderOpen(true)}>New folder</button>
          <button className="rsx-panel__cta" type="button" disabled={busy === 'upload'} onClick={() => fileInputRef.current?.click()}>
            {busy === 'upload' ? 'Uploading…' : 'Upload'}
          </button>
          <input ref={fileInputRef} type="file" multiple hidden onChange={e => { if (e.target.files) void doUpload(e.target.files); e.target.value = ''; }} />
        </div>
      </div>

      {error && <div className="rsx-note" role="alert"><div className="rsx-note__title">Something went wrong</div><div className="rsx-note__body">{error}</div><button className="rsx-row__btn" onClick={() => void load(currentFolderId, true)}>Retry</button></div>}

      <div className="docs-layout">
        <aside className="docs-tree" aria-label="Folder tree">
          <button className="docs-tree__row" aria-current={currentFolderId === null} onClick={() => openFolder(null)}>
            <span className="docs-tree__glyph" aria-hidden>⌂</span><span className="docs-tree__label">All files</span>
          </button>
          {roots.map(node => <TreeNode key={node.id} node={node} childrenOf={childrenOf} currentId={currentFolderId} depth={1} onOpen={openFolder} />)}
        </aside>

        <section
          className={`docs-main ${dragOver ? 'is-drop' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="docs-bar">
            <nav className="docs-crumbs" aria-label="Breadcrumb">
              <button className="docs-crumb" onClick={() => openFolder(null)}>All files</button>
              {breadcrumb.map(node => (
                <span key={node.id}><span className="docs-crumb__sep">/</span><button className="docs-crumb" onClick={() => openFolder(node.id)}>{node.name}</button></span>
              ))}
            </nav>
            <div className="docs-viewtoggle" role="group" aria-label="View">
              <button className={view === 'grid' ? 'is-on' : ''} onClick={() => setView('grid')} aria-pressed={view === 'grid'}>Grid</button>
              <button className={view === 'list' ? 'is-on' : ''} onClick={() => setView('list')} aria-pressed={view === 'list'}>List</button>
            </div>
          </div>

          {loading ? <div className="rsx2-empty"><div className="rsx2-empty__text">Loading…</div></div>
            : empty ? (
              <div className="rsx2-empty">
                <div className="rsx2-empty__icon">◇</div>
                <div className="rsx2-empty__title">This folder is empty</div>
                <div className="rsx2-empty__text">Drag files here, or use Upload to add documents.</div>
                <button className="rsx-panel__cta" onClick={() => fileInputRef.current?.click()}>Upload files</button>
              </div>
            ) : (
              <div className={view === 'grid' ? 'docs-grid' : 'docs-list'}>
                {folders.map(folder => (
                  <button
                    key={folder.id}
                    className={`docs-item docs-item--folder ${selected?.kind === 'folder' && selected.id === folder.id ? 'is-sel' : ''}`}
                    onClick={() => onSelectFolderTile(folder)}
                    onDoubleClick={() => openFolder(folder.id)}
                  >
                    <span className="docs-item__icon" aria-hidden>📁</span>
                    <span className="docs-item__name">{folder.name}</span>
                    <span className="docs-item__meta">Folder</span>
                  </button>
                ))}
                {files.map(file => (
                  <button
                    key={file.id}
                    className={`docs-item ${selected?.kind === 'file' && selected.id === file.id ? 'is-sel' : ''}`}
                    onClick={() => void onSelectFile(file)}
                    onDoubleClick={() => void download(file)}
                  >
                    <span className="docs-item__icon" aria-hidden>{isImage(file.contentType) ? '🖼️' : '📄'}</span>
                    <span className="docs-item__name">{file.name}</span>
                    <span className="docs-item__meta">{formatBytes(file.byteSize)}</span>
                  </button>
                ))}
              </div>
            )}
        </section>

        {selected && (
          <aside className="docs-detail" aria-label="Details">
            {selected.kind === 'file' && selectedFile ? (
              <>
                <div className="docs-detail__head">
                  <span className="docs-detail__icon" aria-hidden>{isImage(selectedFile.contentType) ? '🖼️' : '📄'}</span>
                  <div className="docs-detail__title">{selectedFile.name}</div>
                </div>
                {isImage(selectedFile.contentType) && <div className="docs-preview"><ImagePreview auth={auth} file={selectedFile} /></div>}
                <dl className="docs-meta">
                  <div><dt>Type</dt><dd>{selectedFile.contentType || 'file'}</dd></div>
                  <div><dt>Size</dt><dd>{formatBytes(selectedFile.byteSize)}</dd></div>
                  {selectedFile.updatedAt && <div><dt>Updated</dt><dd>{new Date(selectedFile.updatedAt).toLocaleString()}</dd></div>}
                </dl>
                <div className="docs-detail__actions">
                  <button className="rsx-row__btn" disabled={busy === `dl:${selectedFile.id}`} onClick={() => void download(selectedFile)}>Download</button>
                  <button className="rsx-row__btn" onClick={() => rename({ kind: 'file', id: selectedFile.id, name: selectedFile.name })}>Rename</button>
                  <button className="rsx-row__btn" onClick={() => setMoveTarget({ kind: 'file', id: selectedFile.id, name: selectedFile.name })}>Move</button>
                  <button className="rsx-row__btn" onClick={() => setShareTarget({ kind: 'file', id: selectedFile.id, name: selectedFile.name })}>Share</button>
                  <button className="rsx-row__btn docs-danger" onClick={() => void remove({ kind: 'file', id: selectedFile.id, name: selectedFile.name })}>Delete</button>
                </div>
              </>
            ) : selected.kind === 'folder' ? (() => {
              const folder = folders.find(f => f.id === selected.id);
              if (!folder) return null;
              return (
                <>
                  <div className="docs-detail__head"><span className="docs-detail__icon" aria-hidden>📁</span><div className="docs-detail__title">{folder.name}</div></div>
                  <div className="docs-detail__actions">
                    <button className="rsx-row__btn" onClick={() => openFolder(folder.id)}>Open</button>
                    <button className="rsx-row__btn" onClick={() => rename({ kind: 'folder', id: folder.id, name: folder.name })}>Rename</button>
                    <button className="rsx-row__btn" onClick={() => setMoveTarget({ kind: 'folder', id: folder.id, name: folder.name })}>Move</button>
                    <button className="rsx-row__btn" onClick={() => setShareTarget({ kind: 'folder', id: folder.id, name: folder.name })}>Share</button>
                    <button className="rsx-row__btn docs-danger" onClick={() => void remove({ kind: 'folder', id: folder.id, name: folder.name })}>Delete</button>
                  </div>
                </>
              );
            })() : null}
          </aside>
        )}
      </div>

      {newFolderOpen && (
        <div className="setup-modal-backdrop" onMouseDown={e => { if (e.currentTarget === e.target) setNewFolderOpen(false); }}>
          <form className="setup-modal" role="dialog" aria-modal="true" aria-label="New folder" onSubmit={submitNewFolder}>
            <div className="modal-title"><div><p className="setup-eyebrow">Create</p><h2>New folder</h2></div><button className="modal-close" type="button" onClick={() => setNewFolderOpen(false)} aria-label="Close">×</button></div>
            <div className="connection-form">
              <label>Folder name<input autoFocus value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="e.g. Invoices" /></label>
              <div className="modal-actions">
                <button className="setup-secondary" type="button" onClick={() => setNewFolderOpen(false)}>Cancel</button>
                <button className="setup-primary" disabled={busy === 'folder'}>{busy === 'folder' ? 'Creating…' : 'Create folder'}</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {shareTarget && <ShareDialog auth={auth} target={shareTarget} onClose={() => setShareTarget(null)} />}
      {moveTarget && <MoveDialog tree={tree} current={{ name: moveTarget.name, excludeId: moveTarget.kind === 'folder' ? moveTarget.id : undefined }} onClose={() => setMoveTarget(null)} onMove={dest => void doMove(dest)} />}
    </div>
  );
}

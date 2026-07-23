# Journey: Store owner shows the assistant something — a photo, a file, or a barcode
Persona: Ramesh (see README.md)
Trigger: Ramesh has something in his hand he wants the assistant to look at —
a supplier invoice, a shelf price tag, a receipt, a PDF spec sheet, or a
product he can scan. Typing it out is not how he thinks; he wants to *show* it.
Entry point: The "+" attach control on any AROS chat composer — the Concierge
(chat-first shell), the floating assistant (FAB, any page), and the `/start`
pre-connection landing chat. One control, same behavior on all three.

## Golden path (budget: 1–2 taps / ≤ 15 seconds to a grounded answer)
| # | User sees | Must already know | The ONE action they take |
|---|-----------|-------------------|--------------------------|
| 1 | A "+" next to the message box | *nothing* | Taps "+" |
| 2 | A sheet: **Photo · File · Camera · Barcode · Voice** | *nothing* | Taps the source he wants |
| 3 | (Photo/File/Camera) A thumbnail of what he attached sits above the box; he can remove it | *nothing* | Types an optional question and sends |
| 4 | A short in-flight state, then an answer that **quotes what's actually in the image/document** (a total, a line item, a due date), readably | *nothing* | (Goal reached — maybe a follow-up) |
| 3b | (Barcode) The camera opens with a scan reticle; on a good read — or a typed UPC — it looks the code up | *nothing* | Points the camera, or types the number |
| 4b | The **real product** from his connected catalog (name, price, stock), or an explicit "not in your catalog" | *nothing* | (Goal reached) |

## Failure states
| Step | What goes wrong | What the screen says | Self-service recovery |
|------|-----------------|----------------------|-----------------------|
| 2 | Camera permission denied / no camera | Scanner shows "Camera access is blocked — take a photo or type the code below." **Never a dead black pane.** | Manual UPC field (always present) or the Photo path |
| 2 | Browser can't scan live (iPad Safari/Firefox, no BarcodeDetector) | Bundled WASM decoder loads; if even that fails, "type the code" floor stays | Photo-of-barcode decode, or manual entry |
| 3 | File too big (>10MB) or turn too big (>20MB) | "That file is 14.2 MB — over the 10 MB per-file limit. Try a smaller file." | Attach a smaller file; oversized upload **never crashes** the composer |
| 3 | Unsupported type (.exe, .zip) | "That's not a supported type. Attach an image, PDF, or Office/CSV document." | Pick a supported file |
| 4 | Vision unavailable (key absent/unreachable) | "I couldn't read that attachment right now. I won't guess what it contains — please try again." **Never a fabricated description.** | Retry; honest status |
| 4b | No store connected | "No store connected — link a POS store to look up scanned items." + **Connect Store** | One tap to connect (journey 2) |
| 4b | UPC not in catalog | "Not in your catalog." **Never an invented product.** | Offered "Add item?" |
| 4b | Catalog unreachable | "The catalog could not be reached just now. Try again in a moment." | Retry |

## Empty states
Pre-connection (`/start` sample store), attachments still send and the assistant
answers from the labeled sample context; a scanned barcode surfaces the
not-connected state (link a store) rather than a sample product. The line
between sample and real is never blurred.

## Success signal
Ramesh photographs a supplier invoice and the assistant quotes a real line item
or total he can verify against the paper; he scans a bottle and sees **his**
price and stock, or an honest "not found." Trust is the product: **one
fabricated line item, or one invented product for a barcode that isn't in the
catalog, ends this journey permanently.**

## Activation dependencies
- Router image-turn model pin (mission Shared Z): scoped AROS image turns route
  to the Claude vision model; without it, images fall back to the local path.
  Honest-failure covers the window before it lands.
- Funded Anthropic vision key (vault-custodied): the extraction engine. When
  absent/unreachable, the composer shows the honest "can't read it" state, never
  a guess.
- Attachments are sent as `attachments:[{name,type,dataUrl}]` (base64 data URLs,
  images client-downscaled, 10MB/file + 20MB/turn caps enforced client-side).
- Barcode → catalog: needs a **UPC-keyed catalog READ tool** on the AROS
  backend. Until that lands, a connected-store scan is sent as an explicit
  "look up UPC … do not guess" query on the real store-data path; the
  not-connected state is resolved client-side. **A plausible product for an
  unscanned/uncatalogued UPC is a defect.**
- Durable attachment history (thumbnails surviving reload) is mission Shared S
  (shre-files + message reference + retention). Until then in-session thumbnails
  render; the persisted transcript keeps a lightweight file chip.

## Out of scope
Building the voice recorder (owned by the voice-everywhere initiative; this
journey only mounts its slot in the attach sheet). Writing extracted invoice
data back into catalog/inventory/AP (extraction is read/answer only; any write
rides existing draft→approval rails). Structured line-item extraction into
accounting.

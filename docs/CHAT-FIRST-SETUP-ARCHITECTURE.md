# AROS chat-first setup architecture

Status: implementation baseline (2026-07-15)

## Product contract

The customer journey is deliberately short:

1. Sign up with email or Google/Microsoft SSO.
2. Verify the email address.
3. Enter a fully usable chat immediately.
4. Connect a store or another app from persistent, dismissible menu actions.

Chat is never blocked by connector setup. The default model is the local Shre/Ollama model. A tenant may choose Claude, OpenAI, Gemini, or another enabled provider, subject to privacy, policy, availability, and budget rules.

## Runtime boundaries

```text
Channels and model-facing surfaces
  WhatsApp | Slack | Teams | voice | web/app | Claude | Codex | Gemini | Sia
                              |
                              v
shre-gateway: adapter ingress, webhook verification, canonical shre.msg.v1
                              |
                              v
shre-id: principal, tenant/workspace/store scope, channel linking, session, consent
                              |
                              v
shre-router: intent classification, agent/skill dispatch, conversation orchestration
                    |                         |
                    v                         v
shre-model-gateway                    AROS agents and skills
local Shre default; governed          Ellie -> domain specialists
Claude/OpenAI/Gemini fallback                  |
                                              v
shre-policy: mandatory RBAC + ABAC + consent + approval + blast-radius decision
                                              |
                                              v
shre-connect: MCP clients, official SDK/API adapters, canonical PosAdapter runtime
                                              |
                                              v
shre-core: shre.* events/data, outbox, read models, audit and correlation lineage
                                              |
                                              v
POS, Shre ecosystem services, productivity, communications, CRM/support/accounting
```

Two placement rules are non-negotiable:

- Identity and store scope resolve before routing.
- Policy is enforced between agent intent and connector execution, and rechecked by the connector runtime. Prompt text is never authority.

## Canonical request context

Every message, agent run, tool request, approval, connector call, event, and audit record carries:

```ts
interface ArosRequestContext {
  tenantId: string;
  workspaceId: string;
  storeIds: string[];
  userId: string;
  channelIdentityId: string;
  sessionId: string;
  agentId?: string;
  correlationId: string;
  causationId?: string;
  consentSnapshotId: string;
  policyDecisionId?: string;
  dataClassification: "public" | "internal" | "confidential" | "restricted";
}
```

Missing or inconsistent tenancy context is a hard denial, not an inferred default.

## Read and write paths

Read example: yesterday's sales for store 4.

1. The channel adapter verifies the webhook and emits `shre.msg.received`.
2. `shre-id` links the channel identity to a user and resolves tenant and store scope.
3. `shre-router` dispatches the request to Ellie/Ops.
4. The agent requests `pos.sales.summary`; `shre-policy` checks read scope and store ACL.
5. `shre-connect` reads a sufficiently fresh canonical read model or performs a live `PosAdapter` query.
6. The selected model summarizes the result; the channel adapter renders it; an audit event records the lineage.

Write example: change a price across several stores.

1. Steps 1-3 are identical to a read.
2. Policy evaluates `price.update`, role, store scope, risk class, channel trust, and blast radius.
3. If required, an approval enters `pending_approval` with a TTL and authorized approver set.
4. Approval creates an immutable decision and a single idempotency key for the intent.
5. `shre-connect` executes a per-store saga through `PosAdapter`, recording before/after snapshots.
6. The outbox publishes per-store results. Partial failure is visible and retryable; it is never reported as full success.

## Onboarding states and information architecture

| State | Customer surface | Required behavior |
|---|---|---|
| `anonymous` | Signup | Email, Google SSO, Microsoft SSO; no company or payment fields |
| `unverified` | Verify email | Six-digit auto-advance code, resend timer, magic-link fallback |
| `active_no_store` | Chat | Ellie welcome; local Shre model; Connect Store and Connect Apps actions |
| `store_pending` | Store wizard | Provider, pairing/credentials, store scope, validating, success/failure |
| `apps_partial` | Apps | OAuth scope preview, connected/degraded state, health and reconnect |
| `operational` | Chat + health | Contextual live answers, approvals, alerts, and connection status |

Primary product navigation: Chat, Stores/POS, Apps, Models, and Connection Health.

Administration navigation: Settings, Profile, Cost & Billing, Users, and Workspace. Workspace contains General, Stores, Security/Data & Privacy, Audit Log, and Integration Policy. Owners and admins see administration according to permission; members see Profile and only their permitted settings.

## POS activation and connection flows

The Stores/POS page has a top-right **Connect POS** action. It lists activated POS connections; it does not assume RapidRMS. The empty state says **No POS connected** and opens a provider catalog containing RapidRMS, Verifone Commander, Clover, and future providers.

The hierarchy is:

```text
POS provider -> POS connection -> discovered provider sites -> mapped AROS stores
```

A provider may have several independent connections. Each connection row shows provider, friendly connection name, mapped sites/stores, health, last sync, and View, Reconnect, Add another, and Disconnect actions.

### RapidRMS

The connection wizard collects and validates:

1. Friendly connection name.
2. RapidRMS Client ID.
3. Login email.
4. Password through sealed input directly into the vault.
5. Store DB name, for example `RapidRMS2`.
6. Optional API base URL, default `https://rapidrmsapi.azurewebsites.net`.
7. Sync frequency, default 15 minutes.
8. Test Connection.
9. Discover accessible stores/databases and map them to AROS stores.
10. Review read/write capabilities and activate.

The password is never returned after storage. The runtime stores only a vault reference with the connection record.

### Verifone Commander

The connection wizard collects and validates:

1. Friendly connection/site name.
2. Commander LAN IP, for example `192.168.31.11`.
3. Commander CGI username.
4. Password through sealed input directly into the vault.
5. Connection mode: Auto, Direct, or Edge Relay.
6. Sync frequency, default 5 minutes.
7. Detect an installed edge relay and test Commander reachability/login.
8. Show the resolved mode and endpoint.
9. Map the Commander site to an AROS store.
10. Review capabilities and activate.

Direct mode is available only when the runtime can reach the store LAN. Edge Relay is the normal remote-cloud path and must display pairing and online/offline diagnostics without exposing tunnel credentials.

Clover and future POS providers follow the same staged contract: prerequisites -> credential/OAuth grant -> test -> location discovery -> store mapping -> capability review -> activation.

## Multiple accounts per app

An app provider is not itself a connection. Model the relationship explicitly:

```text
AppProvider 1---* ConnectorAccount *---* Workspace/StoreMapping
```

`ConnectorAccount` includes a stable ID, provider, tenant, friendly label, authenticated external identity, owner user, vault grant reference, scopes/capabilities, health, last sync, and workspace/store mappings. Optional per-capability defaults point to a connection account rather than directly to a provider.

The Apps page shows a provider card and account count. Expanding it shows every connected account. The action is **Connect first account** or **Add account**. Selecting Connect routes into the provider-specific flow, beginning with scope preview and authorization.

After OAuth callback:

1. Resolve the external account identity.
2. Detect an existing connection with the same tenant, provider, and external identity.
3. If duplicated, offer **Reauthorize/replace existing** or **Add as another account**; never silently overwrite.
4. Ask for a friendly label and workspace/store mappings.
5. Optionally select defaults for capabilities such as mail, calendar, files, or accounting.
6. Save the grant as a vault reference and run the provider health test.

Each account row shows label, authenticated identity, owner, scopes, mappings, health, last sync, and Manage, Reauthorize, Add another, and Disconnect actions. Ownership transfer requires permission and a fresh authorization check.

## Model selection contract

- Workspace default: `shre-local`.
- User-visible choices: Shre local, Auto, Claude, OpenAI/ChatGPT, Gemini, and enabled future providers.
- Auto is a policy, not a model. It evaluates privacy mode, data classification, quality threshold, availability, latency, and budget.
- Cloud fallback is prohibited when tenant policy or data classification requires local-only processing.
- Per-agent overrides inherit from the workspace unless explicitly pinned by an authorized admin.
- Every response exposes a small model chip. Escalation discloses the destination model and estimated/actual cloud cost.
- Agents receive a capability handle, never provider or connector credentials.

## Connector taxonomy

| Runtime | Responsibility | Initial examples |
|---|---|---|
| Channel adapter | Verify, normalize, render, delivery receipt | Web chat, WhatsApp, Slack, Teams, RingCentral voice/SMS |
| MCP client | Discover namespaced capabilities from mature MCP servers | Google Workspace, Microsoft 365, Slack where supported |
| Official SDK/API adapter | Fill gaps where MCP is absent or insufficient | QuickBooks, RingCentral, CRM/support apps |
| `PosAdapter` | Canonical `query`, `command`, `subscribe`, health and conformance | RapidRMS, Verifone Commander, Clover |
| Internal service adapter | Shre ecosystem events/APIs | Centrix, RapidSupport, MIB, CPG, StorePulse/HQ |

Skills never contain provider-specific POS logic. All POS implementations pass the same contract/conformance suite and normalize to `shre.*` entities.

## Permission and audit contract

- RBAC supplies coarse permissions: Owner, Admin, Manager, Clerk, Accountant, Support, and service Agent.
- ABAC narrows them by tenant, stores, time, value, store count, channel trust, data class, and connector health.
- Effective authorization is `RBAC allow AND ABAC conditions AND active consent`; default is deny.
- Risk and blast radius select auto-allow, one approver, or dual control.
- OAuth grants and consent records are scoped to tenant, connector account, user/admin authority, capabilities, and stores.
- Audit events are append-only and contain actor, policy decision, input/output hashes, connector, correlation, latency, and outcome.
- All writes use an outbox and idempotency key. Webhooks require signature verification, replay protection, and tenant-bound routing.
- Connector output is untrusted data and cannot introduce executable tool instructions.

## Delivery phases

### Phase 1: chat-first core

Implement signup/verification/chat, local-model default, visible model chip, Connect Store entry, RapidRMS `PosAdapter`, RBAC policy/approval, canonical audit/outbox, one live read, and one approval-gated write.

Acceptance:

- Signup to chat takes less than 90 seconds.
- Chat works without a connected store.
- A live RapidRMS sales question returns store-scoped data with audit lineage.
- A multi-store price write cannot execute without the required approval.
- Every tool call carries the canonical request context.

### Phase 2: multi-POS and business apps

Add Verifone Commander and Clover through the same conformance suite; Google Workspace, Microsoft 365, and QuickBooks OAuth; ABAC/dual control; Connection Health; Slack/Teams; Centrix and StorePulse read models.

Acceptance:

- Three POS providers pass the shared conformance suite.
- Agents never receive OAuth tokens, only vault-backed capability handles.
- Degradation appears in health UI and contextually in chat.
- Multi-store writes report a per-store outcome and support safe retries.

### Phase 3: agentic operations and ecosystem

Add RingCentral voice/session continuity, compliance-gated outbound customer messaging, reseller tenancy, connector marketplace discovery, richer per-agent routing, and MIB/CPG analytics.

Acceptance:

- Voice and chat share the same resolved identity/session lineage.
- Outbound messages are denied without a valid consent/compliance decision.
- Reseller tenants are isolated across data, vault paths, caches, models, and audit exports.

## UI implementation handoff

The first implementation should cover eight linked responsive screens: Signup, Verify Email, Chat-first Onboarding, Connect Store, Connect Apps, Models, Permissions, and Connection Health. It must include loading, empty, validating, connected, degraded, failed/retry, pending approval, and partial multi-store result states. The golden path is signup -> verify -> chat -> connect RapidRMS -> ask for yesterday's sales -> approve a price change.

Do not merge a generated prototype directly over the current web UI. Reconcile it against the existing `apps/web/src/app/aros.css` and `apps/web/src/components/Dashboard.tsx` changes, extract tokens/components, then integrate in small reviewed commits.

# Branch summary: `decentralizer-poc/sign-topology-hash`

Work driven by the `decentralizer-poc` project: wallet-gateway support for
Canton parties whose signing authority is not held here — decentralized
(threshold-namespace) parties, where several owners must each sign before
anything can be submitted.

Reproduce the diffs:

```bash
# everything
git diff ba67e8b45d2705df3e13f19f8cf8766dd9a6ea42..HEAD

# hand-written only (codegen excluded)
git diff ba67e8b45d2705df3e13f19f8cf8766dd9a6ea42..HEAD -- . \
  ':(exclude)core/ledger-proto/src/_proto/**' \
  ':(exclude)**/rpc-gen/**' \
  ':(exclude)**/openrpc*.json' \
  ':(exclude)api-specs/**'
```

Nothing on this branch has been released. An earlier iteration modelled these
parties as "Safe-like" wallets marked by a `Wallet.safeAppUrl` field; that
approach was replaced wholesale rather than deprecated, so no trace of it
remains and there is no migration to worry about.

---

## Part 1 — What has been done

### 1. A signing provider for delegated parties

The core of the design. A party the gateway cannot sign for gets a real
signing provider of its own — `SigningProvider.DECENTRALIZED`, implemented by
the new `core/signing-decentralized` package — instead of being special-cased
in the execute path.

This works because **the signing-driver interface has been asynchronous all
along**: `signTransaction` may return `pending`, and `getTransaction` is
polled until it completes. That is precisely how Fireblocks and DFNS park a
request with a remote approver. Collecting signatures from several human
owners is the same shape with more humans in it, so the driver interface
needed no new concept.

Which coordinator a party delegates to is a property of the _wallet_
(`Wallet.delegatedSigningUrl`), not of the deployment, so one gateway can
serve several independently coordinated parties. The driver is always
registered and holds no credentials.

Set or change it with the new user-api `setDelegatedSigning`, from a
**Delegate signing** action on the wallet card, or by supplying it at import.
Only a party that no signing provider matches may be delegated — pinning a
wallet the gateway _can_ sign for would strand the key that actually
authorizes it, and the pin deliberately survives wallet sync, so it would stay
stuck. Enforced in the UI and again in the RPC.

### 2. Clear-signing for topology bundles

`signTopologyTransactions`. The dApp hands over raw topology-transaction
bytes; the wallet independently decodes each one for display (party id,
decentralized namespace, threshold, owner fingerprints, hosting participants),
recomputes the combined `multiHash` itself from those raw bytes at sign time —
never from a cached or dApp-supplied value — and signs via the existing
unmodified `signTransaction` on the `WALLET_KERNEL` driver.

New pieces: decode/hash primitives in `core/tx-visualizer` with golden-vector
tests, a `TopologyBundleRaw` store type (migration 016), server handlers for
receipt-time decode+store and sign-time recompute+sign, a `/sign-topology`
approval page, and dapp-sdk client wiring.

### 3. Multi-owner signing and submission

- **`signPreparedTransaction`** (+ `PreparedTransactionToSign`, migration 018)
  lets one owner clear-sign a prepared transaction independently of the
  original caller's own `Transaction` record — the coordinator is cross-origin
  and usually a different gateway user. Hash mismatch is a hard failure.
- **`submitDelegatedSignatures`** hands the collected set back to the gateway,
  which records it against the parked request and submits to Canton exactly
  once. The gateway already holds the prepared transaction, so nothing
  security-relevant travels back in from the caller except the signatures —
  and Canton verifies those against the hash it derives from the transaction
  being submitted.

### 4. `userUrlKind`: what a page _is_, not which window to use

`prepareExecute` returns `userUrlKind: 'approval' | 'handoff'`. An approval is
this wallet's own short-lived approve page; a handoff is a different
application, where the party's other owners take part and the user may stay a
while. A browser client gives a handoff a real tab instead of a cramped popup;
a CLI or mobile client can act on the same distinction.

This deliberately replaces an earlier `openInNewWindow` boolean, which was a
browser window-management instruction sitting in a published protocol and
meaningless to a non-browser client. The bug that flag was working around — a
wallet page hijacking the very window it was trying to open — was a
window-_naming_ collision, fixed at its root in `popup.ts` (see Part 3).

### 5. Party import

`WalletSyncService` only reconciles what is already in
`/v2/users/{userId}/rights`, so a party allocated outside this gateway was
permanently invisible. Adds an **Import** button, a `/parties/import` page,
and an `importParty` RPC that verifies the party exists, grants the current
session `actAs`, and re-runs a wallet sync. Optionally sets
`delegatedSigningUrl` in the same step.

---

## Part 2 — Impact on wallet providers

**The signing-driver interface is unchanged in any way that costs an existing
driver anything.** The only additions to `openrpc-signing-api.json` are
optional: `Transaction.signatures[]` alongside the existing singular
`signature`, and a `SignatureEntry` schema. Every existing driver keeps
returning `signature` alone. All ten `core/signing-*` packages other than the
new one have a zero diff.

Everything else lands on providers who implement the RPC surface, the Store,
and the approval UI. The in-repo proof of the obligation list is
`wallet-gateway/extension`, whose stubs throw `not implemented` — that stub
list _is_ the provider to-do list.

### 1. dApp-facing RPC

| Method                      | Params                                           | Result                 |
| --------------------------- | ------------------------------------------------ | ---------------------- |
| `signTopologyTransactions`  | `transactions[]`, `synchronizerId?`              | `{requestId, userUrl}` |
| `signPreparedTransaction`   | `preparedTransaction`, `preparedTransactionHash` | `{requestId, userUrl}` |
| `submitDelegatedSignatures` | `requestId`, `signatures[]`                      | ledger response        |

Plus two event types, `topologyTransactionsSignature` and
`preparedTransactionSignature`, each with pending / signed / failed shapes.
**Both must be forwarded over the SSE `/events` endpoint** — a missing
forwarding there hangs the dApp forever with no error.

`prepareExecute`'s result gains the optional `userUrlKind` described above.

### 2. The clear-signing contract

The part a provider cannot copy-paste. For both `signTopologyTransactions` and
`signPreparedTransaction` the wallet must:

1. take the **raw bytes** from the dApp, never a dApp-supplied hash;
2. decode them for display;
3. **recompute the hash itself, fresh, at sign time**;
4. **hard-fail on mismatch** rather than sign.

Reusable primitives are exported from `core/tx-visualizer/src/index.ts`:
`unwrapVersionedMessage`, `decodeVersionedTopologyTransaction`,
`summarizeTopologyTransaction`, `computeTopologyMultiHash`.

### 3. Store interface — breaking for custom `Store` implementations

`core/wallet-store/src/Store.ts` gained **ten required methods**: five for
`TopologyBundleRaw`, four for `PreparedTransactionToSign`, and
`setAnyTransactionStatus`. Plus `Wallet.delegatedSigningUrl`, and
`UpdateWallet.delegatedSigningUrl` / `.signingProviderId`. The in-memory and
SQL implementations are updated in-tree; a provider with its own store must
add all of them and the equivalent of migrations **016, 017, 018**.

`setAnyTransactionStatus` deserves a note: it moves a transaction's status
_without_ scoping the write to the calling user, leaving the recorded owner
intact. The scoped `setTransactionStatus` cannot express "completed on someone
else's behalf", which is the normal case for a delegated party — whoever
finalizes is usually a different gateway account from whoever prepared it. It
pairs with the pre-existing, equally unscoped `listAllPendingTransactions`.

Design point worth preserving: raw bytes are the source of truth; `summaries`
are display-only and never signed, and `preparedTransactionHash` is stored as
supplied and re-verified at sign time.

### 4. User-api and hosted approval UI

Nine user-api methods — `setDelegatedSigning`, `importParty`,
`signTopologyTransactions`, `get`/`list`/`deleteTopologyBundleToSign`,
`signPreparedTransaction`, `get`/`deletePreparedTransactionToSign` — and two
new approval pages, `/sign-topology` and `/sign-prepared-transaction`.

Approval pages must be registered in **three** places, not two:
`ALLOWED_ROUTES` in `core/wallet-ui-components/src/routing.ts`, the bundler's
entry list, **and** `wallet-gateway/extension`'s own duplicate route list plus
its `ROUTE_TO_HTML_MAP`. Three separate real bugs on this branch came from
skipping one of those.

### 5. Known limitation

Topology and prepared-transaction signing are hard-gated to
`SigningProvider.WALLET_KERNEL`. They reuse the driver's existing
`signTransaction` to avoid adding a method to the driver interface.
Consequence: a custodial provider or a participant-signing wallet cannot be an
_owner_ of a delegated party. Lifting that does touch the driver interface.

Note this is about owners, not about the delegated party itself — that is what
the new provider exists for.

---

## Part 3 — Fixes found along the way

Each of these is independent of the feature and stands on its own.

- **`popup.ts` self-targeting.** `window.open(url, 'wallet-popup')` resolves
  the name against the whole family of related browsing contexts _including
  the calling window's own name_. Once a page was itself the wallet popup, any
  popup it opened renavigated the caller instead of opening beside it — so a
  wallet page handing off to another app hijacked the window it was trying to
  open. The name is now unique per page, which keeps what the shared name was
  for (repeat calls from one page reuse one window) and drops what it was not.
- **`mergeTransactionStatusUpdate` dropped `userId` and `networkId`** in the
  in-memory store. It rebuilt the record field by field, so a transaction
  forgot who owned it as soon as it left `pending`. The SQL store passes both
  explicitly and was unaffected.
- **`prepareExecute` never recorded `userId`** on the transaction it created.
- **`wallet-gateway/extension` did not compile**: it keeps its own duplicate
  of `ALLOWED_ROUTES`, and `/parties/import`, `/sign-topology` and
  `/sign-prepared-transaction` were added only to the shared list.
- **`playwright` was pinned to 1.58.2** by a `pnpm-workspace.yaml` override
  while `@playwright/test` resolved to 1.62.1. The two must move together;
  the split also made browsers uninstallable on some platforms, so no browser
  test could run. Both are now 1.62.1.
- **The migration lock was stale** — 016 had been edited after being locked,
  and 017/018 were never added, so the `check-migration-lock` CI job failed.
- **`signWithParticipant` faked a signature.** It returned
  `signature: 'none'` and marked the transaction signed when `PARTICIPANT` was
  merely a fallback label rather than the party's real namespace. It now
  throws.

---

## Part 4 — Open design concern

`resolveSigningProvider` encodes "no provider matched" as
`SigningProvider.PARTICIPANT` with a separate `disabled` flag. An _absence_ is
recorded as a specific, real provider, and only `disabled` separates "the
participant genuinely signs for this party" from "we have no idea who does".

This is upstream `main` behaviour, untouched by this branch — but it is the
root of several workarounds: `signWithParticipant`'s guard exists to undo it,
the delegation precondition has to be spelled
`disabled && reason === NO_SIGNING_PROVIDER_MATCHED`, and because
`signingProviderId` is on the dApp-facing `Wallet` schema, third-party dApps
are told `"participant"` for a party the participant demonstrably cannot sign
for.

A dedicated value (`SigningProvider.NONE`, or a nullable field) would fix it
and let `disabled` be derived rather than load-bearing. Not done here because,
unlike everything else on this branch, it is released behaviour: rows already
carry `'participant'`, so it needs a migration and changes a dApp-visible
value.

---

## Verification

`pnpm -r build`, `pnpm exec eslint`, and `pnpm -r test` all pass: 36 packages,
2419 tests, including every browser-project suite. `migrations:check-lock`
passes with 18 migrations.

`decentralizer-poc`'s own Playwright suite passes end to end against a real
Canton + wallet-gateway stack — all five specs, covering decentralized party
creation (2-of-2 and 2-of-3), the coordinated Ping including the case where a
**co-signer other than the original sender** finalizes, and a 3-of-3 joint
account spending under a policy.

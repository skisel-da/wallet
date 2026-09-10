# Decentralized Signing Driver

A driver for parties whose signing authority is **not held in this gateway at
all**, implementing the `SigningDriverInterface` from
`@canton-network/core-signing-lib`.

The case it exists for is a decentralized (threshold-namespace) Canton party:
no single key here can authorize anything for it, and several owners must each
sign the same hash before it can be submitted. Signing is delegated to an
external coordinator, which collects those signatures out of band and hands the
set back.

## Why this needs no new concept in the driver interface

The interface already allows `signTransaction` to answer `status: 'pending'`,
which is how the remote-custody drivers (Fireblocks, DFNS, Securosys, …) park
a request with an approver elsewhere. This driver borrows only that: it says
"not signed, and not by me", and points at where the signing will happen.

**The signing OpenRPC document is unchanged** — byte-identical to `main`. The
per-wallet coordinator and the party/command context travel through
`SignTransactionParams`, which is already declared
`additionalProperties: true`, so no schema moved and no other driver is
affected.

## How a request flows

1. `prepareExecute` finds the acting wallet's `signingProviderId` is
   `decentralized` and calls into this driver.
2. `signTransaction` returns the URL an owner must visit, marked
   `userUrlKind: 'handoff'` — a statement that the page is _another
   application_, not this wallet's own approve page, so a browser client
   gives it a real tab rather than a transient popup and a non-browser client
   can act on the same distinction. Nothing is recorded.
3. Owners sign the prepared transaction with their own individual wallets
   (`signPreparedTransaction`), independently of each other.
4. Whichever owner finalizes submits the collected set to Canton themselves.
   The gateway is not involved and never hears about it.

## Why it keeps no state

The gateway records nothing for a delegated party — no `Transaction` row, no
parked request here. That is deliberate.

A record the gateway never completes can only be closed by a scoped store
write, and the owner who finalizes a coordination is usually a _different
gateway account_ from the one who prepared it. So a kept record would never be
closed by anyone, on every coordinated transaction — and because such rows
carry an `externalTxId`, they are exactly the ones the signing worker treats
as pickup candidates. Keeping none is what makes the handoff clean.

The consequence to be aware of: the gateway has no history of delegated
transactions, and `txChanged` never reaches `executed` for one. Owners learn a
coordination's progress from the coordinator and its outcome from the ledger,
which is what a dApp acting for such a party should be doing anyway.

## Configuration

None, at the driver level. Which coordinator a party delegates to is a
property of the wallet (`Wallet.delegatedSigningUrl`), not of the deployment,
so a single gateway can serve several independently coordinated parties. The
driver is always registered; it holds no credentials of its own.

Set or change a party's coordinator with the user-api's `setDelegatedSigning`,
or supply it when importing the party. Only a party that no signing provider
matches can be delegated: pinning a wallet the gateway _can_ sign for would
strand the key that actually authorizes it.

## What it deliberately does not do

- **`getKeys` returns an empty set.** Wallet sync resolves a provider by
  matching a party's namespace against each driver's key fingerprints, and a
  decentralized namespace is no key's fingerprint. Matching here would only
  ever be wrong, so the provider is assigned explicitly instead.
- **`signMessage` and `createKey` are refused.** There is no key here.
- **It verifies no signatures and tracks no requests.** `getTransaction`
  reports not-found by design. Canton verifies the collected set against the
  hash it derives from the transaction at submission, which is the check that
  decides the outcome.

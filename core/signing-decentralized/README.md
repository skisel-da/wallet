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

The interface has been asynchronous all along. `signTransaction` may return
`status: 'pending'`, and `getTransaction` is polled until the request
completes — which is exactly how the remote-custody drivers (Fireblocks, DFNS,
Securosys, …) park a request with a human approver elsewhere.

This driver is the same shape, with a set of human owners in place of a custody
service. The only additions anywhere are optional:

- `Transaction.signatures[]` on the signing API, alongside the existing
  singular `signature`, because a threshold party is authorized by a set.
  Every other driver keeps returning `signature` alone and needs no change.
- Extra fields passed through `SignTransactionParams`, which is already
  declared `additionalProperties: true`, so no parameter schema changed.

## How a request flows

1. `prepareExecute` finds the acting wallet's `signingProviderId` is
   `decentralized` and calls into this driver.
2. `signTransaction` records a pending request and returns the URL an owner
   must visit, marked `userUrlKind: 'handoff'` — a statement that the page is
   _another application_, not this wallet's own approve page, so a browser
   client gives it a real tab rather than a transient popup and a non-browser
   client can act on the same distinction.
3. Owners sign the prepared transaction with their own individual wallets
   (`signPreparedTransaction`), independently of each other.
4. The coordinator hands the collected set back via
   `submitDelegatedSignatures`, which calls `submitSignatures` here and then
   submits to Canton exactly once.

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
- **Signature verification is best-effort.** `signedBy` is a fingerprint,
  which is not enough to check a signature on its own; a caller that also
  supplies the raw public key gets it verified against the hash the request
  was created for. Canton verifies the whole set at submission regardless —
  checking here just names the offending signer instead of failing anonymously.

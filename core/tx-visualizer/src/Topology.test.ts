// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { expect, test, describe } from 'vitest'
import {
    computeTopologyMultiHash,
    decodeVersionedTopologyTransaction,
    summarizeTopologyTransaction,
    unwrapVersionedMessage,
} from './index.js'
import { fromBase64, toBase64 } from './utils.js'
import liveGoldenVector from './fixtures/topology-live-golden-vector.json'
import syntheticBundle from './fixtures/topology-synthetic-decentralized-bundle.json'
import syntheticBundleEmbeddedKeys from './fixtures/topology-synthetic-decentralized-bundle-embedded-keys.json'

// These two fixtures cross-check computeTopologyMultiHash/decode/summarize
// against the exact algorithm implemented independently in
// decentralizer-poc's frontend/src/lib/topology.ts (buildDecentralizedPartyBundle)
// and research/topology-spike/*.mjs -- see docs/wallet-signing-plan.md.
//
// - `topology-live-golden-vector.json` was captured live from a running
//   Canton instance's own `/v2/parties/external/generate-topology` endpoint
//   (decentralizer-poc/infra), i.e. Canton is the oracle: `multiHashBase64`
//   is Canton's own computed hash for `transactionsBase64`, not something we
//   or decentralizer-poc computed. See
//   research/topology-spike/01-verify-hash-algorithm.mjs for the equivalent
//   live verification. It has exactly one transaction (a partyToParticipant
//   mapping for a single-owner external party), so it validates the core
//   per-transaction hash (purpose 11), the wrap format, and purpose-55
//   combine in the degenerate single-hash case -- but not multi-hash sorting.
//
// - `topology-synthetic-decentralized-bundle.json` is a synthetic 2-owner,
//   5-transaction decentralized-party bundle (2x namespaceDelegation, 1x
//   decentralizedNamespaceDefinition, 1x partyToParticipant, 1x
//   partyToKeyMapping), built directly from
//   @canton-network/core-ledger-proto types with an independent
//   reimplementation of decentralizer-poc's hashing algorithm (written fresh,
//   not imported) computing the expected multiHash. This exercises all four
//   known TopologyMapping kinds via summarizeTopologyTransaction, and (with 5
//   hashes to sort and combine) the multi-hash sort/combine logic that the
//   live single-tx fixture can't.
//
// - `topology-synthetic-decentralized-bundle-embedded-keys.json` is the same
//   kind of synthetic 2-owner bundle, but with only 4 transactions (2x
//   namespaceDelegation, 1x decentralizedNamespaceDefinition, 1x
//   partyToParticipant) instead of 5 -- the party's protocol signing keys are
//   embedded directly on `PartyToParticipant.party_signing_keys` (field 6)
//   rather than in a separate `PartyToKeyMapping` transaction. This is the
//   shape a future decentralizer-poc change would produce once
//   `PartyToKeyMapping` (Canton-deprecated in favor of this field) is dropped
//   from the bundle. Exercises the same multiHash sort/combine logic with one
//   fewer transaction, and the new `partySigningKeys` summary field.
//
// Regenerate all three by running (from /Users/sergeykisel/Work/wallet):
//   node <script using @canton-network/core-ledger-proto, see scratchpad
//   fetch-golden-vector.mjs / build-synthetic-bundle.mjs / build-synthetic-
//   bundle-embedded-keys.mjs from the session that added this test>

describe('computeTopologyMultiHash matches Canton / decentralizer-poc', () => {
    test('matches a live-captured Canton-computed multiHash (single tx)', async () => {
        const computed = await computeTopologyMultiHash(
            liveGoldenVector.transactionsBase64
        )
        expect(computed).toEqual(liveGoldenVector.multiHashBase64)
    })

    test('matches an independently-computed multiHash for a 5-tx decentralized bundle', async () => {
        const computed = await computeTopologyMultiHash(
            syntheticBundle.transactionsBase64
        )
        expect(computed).toEqual(syntheticBundle.multiHashBase64)
    })

    test('matches an independently-computed multiHash for a 4-tx bundle with signing keys embedded on PartyToParticipant', async () => {
        const computed = await computeTopologyMultiHash(
            syntheticBundleEmbeddedKeys.transactionsBase64
        )
        expect(computed).toEqual(syntheticBundleEmbeddedKeys.multiHashBase64)
    })

    test('is order-independent (hashes are sorted before combining)', async () => {
        const forward = await computeTopologyMultiHash(
            syntheticBundle.transactionsBase64
        )
        const reversed = await computeTopologyMultiHash(
            [...syntheticBundle.transactionsBase64].reverse()
        )
        expect(reversed).toEqual(forward)
    })

    test('a bit flip in any transaction changes the multiHash', async () => {
        const original = await computeTopologyMultiHash(
            syntheticBundle.transactionsBase64
        )
        const tampered = [...syntheticBundle.transactionsBase64]
        const bytes = fromBase64(tampered[0])
        bytes[bytes.length - 1] ^= 0x01
        tampered[0] = toBase64(bytes)

        const tamperedHash = await computeTopologyMultiHash(tampered)
        expect(tamperedHash).not.toEqual(original)
    })
})

describe('unwrapVersionedMessage / decodeVersionedTopologyTransaction', () => {
    test('unwraps and decodes the live-captured wrapped transaction', () => {
        const wrapped = fromBase64(liveGoldenVector.transactionsBase64[0])
        const { data, version } = unwrapVersionedMessage(wrapped)
        expect(data.length).toBeGreaterThan(0)
        expect(version).toEqual(30)

        const decoded = decodeVersionedTopologyTransaction(
            liveGoldenVector.transactionsBase64[0]
        )
        expect(decoded.mapping?.mapping.oneofKind).toEqual('partyToParticipant')
    })

    test('rejects bytes that are not a valid UntypedVersionedMessage envelope', () => {
        // Raw (unwrapped) TopologyTransaction bytes fed into the versioned
        // decoder should not silently "succeed" with garbage -- this is the
        // exact failure mode the plan flags as the one real gap (wrapped vs.
        // unwrapped bytes).
        const rawTopologyTxBytes = fromBase64(
            liveGoldenVector.transactionsBase64[0]
        )
        // Strip the envelope ourselves and feed the *inner* bytes back in as
        // if they were still wrapped -- this must not spuriously decode into
        // a plausible-looking TopologyTransaction.
        const { data: innerBytes } = unwrapVersionedMessage(rawTopologyTxBytes)
        expect(() => unwrapVersionedMessage(innerBytes)).toThrow()
    })
})

describe('summarizeTopologyTransaction', () => {
    const decoded = syntheticBundle.transactionsBase64.map((b64: string) =>
        decodeVersionedTopologyTransaction(b64)
    )
    const summaries = decoded.map((tx) => summarizeTopologyTransaction(tx))

    test('summarizes both namespaceDelegation root certs', () => {
        const nsDelegations = summaries.filter(
            (s) => s.kind === 'namespaceDelegation'
        )
        expect(nsDelegations).toHaveLength(2)
        for (const s of nsDelegations) {
            if (s.kind !== 'namespaceDelegation') throw new Error('unreachable')
            expect(syntheticBundle.ownerFingerprints).toContain(s.namespace)
            expect(s.isRootDelegation).toBe(true)
        }
    })

    test('summarizes the decentralizedNamespaceDefinition', () => {
        const nsDef = summaries.find(
            (s) => s.kind === 'decentralizedNamespaceDefinition'
        )
        expect(nsDef).toBeDefined()
        if (nsDef?.kind !== 'decentralizedNamespaceDefinition')
            throw new Error('unreachable')
        expect(nsDef.decentralizedNamespace).toEqual(
            syntheticBundle.decentralizedNamespace
        )
        expect(nsDef.threshold).toEqual(2)
        expect(nsDef.owners.slice().sort()).toEqual(
            syntheticBundle.ownerFingerprints.slice().sort()
        )
    })

    test('summarizes the partyToParticipant mapping', () => {
        const p2p = summaries.find((s) => s.kind === 'partyToParticipant')
        expect(p2p).toBeDefined()
        if (p2p?.kind !== 'partyToParticipant') throw new Error('unreachable')
        expect(p2p.party).toEqual(syntheticBundle.partyId)
        expect(p2p.participants.map((p) => p.participantUid).sort()).toEqual(
            syntheticBundle.ownerParticipantUids.slice().sort()
        )
    })

    test('summarizes the partyToKeyMapping', () => {
        const p2k = summaries.find((s) => s.kind === 'partyToKeyMapping')
        expect(p2k).toBeDefined()
        if (p2k?.kind !== 'partyToKeyMapping') throw new Error('unreachable')
        expect(p2k.party).toEqual(syntheticBundle.partyId)
        expect(p2k.threshold).toEqual(2)
        expect(p2k.signingKeyCount).toEqual(2)
    })

    test('the live single-tx fixture summarizes as partyToParticipant', () => {
        const liveDecoded = decodeVersionedTopologyTransaction(
            liveGoldenVector.transactionsBase64[0]
        )
        const summary = summarizeTopologyTransaction(liveDecoded)
        expect(summary.kind).toEqual('partyToParticipant')
        if (summary.kind !== 'partyToParticipant')
            throw new Error('unreachable')
        expect(summary.party).toEqual(liveGoldenVector.partyId)
    })
})

describe('summarizeTopologyTransaction (signing keys embedded on PartyToParticipant)', () => {
    const decoded = syntheticBundleEmbeddedKeys.transactionsBase64.map(
        (b64: string) => decodeVersionedTopologyTransaction(b64)
    )
    const summaries = decoded.map((tx) => summarizeTopologyTransaction(tx))

    test('the bundle has exactly 4 transactions and no partyToKeyMapping', () => {
        expect(summaries).toHaveLength(4)
        expect(
            summaries.filter((s) => s.kind === 'partyToKeyMapping')
        ).toHaveLength(0)
    })

    test('summarizes partySigningKeys from PartyToParticipant.party_signing_keys', () => {
        const p2p = summaries.find((s) => s.kind === 'partyToParticipant')
        expect(p2p).toBeDefined()
        if (p2p?.kind !== 'partyToParticipant') throw new Error('unreachable')

        expect(p2p.party).toEqual(syntheticBundleEmbeddedKeys.partyId)
        expect(p2p.participants.map((p) => p.participantUid).sort()).toEqual(
            syntheticBundleEmbeddedKeys.ownerParticipantUids.slice().sort()
        )
        expect(p2p.partySigningKeys).toBeDefined()
        expect(p2p.partySigningKeys?.threshold).toEqual(
            syntheticBundleEmbeddedKeys.partySigningKeysThreshold
        )
        expect(p2p.partySigningKeys?.signingKeyCount).toEqual(
            syntheticBundleEmbeddedKeys.partySigningKeysCount
        )
    })

    test('the older 5-tx fixture has no partySigningKeys on its partyToParticipant summary', () => {
        const olderDecoded = syntheticBundle.transactionsBase64.map(
            (b64: string) => decodeVersionedTopologyTransaction(b64)
        )
        const olderSummaries = olderDecoded.map((tx) =>
            summarizeTopologyTransaction(tx)
        )
        const p2p = olderSummaries.find((s) => s.kind === 'partyToParticipant')
        expect(p2p).toBeDefined()
        if (p2p?.kind !== 'partyToParticipant') throw new Error('unreachable')
        expect(p2p.partySigningKeys).toBeUndefined()
    })
})

// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { TopologyTransaction } from '@canton-network/core-ledger-proto'
import {
    computeSha256CantonHash,
    computeMultiHashForTopology,
} from './hashing_scheme_v2.js'
import { fromBase64, toBase64 } from './utils.js'

/**
 * Result of {@link unwrapVersionedMessage}: the inner `data` payload plus the
 * protocol version Canton's `UntypedVersionedMessage` envelope carries
 * alongside it.
 *
 * Canton wraps every "protocol versioned" proto message (including
 * `TopologyTransaction`) in this trivial envelope before hashing/transport:
 *
 * ```proto
 * message UntypedVersionedMessage {
 *   oneof wrapper { bytes data = 1; }
 *   int32 version = 2;
 * }
 * ```
 *
 * No generated TS binding exists for this envelope (it would require the
 * arm64-blocked `grpc_tools_node_protoc` toolchain used elsewhere in this
 * monorepo), so this is a small hand-rolled protobuf-wire-format reader
 * instead -- sufficient because the message only ever has these two fields.
 */
export interface UnwrappedVersionedMessage {
    data: Uint8Array
    version: number
}

function readVarint(bytes: Uint8Array, offset: number): [bigint, number] {
    let result = 0n
    let shift = 0n
    let pos = offset
    for (;;) {
        if (pos >= bytes.length) {
            throw new Error(
                'unwrapVersionedMessage: truncated varint at end of buffer'
            )
        }
        const byte = bytes[pos]
        result |= BigInt(byte & 0x7f) << shift
        pos++
        if ((byte & 0x80) === 0) break
        shift += 7n
    }
    return [result, pos]
}

/**
 * Unwraps Canton's `UntypedVersionedMessage` envelope, returning the inner
 * `data` bytes (e.g. a serialized `TopologyTransaction`) and the envelope's
 * `version` field.
 *
 * IMPORTANT: this only strips the envelope for *decoding/display*. Hashing a
 * topology transaction (see {@link computeTopologyMultiHash}) must operate on
 * the still-wrapped bytes -- Canton signs/hashes the envelope, not the raw
 * inner message. Getting this backwards (hashing unwrapped bytes, or decoding
 * wrapped bytes) silently produces a wrong signature.
 */
export function unwrapVersionedMessage(
    wrapped: Uint8Array
): UnwrappedVersionedMessage {
    let offset = 0
    let data: Uint8Array | undefined
    let version: number | undefined

    while (offset < wrapped.length) {
        const [tag, afterTag] = readVarint(wrapped, offset)
        offset = afterTag
        const fieldNumber = Number(tag >> 3n)
        const wireType = Number(tag & 0x7n)

        if (wireType === 2) {
            const [len, afterLen] = readVarint(wrapped, offset)
            offset = afterLen
            const length = Number(len)
            const value = wrapped.slice(offset, offset + length)
            offset += length
            if (fieldNumber === 1) {
                data = value
            }
        } else if (wireType === 0) {
            const [value, afterValue] = readVarint(wrapped, offset)
            offset = afterValue
            if (fieldNumber === 2) {
                version = Number(value)
            }
        } else {
            throw new Error(
                `unwrapVersionedMessage: unsupported wire type ${wireType} for field ${fieldNumber}`
            )
        }
    }

    if (!data) {
        throw new Error(
            'unwrapVersionedMessage: message has no `data` field (field 1) -- not a valid UntypedVersionedMessage'
        )
    }

    return { data, version: version ?? 0 }
}

/**
 * Decodes a base64-encoded, `UntypedVersionedMessage`-wrapped topology
 * transaction into a well-typed data model. Use this (rather than
 * `decodeTopologyTransaction`) for the bytes a dApp hands to `signMessage`
 * with `messageType: 'canton-topology-transactions'` -- those are always
 * wrapped.
 *
 * @param wrappedTopologyTx - The wrapped topology transaction in base64 format
 * @returns The decoded topology transaction
 */
export const decodeVersionedTopologyTransaction = (
    wrappedTopologyTx: string
): TopologyTransaction => {
    const wrapped = fromBase64(wrappedTopologyTx)
    const { data } = unwrapVersionedMessage(wrapped)
    return TopologyTransaction.fromBinary(data)
}

/** A single hosting participant entry within a `PartyToParticipant` mapping, for display. */
export interface TopologyHostingParticipant {
    participantUid: string
    permission: number
}

/**
 * Decoded, display-only summary of one topology transaction. Never used for
 * hashing/signing -- only the raw bytes are (see {@link computeTopologyMultiHash}).
 */
export type TopologyTransactionSummary =
    | {
          kind: 'namespaceDelegation'
          namespace: string
          isRootDelegation: boolean
      }
    | {
          kind: 'decentralizedNamespaceDefinition'
          decentralizedNamespace: string
          threshold: number
          owners: string[]
      }
    | {
          kind: 'partyToParticipant'
          party: string
          threshold: number
          participants: TopologyHostingParticipant[]
          /**
           * Present only when Canton put the party's protocol signing keys
           * directly on `PartyToParticipant.party_signing_keys` (field 6),
           * rather than in a separate `PartyToKeyMapping` transaction.
           */
          partySigningKeys?: {
              threshold: number
              signingKeyCount: number
          }
      }
    | {
          kind: 'partyToKeyMapping'
          party: string
          threshold: number
          signingKeyCount: number
      }
    | {
          kind: 'unknown'
          mappingKind: string
      }

/**
 * Summarizes a decoded {@link TopologyTransaction} for display purposes
 * (party id, decentralized namespace, threshold, owner fingerprints, hosting
 * participants, ...), switching over the mapping's `oneofKind`. Unrecognized
 * mapping kinds degrade to `{ kind: 'unknown' }` rather than throwing, so a
 * newer Canton mapping type doesn't break clear-signing display -- it just
 * shows up as an opaque entry the user can decline to sign.
 */
export function summarizeTopologyTransaction(
    tx: TopologyTransaction
): TopologyTransactionSummary {
    const mapping = tx.mapping?.mapping

    switch (mapping?.oneofKind) {
        case 'namespaceDelegation':
            return {
                kind: 'namespaceDelegation',
                namespace: mapping.namespaceDelegation.namespace,
                isRootDelegation: mapping.namespaceDelegation.isRootDelegation,
            }
        case 'decentralizedNamespaceDefinition':
            return {
                kind: 'decentralizedNamespaceDefinition',
                decentralizedNamespace:
                    mapping.decentralizedNamespaceDefinition
                        .decentralizedNamespace,
                threshold: mapping.decentralizedNamespaceDefinition.threshold,
                owners: mapping.decentralizedNamespaceDefinition.owners,
            }
        case 'partyToParticipant':
            return {
                kind: 'partyToParticipant',
                party: mapping.partyToParticipant.party,
                threshold: mapping.partyToParticipant.threshold,
                participants: mapping.partyToParticipant.participants.map(
                    (p) => ({
                        participantUid: p.participantUid,
                        permission: p.permission,
                    })
                ),
                ...(mapping.partyToParticipant.partySigningKeys
                    ? {
                          partySigningKeys: {
                              threshold:
                                  mapping.partyToParticipant.partySigningKeys
                                      .threshold,
                              signingKeyCount:
                                  mapping.partyToParticipant.partySigningKeys
                                      .keys.length,
                          },
                      }
                    : {}),
            }
        case 'partyToKeyMapping':
            return {
                kind: 'partyToKeyMapping',
                party: mapping.partyToKeyMapping.party,
                threshold: mapping.partyToKeyMapping.threshold,
                signingKeyCount: mapping.partyToKeyMapping.signingKeys.length,
            }
        default:
            return {
                kind: 'unknown',
                mappingKind: mapping?.oneofKind ?? 'undefined',
            }
    }
}

/**
 * Computes the wallet-independent multiHash for a bundle of topology
 * transactions, to be signed by a single key over the whole bundle at once.
 *
 * IMPORTANT: `transactions` must be the raw `UntypedVersionedMessage`-wrapped
 * bytes (the same bytes `decodeVersionedTopologyTransaction` unwraps for
 * display) -- Canton signs/hashes the wrapped envelope, not the inner
 * `TopologyTransaction` message. This must be called on the bytes stored at
 * receipt time, recomputed fresh at sign time -- never on a cached or
 * dApp-supplied hash.
 *
 * @param transactions - base64-encoded, wrapped topology transactions
 * @returns the base64-encoded, multihash-wrapped combined hash
 */
export async function computeTopologyMultiHash(
    transactions: string[]
): Promise<string> {
    const wrapped = transactions.map(fromBase64)

    // Hash purpose 11 = TopologyTransactionSignature (per-transaction hash).
    // See https://github.com/hyperledger-labs/splice/blob/53738545af6d0714bddff54c3309ecf2fe6d1881/canton/community/base/src/main/scala/com/digitalasset/canton/crypto/HashPurpose.scala#L47
    const rawHashes = await Promise.all(
        wrapped.map((tx) => computeSha256CantonHash(11, tx))
    )
    const combinedHashes = await computeMultiHashForTopology(rawHashes)

    // Hash purpose 55 = MultiTopologyTransaction (combine).
    const computedHash = await computeSha256CantonHash(55, combinedHashes)

    return toBase64(computedHash)
}

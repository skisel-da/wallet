// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    PreparedTransaction,
    TopologyTransaction,
} from '@canton-network/core-ledger-proto'
import {
    computePreparedTransaction,
    computeSha256CantonHash,
    computeMultiHashForTopology,
} from './hashing_scheme_v2.js'
import { fromBase64, toBase64, toHex } from './utils.js'
export {
    computeSha256CantonHash,
    computeMultiHashForTopology,
} from './hashing_scheme_v2.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Decodes a base64 encoded prepared transaction into a well-typed data model, generated directly from Protobuf definitions.
 *
 * @param preparedTransaction - The prepared transaction in base64 format
 * @returns The decoded prepared transaction
 */
export const decodePreparedTransaction = (
    preparedTransaction: string
): PreparedTransaction => {
    const bytes = fromBase64(preparedTransaction)
    return PreparedTransaction.fromBinary(bytes)
}

export const decodeTopologyTransaction = (
    topologyTx: string
): TopologyTransaction => {
    const bytes = fromBase64(topologyTx)
    return TopologyTransaction.fromBinary(bytes)
}

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
 * {@link decodeTopologyTransaction}) for the bytes exchanged over
 * `signTopologyTransactions` -- those are always wrapped.
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
 * Decoded, display-only summary of one topology transaction within a
 * `signTopologyTransactions` bundle. Never used for hashing/signing -- only
 * the raw stored bytes are (see {@link computeTopologyMultiHash}).
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
 * Extracted from `sdk/wallet-sdk/src/wallet/namespace/utils/hash/service.ts`'s
 * `HashNamespace.topologyTransaction()`, which remains as-is (not refactored
 * to call this) to keep this change additive-only.
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

/**
 * Computes the hash of a prepared transaction.
 *
 * @param preparedTransaction - The prepared transaction to hash
 * @param format - The format of the output hash (base64 or hex)
 * @returns The computed hash in the specified format
 */
export const hashPreparedTransaction = async (
    preparedTransaction: string | PreparedTransaction,
    format: 'base64' | 'hex' = 'base64'
): Promise<string> => {
    let preparedTx: PreparedTransaction

    if (typeof preparedTransaction === 'string') {
        preparedTx = decodePreparedTransaction(preparedTransaction)
    } else {
        preparedTx = preparedTransaction
    }

    const hash = await computePreparedTransaction(preparedTx)

    switch (format) {
        case 'base64':
            return toBase64(hash)
        case 'hex':
            return toHex(hash)
    }
}

type ValidationResult = Record<
    string,
    {
        isAuthorized: boolean
        locations: string[]
    }
>

export const validateAuthorizedPartyIds = (
    preparedTransaction: string | PreparedTransaction,
    authorizedPartyIds: string[]
): ValidationResult => {
    let preparedTx: PreparedTransaction

    if (typeof preparedTransaction === 'string') {
        preparedTx = decodePreparedTransaction(preparedTransaction)
    } else {
        preparedTx = preparedTransaction
    }

    const results: ValidationResult = {}
    const updateParty = (party: string, location: string) => {
        if (!results[party]) {
            results[party] = {
                isAuthorized: authorizedPartyIds.includes(party),
                locations: [],
            }
        }

        results[party].locations.push(location)
    }

    preparedTx.metadata?.submitterInfo?.actAs.forEach((party) => {
        updateParty(party, 'metadata.submitterInfo.actAs')
    })

    // then check transaction nodes
    preparedTx.transaction?.nodes.forEach((node) => {
        if (node.versionedNode.oneofKind === 'v1') {
            if (node.versionedNode.v1.nodeType.oneofKind === 'create') {
                node.versionedNode.v1.nodeType.create.signatories.forEach(
                    (party) => {
                        updateParty(
                            party,
                            `transaction.nodes.${node.nodeId}.create.signatories`
                        )
                    }
                )

                node.versionedNode.v1.nodeType.create.stakeholders.forEach(
                    (party) => {
                        updateParty(
                            party,
                            `transaction.nodes.${node.nodeId}.create.stakeholders`
                        )
                    }
                )
            }

            if (node.versionedNode.v1.nodeType.oneofKind === 'exercise') {
                throw new Error('Unsupported')
            }

            if (node.versionedNode.v1.nodeType.oneofKind === 'fetch') {
                throw new Error('Unsupported')
            }

            if (node.versionedNode.v1.nodeType.oneofKind === 'rollback') {
                // do we need to check these nodes?
            }
        }
    })

    return results
}

/** Parsed transaction metadata to JSON for display purposes */
export interface ParsedTransactionInfo {
    packageName?: string
    moduleName?: string
    entityName?: string
    isCreate: boolean
    isExercise: boolean
    signatories?: string[]
    stakeholders?: string[]
    jsonString?: string
    //defined as packageName:ModuleName:EntityName
    templateId?: string
    choiceId?: string
    amount?: string
}

function decodePreparedTransactionToJsonString(txBase64: string): string {
    const t = decodePreparedTransaction(txBase64)
    return JSON.stringify(
        t,
        (key, value) => (typeof value === 'bigint' ? value.toString() : value),
        2
    )
}

function getNodeType(node: any) {
    if (node?.versionedNode?.oneofKind !== 'v1') {
        return null
    }

    return node.versionedNode.v1?.nodeType ?? null
}

function findNodeById(nodes: any[], nodeId: string | undefined) {
    if (!nodeId) {
        return null
    }

    return nodes.find((node) => node?.nodeId === nodeId) ?? null
}

function getPrimaryNode(obj: any, nodes: any[]) {
    const rootId = obj?.transaction?.roots?.[0]
    return findNodeById(nodes, rootId)
}

function getFirstNodeOfType(nodes: any[], type: string) {
    return nodes.find((node) => getNodeType(node)?.oneofKind === type) ?? null
}

function getRecordFields(value: any) {
    if (value?.sum?.oneofKind !== 'record') {
        return []
    }

    return value.sum.record?.fields ?? []
}

function getFieldValue(value: any, label: string) {
    return getRecordFields(value).find((field: any) => field?.label === label)
        ?.value
}

function getNumericValue(value: any): string | undefined {
    if (value?.sum?.oneofKind === 'numeric' && value.sum.numeric) {
        return value.sum.numeric
    }

    return undefined
}

function extractChoiceIdAndAmount(obj: any) {
    const nodes = obj?.transaction?.nodes ?? []
    if (!Array.isArray(nodes) || nodes.length === 0) {
        return {}
    }

    const primaryNode = getPrimaryNode(obj, nodes)
    const primaryExerciseNode =
        getNodeType(primaryNode)?.oneofKind === 'exercise' ? primaryNode : null
    const exerciseNode =
        primaryExerciseNode || getFirstNodeOfType(nodes, 'exercise')
    const createNode = getFirstNodeOfType(nodes, 'create')

    const exercise = getNodeType(exerciseNode)?.exercise
    const create = getNodeType(createNode)?.create

    const choiceId = exercise?.choiceId
    const exerciseAmount =
        getNumericValue(getFieldValue(exercise?.chosenValue, 'amount')) ??
        getNumericValue(
            getFieldValue(
                getFieldValue(
                    getFieldValue(exercise?.chosenValue, 'allocation'),
                    'transferLeg'
                ),
                'amount'
            )
        )
    const createAmount =
        getNumericValue(getFieldValue(create?.argument, 'amount')) ??
        getNumericValue(
            getFieldValue(
                getFieldValue(create?.argument, 'amount'),
                'initialAmount'
            )
        )
    const amount = exercise ? exerciseAmount : createAmount

    return {
        ...(choiceId ? { choiceId } : {}),
        ...(amount ? { amount } : {}),
    }
}

export function parsePreparedTransaction(
    txBase64: string
): ParsedTransactionInfo {
    const jsonString = decodePreparedTransactionToJsonString(txBase64)
    const obj = JSON.parse(jsonString)

    const result: ParsedTransactionInfo = {
        jsonString,
        isCreate: false,
        isExercise: false,
    }

    function deepSearch(value: any) {
        if (value === null || typeof value !== 'object') return

        // Extract fields if present
        if (typeof value.packageName === 'string') {
            result.packageName = value.packageName
        }
        if (Array.isArray(value.signatories)) {
            result.signatories = value.signatories
        }
        if (Array.isArray(value.stakeholders)) {
            result.stakeholders = value.stakeholders
        }
        if (value.templateId?.moduleName) {
            result.moduleName = value.templateId.moduleName
        }
        if (value.templateId?.entityName) {
            result.entityName = value.templateId.entityName
        }
        if (value.nodeType?.create) {
            result.isCreate = true
        }
        if (value.nodeType?.exercise) {
            result.isExercise = true
        }
        // Continue walking the object
        for (const key of Object.keys(value)) {
            deepSearch(value[key])
        }
    }

    deepSearch(obj)
    result.templateId = `${result.packageName || 'N/A'}:${result.moduleName || 'N/A'}:${result.entityName || 'N/A'}` // Ensure this is always set to the defined value

    Object.assign(result, extractChoiceIdAndAmount(obj))

    return result
}

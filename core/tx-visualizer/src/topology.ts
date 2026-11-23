// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    type SigningKeysWithThreshold,
    v30_topology,
    v31_topology,
} from '@canton-network/core-ledger-proto'

import type { VersionedTopologyTransaction } from './index.ts'

export interface TopologyHostingParticipant {
    participantUid: string
    permission: string
    state: string
}

export type TopologyTransactionSummary = {
    operation: string
    serial: number
} & (
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
          partySigningKeys?: { threshold: number; keyCount: number }
      }
    | {
          kind: 'partyToKeyMapping'
          party: string
          threshold: number
          signingKeyCount: number
      }
    | { kind: 'unknown'; mappingKind: string }
)

type Mapping = NonNullable<
    VersionedTopologyTransaction['transaction']['mapping']
>['mapping']

type SummarizedKind =
    | 'namespaceDelegation'
    | 'decentralizedNamespaceDefinition'
    | 'partyToParticipant'
    | 'partyToKeyMapping'

/**
 * The part of a topology transaction of any proto version that is summarized.
 * `P` is the hosting participant of that version, the only part of these mappings
 * whose shape differs between versions.
 */
interface SummarizableTransaction<
    P extends { participantUid: string; permission: number },
> {
    operation: number
    serial: number
    mapping?: {
        mapping:
            | Extract<
                  Mapping,
                  {
                      oneofKind: Exclude<SummarizedKind, 'partyToParticipant'>
                  }
              >
            | {
                  oneofKind: 'partyToParticipant'
                  partyToParticipant: {
                      party: string
                      threshold: number
                      participants: P[]
                      partySigningKeys?: SigningKeysWithThreshold
                  }
              }
            | { oneofKind: Exclude<Mapping['oneofKind'], SummarizedKind> }
    }
}

const summarize = <P extends { participantUid: string; permission: number }>(
    { operation, serial, mapping: wrapper }: SummarizableTransaction<P>,
    hostingState: (participant: P) => string
): TopologyTransactionSummary => {
    const header = {
        operation: v30_topology.Enums_TopologyChangeOp[operation],
        serial,
    }
    const mapping = wrapper?.mapping

    switch (mapping?.oneofKind) {
        case 'namespaceDelegation':
            return {
                ...header,
                kind: 'namespaceDelegation',
                namespace: mapping.namespaceDelegation.namespace,
                // oxlint-disable-next-line typescript/no-deprecated -- summarizes the deprecated mapping so that it is still shown
                isRootDelegation: mapping.namespaceDelegation.isRootDelegation,
            }
        case 'decentralizedNamespaceDefinition':
            return {
                ...header,
                kind: 'decentralizedNamespaceDefinition',
                decentralizedNamespace:
                    mapping.decentralizedNamespaceDefinition
                        .decentralizedNamespace,
                threshold: mapping.decentralizedNamespaceDefinition.threshold,
                owners: mapping.decentralizedNamespaceDefinition.owners,
            }
        case 'partyToParticipant': {
            const { party, threshold, participants, partySigningKeys } =
                mapping.partyToParticipant
            return {
                ...header,
                kind: 'partyToParticipant',
                party,
                threshold,
                participants: participants.map((participant) => ({
                    participantUid: participant.participantUid,
                    permission:
                        v30_topology.Enums_ParticipantPermission[
                            participant.permission
                        ],
                    state: hostingState(participant),
                })),
                ...(partySigningKeys && {
                    partySigningKeys: {
                        threshold: partySigningKeys.threshold,
                        keyCount: partySigningKeys.keys.length,
                    },
                }),
            }
        }
        case 'partyToKeyMapping':
            return {
                ...header,
                kind: 'partyToKeyMapping',
                // oxlint-disable-next-line typescript/no-deprecated -- summarizes the deprecated mapping so that it is still shown
                party: mapping.partyToKeyMapping.party,
                // oxlint-disable-next-line typescript/no-deprecated -- summarizes the deprecated mapping so that it is still shown
                threshold: mapping.partyToKeyMapping.threshold,
                // oxlint-disable-next-line typescript/no-deprecated -- summarizes the deprecated mapping so that it is still shown
                signingKeyCount: mapping.partyToKeyMapping.signingKeys.length,
            }
        default:
            return {
                ...header,
                kind: 'unknown',
                mappingKind: mapping?.oneofKind ?? 'undefined',
            }
    }
}

/**
 * Summarizes a decoded topology transaction for display.
 * A mapping this does not know is summarized as `unknown`, so it is shown rather than refused.
 * A new proto version does not compile until it is handled here.
 *
 * @param decoded - The decoded transaction, as returned by `decodeTopologyTransaction`
 * @returns The summary, with the same fields for every proto version
 */
export const summarizeTopologyTransaction = (
    decoded: VersionedTopologyTransaction
): TopologyTransactionSummary => {
    switch (decoded.version) {
        case 30:
            return summarize(decoded.transaction, (participant) =>
                participant.onboarding ? 'ONBOARDING' : 'ACTIVE'
            )
        case 31:
            return summarize(
                decoded.transaction,
                (participant) =>
                    v31_topology
                        .PartyToParticipant_HostingParticipant_HostingState[
                        participant.state
                    ]
            )
        default:
            return decoded satisfies never
    }
}

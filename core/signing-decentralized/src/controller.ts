// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    buildController,
    CreateKeyResult,
    GetConfigurationResult,
    GetKeysResult,
    GetTransactionResult,
    GetTransactionsResult,
    PartyMode,
    SetConfigurationResult,
    SigningDriverInterface,
    SigningProvider,
    SignMessageResult,
    SignTransactionParams,
    SignTransactionResult,
    SubscribeTransactionsResult,
} from '@canton-network/core-signing-lib'
import { AuthContext } from '@canton-network/core-wallet-auth'
import { randomUUID } from 'node:crypto'

/**
 * Extra fields the Wallet Gateway passes alongside the standard
 * {@link SignTransactionParams}. `SignTransactionParams` is declared with
 * `additionalProperties: true` in the signing OpenRPC document, so carrying
 * these needs no change to the signing-driver interface -- every other driver
 * keeps the exact signature it has today.
 */
export interface DelegatedSignTransactionParams extends SignTransactionParams {
    /** Coordinator this party's signing is delegated to (`Wallet.delegatedSigningUrl`). */
    delegatedSigningUrl?: string
    /** The party being signed for. Shown by the coordinator and echoed back. */
    partyId?: string
    /** Ledger command id, so the coordinator can correlate its own record. */
    commandId?: string
}

/** What a delegated party's `signTransaction` reports back. */
export interface DelegatedHandoff extends Record<string, unknown> {
    delegatedSigningUrl: string
    /** Where a human owner is sent to take part in the coordination. */
    userUrl: string
    /**
     * Always 'handoff': this URL is someone else's application, where the
     * party's other owners take part, not this wallet's own approve page.
     * Stated as a fact about the page so each client can decide how to
     * present it -- a browser gives it a real tab, not a transient popup.
     */
    userUrlKind: 'handoff'
    partyId?: string
    commandId?: string
}

/**
 * Builds the URL a party's owner is sent to in order to take part in
 * coordinating a signature.
 *
 * The prepared transaction travels in the URL rather than as a lookup id on
 * purpose: whichever owner opens this link is generally *not* the gateway user
 * whose `prepareExecute` produced it (each owner authenticates to the
 * coordinator independently, as their own party), so there is no
 * same-origin-authenticated way for them to fetch it afterwards.
 */
export function buildCoordinationUrl(
    delegatedSigningUrl: string,
    request: {
        requestId: string
        preparedTransaction: string
        preparedTransactionHash: string
        partyId?: string
        commandId?: string
    }
): string {
    const base = delegatedSigningUrl.replace(/\/+$/, '')
    const query = new URLSearchParams({
        requestId: request.requestId,
        preparedTransaction: request.preparedTransaction,
        preparedTransactionHash: request.preparedTransactionHash,
        ...(request.partyId ? { partyId: request.partyId } : {}),
        ...(request.commandId ? { commandId: request.commandId } : {}),
    })
    return `${base}/coordinate?${query.toString()}`
}

/**
 * Signing driver for a party whose authority is not held in this gateway at
 * all -- a decentralized (threshold-namespace) party, where no single key here
 * can authorize anything and several owners must each sign the same hash.
 *
 * Its whole job is to say *where* that coordination happens. It holds no key,
 * keeps no state, and completes nothing: the coordinator collects the owners'
 * signatures and submits to Canton itself, so there is no request for this
 * gateway to track and nothing here to poll.
 *
 * That is deliberate rather than incidental. A transaction the gateway records
 * but never completes can only be closed by a scoped store write, and the
 * owner who finalizes a coordination is usually a different gateway account
 * from the one who prepared it -- so any record kept here would leak, on every
 * coordinated transaction. Keeping none is what makes the handoff clean.
 *
 * The coordinator is addressed per wallet (`Wallet.delegatedSigningUrl`), not
 * per driver, so one gateway can serve several independently coordinated
 * parties.
 */
export class DecentralizedSigningDriver implements SigningDriverInterface {
    public partyMode = PartyMode.EXTERNAL
    public signingProvider = SigningProvider.DECENTRALIZED

    public controller = (userId: AuthContext['userId'] | undefined) =>
        buildController({
            signTransaction: async (
                params: SignTransactionParams
            ): Promise<SignTransactionResult> => {
                const delegated = params as DelegatedSignTransactionParams
                if (userId === undefined) {
                    return {
                        error: 'signing_error',
                        error_description:
                            'A delegated signing request needs a user context.',
                    }
                }
                if (!delegated.delegatedSigningUrl) {
                    return {
                        error: 'signing_error',
                        error_description:
                            'This party has no delegatedSigningUrl configured, so there is nowhere to delegate signing to. Set one on the wallet first.',
                    }
                }

                const requestId = params.internalTxId || randomUUID()
                const userUrl = buildCoordinationUrl(
                    delegated.delegatedSigningUrl,
                    {
                        requestId,
                        preparedTransaction: params.tx,
                        preparedTransactionHash: params.txHash,
                        ...(delegated.partyId
                            ? { partyId: delegated.partyId }
                            : {}),
                        ...(delegated.commandId
                            ? { commandId: delegated.commandId }
                            : {}),
                    }
                )

                const handoff: DelegatedHandoff = {
                    delegatedSigningUrl: delegated.delegatedSigningUrl,
                    userUrl,
                    userUrlKind: 'handoff',
                    ...(delegated.partyId
                        ? { partyId: delegated.partyId }
                        : {}),
                    ...(delegated.commandId
                        ? { commandId: delegated.commandId }
                        : {}),
                }

                // `pending` is the honest status: nothing is signed, and this
                // gateway will not be the thing that changes that.
                return {
                    txId: requestId,
                    status: 'pending',
                    metadata: handoff,
                }
            },

            signMessage: async (): Promise<SignMessageResult> => {
                return {
                    error: 'not_allowed',
                    error_description:
                        'A decentralized party holds no key here, so it cannot sign an arbitrary message.',
                }
            },

            // Nothing is tracked, so there is nothing to read back. Owners
            // learn a coordination's progress from the coordinator, and its
            // outcome from the ledger.
            getTransaction: async (): Promise<GetTransactionResult> => ({
                error: 'transaction_not_found',
                error_description:
                    'Delegated signing requests are completed by the coordinator, so this gateway keeps no record of them.',
            }),

            getTransactions: async (): Promise<GetTransactionsResult> => ({
                transactions: [],
            }),

            // Deliberately an empty set rather than an error. The gateway's
            // wallet sync walks every driver's keys to work out which provider
            // owns a party's namespace; a decentralized namespace is not any
            // key's fingerprint, so this driver must never match there -- the
            // provider is assigned explicitly when the party is imported.
            // Erroring instead would just fill the logs on every sync.
            getKeys: async (): Promise<GetKeysResult> => ({ keys: [] }),

            createKey: async (): Promise<CreateKeyResult> => ({
                error: 'not_allowed',
                error_description:
                    'A decentralized party is created by its owners submitting topology transactions, not by generating a key here.',
            }),

            getConfiguration: async (): Promise<GetConfigurationResult> => ({}),

            setConfiguration: async (): Promise<SetConfigurationResult> => ({
                error: 'not_allowed',
                error_description:
                    'This driver is configured per wallet, via delegatedSigningUrl.',
            }),

            subscribeTransactions:
                function (): Promise<SubscribeTransactionsResult> {
                    throw new Error('Function not implemented.')
                },
        })
}

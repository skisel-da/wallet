// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    buildController,
    CreateKeyResult,
    GetConfigurationResult,
    GetKeysResult,
    GetTransactionParams,
    GetTransactionResult,
    GetTransactionsParams,
    GetTransactionsResult,
    PartyMode,
    SetConfigurationResult,
    SignatureEntry,
    SigningDriverInterface,
    SigningDriverStore,
    SigningProvider,
    SigningTransaction,
    SignMessageResult,
    SignTransactionParams,
    SignTransactionResult,
    SubscribeTransactionsResult,
    Transaction,
    verifySignedTxHash,
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

export interface DelegatedRequest {
    requestId: string
    partyId?: string
    commandId?: string
    delegatedSigningUrl: string
    /** Where a human owner is sent to take part in the coordination. */
    userUrl: string
    status: 'pending' | 'signed' | 'rejected' | 'failed'
    signatures: SignatureEntry[]
    reason?: string
}

interface DelegatedMetadata extends Record<string, unknown> {
    delegatedSigningUrl: string
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
    signatures: SignatureEntry[]
    reason?: string
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
 * It behaves like the remote-custody drivers (Fireblocks, DFNS, ...): the
 * request is parked as `pending` and completed out of band, then picked up by
 * `getTransaction` polling. The difference is only *who* completes it -- a set
 * of human owners coordinating through an external app, rather than a custody
 * service. That is why this needs no new concept in the driver interface: the
 * interface has been asynchronous all along.
 *
 * The coordinator is addressed per wallet (`Wallet.delegatedSigningUrl`),
 * not per driver, so one gateway can serve several independently coordinated
 * parties.
 */
export class DecentralizedSigningDriver implements SigningDriverInterface {
    public partyMode = PartyMode.EXTERNAL
    public signingProvider = SigningProvider.DECENTRALIZED

    constructor(private readonly store: SigningDriverStore) {}

    private static toTransaction(tx: SigningTransaction): Transaction {
        const metadata = (tx.metadata ?? {}) as Partial<DelegatedMetadata>
        const signatures = metadata.signatures ?? []
        return {
            txId: tx.id,
            status: tx.status,
            // `signature` stays populated for the single-signature case so the
            // ordinary execute path keeps working unchanged; `signatures`
            // carries the full set a threshold party actually needs.
            ...(signatures.length > 0
                ? { signature: signatures[0].signature }
                : {}),
            ...(signatures.length > 0 ? { signatures } : {}),
            publicKey: tx.publicKey,
            metadata,
        }
    }

    /**
     * Records the signatures an external coordinator collected and marks the
     * request signed. Called by the Wallet Gateway when the coordinator posts
     * back -- deliberately not part of the RPC `Methods` surface, since no
     * other driver has an inbound completion path.
     */
    public async submitSignatures(
        userId: string,
        requestId: string,
        signatures: Array<SignatureEntry & { publicKey?: string }>
    ): Promise<void> {
        const existing = await this.store.getSigningTransaction(
            userId,
            requestId
        )
        if (!existing) {
            throw new Error(
                `No delegated signing request found with id ${requestId}`
            )
        }
        if (existing.status !== 'pending') {
            throw new Error(
                `Delegated signing request ${requestId} is already ${existing.status}`
            )
        }
        if (signatures.length === 0) {
            throw new Error('At least one signature is required')
        }

        // Verify whatever we can. `signedBy` is a key fingerprint, which is not
        // enough to check a signature on its own, so a caller that also supplies
        // the raw public key gets its signature verified against the hash this
        // request was actually created for. A caller that does not is still
        // recorded -- Canton rejects a bad set at submission regardless -- but
        // catching it here names the offending signer instead of failing the
        // whole submission anonymously.
        for (const entry of signatures) {
            if (!entry.publicKey) continue
            if (
                !verifySignedTxHash(
                    existing.hash,
                    entry.publicKey,
                    entry.signature
                )
            ) {
                throw new Error(
                    `Signature from ${entry.signedBy} does not verify against the hash of request ${requestId}`
                )
            }
        }

        const metadata = (existing.metadata ?? {}) as DelegatedMetadata
        await this.store.setSigningTransaction(userId, {
            ...existing,
            status: 'signed',
            signature: signatures[0].signature,
            metadata: {
                ...metadata,
                signatures: signatures.map(({ signature, signedBy }) => ({
                    signature,
                    signedBy,
                })),
            },
            updatedAt: new Date(),
            signedAt: new Date(),
        })
    }

    /** Marks a coordination attempt as abandoned, so the caller stops waiting. */
    public async rejectRequest(
        userId: string,
        requestId: string,
        reason: string
    ): Promise<void> {
        const existing = await this.store.getSigningTransaction(
            userId,
            requestId
        )
        if (!existing) {
            throw new Error(
                `No delegated signing request found with id ${requestId}`
            )
        }
        const metadata = (existing.metadata ?? {}) as DelegatedMetadata
        await this.store.setSigningTransaction(userId, {
            ...existing,
            status: 'rejected',
            metadata: { ...metadata, reason },
            updatedAt: new Date(),
        })
    }

    /** Reads back a coordination request, for display and for polling. */
    public async getRequest(
        userId: string,
        requestId: string
    ): Promise<DelegatedRequest | undefined> {
        const tx = await this.store.getSigningTransaction(userId, requestId)
        if (!tx) return undefined
        const metadata = (tx.metadata ?? {}) as Partial<DelegatedMetadata>
        return {
            requestId: tx.id,
            status: tx.status,
            delegatedSigningUrl: metadata.delegatedSigningUrl ?? '',
            userUrl: metadata.userUrl ?? '',
            signatures: metadata.signatures ?? [],
            ...(metadata.partyId ? { partyId: metadata.partyId } : {}),
            ...(metadata.commandId ? { commandId: metadata.commandId } : {}),
            ...(metadata.reason ? { reason: metadata.reason } : {}),
        }
    }

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

                const publicKey =
                    'publicKey' in params.keyIdentifier
                        ? (params.keyIdentifier.publicKey as string)
                        : ''

                const metadata: DelegatedMetadata = {
                    delegatedSigningUrl: delegated.delegatedSigningUrl,
                    userUrl,
                    userUrlKind: 'handoff',
                    signatures: [],
                    ...(delegated.partyId
                        ? { partyId: delegated.partyId }
                        : {}),
                    ...(delegated.commandId
                        ? { commandId: delegated.commandId }
                        : {}),
                }

                const now = new Date()
                await this.store.setSigningTransaction(userId, {
                    id: requestId,
                    hash: params.txHash,
                    publicKey,
                    status: 'pending',
                    metadata,
                    createdAt: now,
                    updatedAt: now,
                })

                return {
                    txId: requestId,
                    status: 'pending',
                    ...(publicKey ? { publicKey } : {}),
                    metadata,
                }
            },

            signMessage: async (): Promise<SignMessageResult> => {
                return {
                    error: 'not_allowed',
                    error_description:
                        'A decentralized party holds no key here, so it cannot sign an arbitrary message.',
                }
            },

            getTransaction: async (
                params: GetTransactionParams
            ): Promise<GetTransactionResult> => {
                if (userId === undefined) {
                    return {
                        error: 'transaction_not_found',
                        error_description:
                            'A delegated signing request needs a user context.',
                    }
                }
                const tx = await this.store.getSigningTransaction(
                    userId,
                    params.txId
                )
                if (!tx) {
                    return {
                        error: 'transaction_not_found',
                        error_description:
                            'The requested transaction does not exist.',
                    }
                }
                return DecentralizedSigningDriver.toTransaction(tx)
            },

            getTransactions: async (
                params: GetTransactionsParams
            ): Promise<GetTransactionsResult> => {
                if (userId === undefined) return { transactions: [] }
                const found =
                    await this.store.listSigningTransactionsByTxIdsAndPublicKeys(
                        params.txIds ?? [],
                        params.publicKeys ?? []
                    )
                return {
                    transactions: found.map(
                        DecentralizedSigningDriver.toTransaction
                    ),
                }
            },

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

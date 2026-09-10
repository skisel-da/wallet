// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { DappAsyncProvider } from '@canton-network/core-provider-dapp'
import buildController from './dapp-api/rpc-gen'
import {
    ConnectResult,
    LedgerApiParams,
    MessageSignatureEvent,
    Network,
    PrepareExecuteAndWaitResult,
    PrepareExecuteParams,
    SignMessageParams,
    SignMessageResult,
    SignTopologyTransactionsParams,
    SignTopologyTransactionsResult,
    SignPreparedTransactionParams,
    SignPreparedTransactionResult,
    TopologyTransactionsSignatureEvent,
    PreparedTransactionSignatureEvent,
    Wallet,
} from './dapp-api/rpc-gen/typings'
import { ErrorCode } from './error'
import { popup } from '@canton-network/core-wallet-ui-components'
import * as dappAsyncAPI from '@canton-network/core-wallet-dapp-remote-rpc-client'

const withTimeout = (
    reject: (reason?: unknown) => void,
    details: string,
    timeoutMs: number = 5 * 60 * 1000 // default to 5 minutes
) =>
    setTimeout(() => {
        console.warn(`SDK: ${details}`)
        reject({
            status: 'error',
            error: ErrorCode.Timeout,
            details,
        })
    }, timeoutMs)

// The wallet says what the page IS; this decides how to show it.
//
// An 'approval' is this wallet's own short-lived approve page -- the shared
// popup is exactly right for it. A 'handoff' is a different application where
// the party's other owners take part and the user may stay for a long time;
// the 400x600 popup is the wrong frame for that, so it gets a normal tab.
//
// Note this is not the old openInNewWindow flag reinstated. That was a browser
// instruction in the protocol, and it was also load-bearing for a bug -- a
// window-name collision that let a wallet page hijack the window it was
// opening, since fixed in popup.ts. What travels now is a fact about the page,
// which a non-browser client can act on too.
const openUserUrl = (response: {
    userUrl?: string
    userUrlKind?: 'approval' | 'handoff'
}) => {
    if (!response.userUrl) return
    if (response.userUrlKind === 'handoff') {
        // No feature string: passing one makes some browsers open a popup
        // window rather than a tab, which is the very thing being avoided.
        window.open(response.userUrl, '_blank')
        return
    }
    popup.open(response.userUrl)
}

export const dappSDKController = (provider: DappAsyncProvider) =>
    buildController({
        connect: async (): Promise<ConnectResult> => {
            const response = await provider.request({
                method: 'connect',
            })

            popup.open(response.userUrl ?? '')
            const promise = new Promise<ConnectResult>((resolve, reject) => {
                // 5 minutes timeout
                const timeout = withTimeout(
                    reject,
                    'Timeout waiting for connection',
                    5 * 60 * 1000
                )
                provider.on<dappAsyncAPI.StatusEvent>(
                    'statusChanged',
                    (event) => {
                        if (event.connection.isConnected) {
                            clearTimeout(timeout)
                            resolve(event.connection)
                        }
                    }
                )
            })

            return promise
        },
        disconnect: async () => {
            return await provider.request({
                method: 'disconnect',
            })
        },
        isConnected: async () => {
            return await provider.request({
                method: 'isConnected',
            })
        },
        ledgerApi: async (params: LedgerApiParams) =>
            provider.request({
                method: 'ledgerApi',
                params,
            }),
        prepareExecute: async (params: PrepareExecuteParams) => {
            const response = await provider.request({
                method: 'prepareExecute',
                params,
            })

            openUserUrl(response)

            return null
        },
        prepareExecuteAndWait: async (
            params: PrepareExecuteParams
        ): Promise<PrepareExecuteAndWaitResult> => {
            const commandId = params.commandId ?? crypto.randomUUID()
            const response = await provider.request({
                method: 'prepareExecute',
                params: {
                    ...params,
                    commandId,
                },
            })

            openUserUrl(response)

            const promise = new Promise<PrepareExecuteAndWaitResult>(
                (resolve, reject) => {
                    const timeout = withTimeout(
                        reject,
                        'Timed out waiting for transaction approval'
                    )

                    const listener = (event: dappAsyncAPI.TxChangedEvent) => {
                        if (event.commandId !== commandId) return
                        if (event.status === 'failed') {
                            provider.removeListener('txChanged', listener)
                            clearTimeout(timeout)
                            reject({
                                status: 'error',
                                error: ErrorCode.TransactionFailed,
                                details: `Transaction with commandId ${event.commandId} failed to execute.`,
                            })
                        }
                        if (event.status === 'executed') {
                            provider.removeListener('txChanged', listener)
                            clearTimeout(timeout)
                            resolve({
                                tx: event,
                            })
                        }
                    }

                    provider.on<dappAsyncAPI.TxChangedEvent>(
                        'txChanged',
                        listener
                    )
                }
            )

            return promise
        },
        status: async () => {
            return provider.request({ method: 'status' })
        },
        listAccounts: async () =>
            provider.request({
                method: 'listAccounts',
            }),
        accountsChanged: async () => {
            throw new Error('Only for events.')
        },
        txChanged: async () => {
            throw new Error('Only for events.')
        },
        getActiveNetwork: async (): Promise<Network> =>
            provider.request({
                method: 'getActiveNetwork',
            }),
        signMessage: async (
            params: SignMessageParams
        ): Promise<SignMessageResult> => {
            const response = await provider.request({
                method: 'signMessage',
                params,
            })
            const { userUrl } = response
            popup.open(userUrl)

            const messageId = new URL(userUrl).searchParams.get('messageId')
            if (!messageId) {
                throw new Error(
                    'Remote signMessage userUrl is missing messageId query param'
                )
            }

            return await new Promise<SignMessageResult>((resolve, reject) => {
                const timeout = withTimeout(
                    reject,
                    'Timed out waiting for message signing approval'
                )

                const listener = (
                    event: dappAsyncAPI.MessageSignatureEvent
                ) => {
                    if (event.messageId !== messageId) return

                    // pending is informational; continue waiting
                    if (event.status === 'pending') return

                    provider.removeListener('messageSignature', listener)
                    clearTimeout(timeout)

                    if (event.status === 'failed') {
                        reject({
                            status: 'error',
                            error: ErrorCode.TransactionFailed,
                            details: `Message signing failed for messageId ${event.messageId}.`,
                        })
                        return
                    }

                    resolve({ signature: event.signature })
                }

                provider.on<dappAsyncAPI.MessageSignatureEvent>(
                    'messageSignature',
                    listener
                )
            })
        },
        signTopologyTransactions: async (
            params: SignTopologyTransactionsParams
        ): Promise<SignTopologyTransactionsResult> => {
            const response = await provider.request({
                method: 'signTopologyTransactions',
                params,
            })
            const { requestId, userUrl } = response
            popup.open(userUrl)

            return await new Promise<SignTopologyTransactionsResult>(
                (resolve, reject) => {
                    const timeout = withTimeout(
                        reject,
                        'Timed out waiting for topology-transactions signing approval'
                    )

                    const listener = (
                        event: dappAsyncAPI.TopologyTransactionsSignatureEvent
                    ) => {
                        if (event.requestId !== requestId) return

                        // pending is informational; continue waiting
                        if (event.status === 'pending') return

                        provider.removeListener(
                            'topologyTransactionsSignature',
                            listener
                        )
                        clearTimeout(timeout)

                        if (event.status === 'failed') {
                            reject({
                                status: 'error',
                                error: ErrorCode.TransactionFailed,
                                details: `Topology-transactions signing failed for requestId ${event.requestId}.`,
                            })
                            return
                        }

                        resolve({
                            signature: event.signature,
                            multiHash: event.multiHash,
                        })
                    }

                    provider.on<dappAsyncAPI.TopologyTransactionsSignatureEvent>(
                        'topologyTransactionsSignature',
                        listener
                    )
                }
            )
        },
        signPreparedTransaction: async (
            params: SignPreparedTransactionParams
        ): Promise<SignPreparedTransactionResult> => {
            const response = await provider.request({
                method: 'signPreparedTransaction',
                params,
            })
            const { requestId, userUrl } = response
            popup.open(userUrl)

            return await new Promise<SignPreparedTransactionResult>(
                (resolve, reject) => {
                    const timeout = withTimeout(
                        reject,
                        'Timed out waiting for prepared-transaction signing approval'
                    )

                    const listener = (
                        event: dappAsyncAPI.PreparedTransactionSignatureEvent
                    ) => {
                        if (event.requestId !== requestId) return

                        // pending is informational; continue waiting
                        if (event.status === 'pending') return

                        provider.removeListener(
                            'preparedTransactionSignature',
                            listener
                        )
                        clearTimeout(timeout)

                        if (event.status === 'failed') {
                            reject({
                                status: 'error',
                                error: ErrorCode.TransactionFailed,
                                details: `Prepared-transaction signing failed for requestId ${event.requestId}.`,
                            })
                            return
                        }

                        resolve({
                            signature: event.signature,
                            signedBy: event.signedBy,
                        })
                    }

                    provider.on<dappAsyncAPI.PreparedTransactionSignatureEvent>(
                        'preparedTransactionSignature',
                        listener
                    )
                }
            )
        },
        getPrimaryAccount: async (): Promise<Wallet> =>
            provider.request({
                method: 'getPrimaryAccount',
            }),
        messageSignature: function (): Promise<MessageSignatureEvent> {
            throw new Error('Only for events.')
        },
        topologyTransactionsSignature:
            function (): Promise<TopologyTransactionsSignatureEvent> {
                throw new Error('Only for events.')
            },
        preparedTransactionSignature:
            function (): Promise<PreparedTransactionSignatureEvent> {
                throw new Error('Only for events.')
            },
    })

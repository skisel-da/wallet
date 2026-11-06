// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { DappAsyncProvider } from '@canton-network/core-provider-dapp'
import buildController from './dapp-api/rpc-gen'
import type {
    ConnectResult,
    LedgerApiParams,
    MessageSignatureEvent,
    Network,
    PrepareExecuteAndWaitResult,
    PrepareExecuteParams,
    SignMessageParams,
    SignMessageResult,
    Wallet,
} from './dapp-api/rpc-gen/typings'
import { rpcErrors } from '@canton-network/core-rpc-errors'
import { popup } from '@canton-network/core-wallet-ui-components'
import { ErrorCode } from './error'
import type * as dappAsyncAPI from '@canton-network/core-wallet-dapp-remote-rpc-client'

const withTimeout = (
    reject: (reason?: unknown) => void,
    details: string,
    timeoutMs: number = 5 * 60 * 1000 // default to 5 minutes
) =>
    setTimeout(() => {
        console.warn(`SDK: ${details}`)
        reject(rpcErrors.resourceUnavailable(details))
    }, timeoutMs)

export const dappSDKController = (provider: DappAsyncProvider) =>
    buildController({
        connect: async (): Promise<ConnectResult> => {
            const response = await provider.request({
                method: 'connect',
            })

            const win = popup.open(response.userUrl ?? '')
            const promise = new Promise<ConnectResult>((resolve, reject) => {
                let settled = false
                const settle = (finish: () => void) => {
                    if (settled) return
                    settled = true
                    clearTimeout(timeout)
                    clearInterval(closedPoller)
                    window.removeEventListener('message', onMessage)
                    finish()
                }
                const cancelled = (details: string) =>
                    settle(() =>
                        reject({
                            status: 'error',
                            error: ErrorCode.UserCancelled,
                            details,
                        })
                    )

                // 5 minutes timeout
                const timeout = withTimeout(
                    reject,
                    'Timeout waiting for connection',
                    5 * 60 * 1000
                )

                // CIP-103 has no "connection declined" result. A wallet can
                // say so explicitly with SPLICE_WALLET_CONNECT_REJECTED from
                // the window this opened (an extension of the protocol, see
                // the decentralizer PoC); any other wallet's user declines by
                // closing the window, so a closed window counts too -- after
                // one last status check, since a wallet may close its window
                // right after succeeding.
                const onMessage = (event: MessageEvent) => {
                    if (
                        event.source !== win ||
                        event.data?.type !== 'SPLICE_WALLET_CONNECT_REJECTED'
                    )
                        return
                    cancelled('The wallet declined the connection.')
                }
                window.addEventListener('message', onMessage)

                const closedPoller = setInterval(() => {
                    if (!win.closed) return
                    clearInterval(closedPoller)
                    provider
                        .request({ method: 'status' })
                        .then((status) => {
                            if (!status.connection.isConnected) {
                                throw new Error('not connected')
                            }
                            settle(() => resolve(status.connection))
                        })
                        .catch(() =>
                            cancelled(
                                'The wallet window was closed before connecting.'
                            )
                        )
                }, 500)

                provider.on<dappAsyncAPI.StatusEvent>(
                    'statusChanged',
                    (event) => {
                        if (event.connection.isConnected) {
                            settle(() => resolve(event.connection))
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

            if (response.userUrl) popup.open(response.userUrl)

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

            if (response.userUrl) popup.open(response.userUrl)

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
                            reject(
                                rpcErrors.transactionRejected(
                                    `Transaction with commandId ${event.commandId} failed to execute.`
                                )
                            )
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
            const { messageId, userUrl } = response
            popup.open(userUrl)

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
                        // The event cannot tell a user rejection from a signing failure.
                        reject(
                            rpcErrors.transactionRejected(
                                `Message signing failed for messageId ${event.messageId}.`
                            )
                        )
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
        getPrimaryAccount: async (): Promise<Wallet> =>
            provider.request({
                method: 'getPrimaryAccount',
            }),
        messageSignature: function (): Promise<MessageSignatureEvent> {
            throw new Error('Only for events.')
        },
    })

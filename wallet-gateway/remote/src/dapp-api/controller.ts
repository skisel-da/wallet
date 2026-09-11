// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    assertConnected,
    AuthContext,
    AuthTokenProvider,
} from '@canton-network/core-wallet-auth'
import buildController from './rpc-gen/index.js'
import {
    ConnectResult,
    LedgerApiParams,
    LedgerApiResult,
    MessageSignatureEvent,
    Network,
    PrepareExecuteParams,
    PreparedTransactionSignatureEvent,
    SignMessageParams,
    SignMessageResult,
    SignPreparedTransactionParams,
    SignPreparedTransactionResult,
    SignTopologyTransactionsParams,
    SignTopologyTransactionsResult,
    StatusEvent,
    TopologyTransactionsSignatureEvent,
    Wallet,
} from './rpc-gen/typings.js'
import { Store, Transaction } from '@canton-network/core-wallet-store'
import {
    LedgerClient,
    GetEndpoint,
    PostEndpoint,
    PrepareSubmissionResponse,
    isValidGetEndpoint,
    isValidPostEndpoint,
} from '@canton-network/core-ledger-client'
import { v4 } from 'uuid'
import { NotificationService } from '../notification/NotificationService.js'
import { KernelInfo as KernelInfoConfig } from '../config/Config.js'
import { Logger } from 'pino'
import { networkStatus, ledgerPrepareParams, logDynamically } from '../utils.js'
import type { Network as StoreNetwork } from '@canton-network/core-wallet-store'
import { TransactionService } from '../ledger/transaction-service.js'
import { SigningProvider } from '@canton-network/core-signing-lib'
import { buildDelegatedHandoff } from '../signing/delegated-handoff.js'

import { SigningDrivers } from '../signing/signing-drivers.js'
import { rpcErrors } from '@canton-network/core-rpc-errors'
import { HASHING_SCHEME_VERSION } from '../env.js'
import {
    decodeVersionedTopologyTransaction,
    hashPreparedTransaction,
    summarizeTopologyTransaction,
} from '@canton-network/core-tx-visualizer'

export interface DappControllerDeps {
    signingDrivers: SigningDrivers
}

export const dappController = (
    kernelInfo: KernelInfoConfig,
    dappUrl: string,
    userUrl: string,
    store: Store,
    notificationService: NotificationService,
    _logger: Logger,
    origin: string | null,
    deps: DappControllerDeps,
    hashingSchemeVersion: HASHING_SCHEME_VERSION,
    context?: AuthContext
) => {
    const logger = _logger.child({ component: 'dapp-controller' })

    function assertActAsPartiesBelongToUser(
        actAs: string[],
        wallets: Wallet[]
    ): void {
        for (const party of actAs) {
            if (wallets.find((w) => w.partyId === party) === undefined) {
                throw rpcErrors.invalidRequest(
                    `Acting party ${party} does not belong to user`
                )
            }
        }
    }

    return buildController({
        connect: async () => {
            const session =
                context && (await store.getSession(context.accessToken))

            if (!context || !session) {
                return {
                    isConnected: false,
                    isNetworkConnected: false,
                    networkReason: 'Unauthenticated',
                    userUrl: `${userUrl}/login/`,
                } satisfies ConnectResult
            }

            const network = await store.getCurrentNetwork()
            const ledgerClient = new LedgerClient({
                baseUrl: new URL(network.ledgerApi.baseUrl),
                logger,
                accessTokenProvider: AuthTokenProvider.fromToken(
                    context.accessToken,
                    logger
                ),
            })

            const status = await networkStatus(ledgerClient)
            const notifier = notificationService.getNotifier(session.id)
            const provider = {
                id: kernelInfo.id,
                version: 'TODO',
                providerType: kernelInfo.clientType,
                url: dappUrl,
                userUrl: `${userUrl}/login/`,
            }
            const connection = {
                isConnected: true,
                reason: 'OK',
                isNetworkConnected: status.isConnected,
                networkReason: status.reason ? status.reason : 'OK',
                userUrl: `${userUrl}/login/`,
            }
            const statusEvent: StatusEvent = {
                provider,
                connection,
                network: {
                    networkId: network.id,
                    ledgerApi: network.ledgerApi.baseUrl,
                    accessToken: context.accessToken,
                },
                session: {
                    accessToken: context.accessToken,
                    userId: context.userId,
                },
            }
            notifier.emit('statusChanged', statusEvent)
            notifier.emit('connected', statusEvent)
            return connection
        },
        disconnect: async () => {
            if (!context) return null

            const session = await store.getSession(context.accessToken)
            if (!session?.id) {
                return null
            } else {
                const notifier = notificationService.getNotifier(session.id)
                await store.removeSession(context.accessToken)
                notifier.emit('statusChanged', {
                    provider: {
                        id: kernelInfo.id,
                        providerType: kernelInfo.clientType,
                        url: dappUrl,
                        userUrl: `${userUrl}/login/`,
                    },
                    connection: {
                        isConnected: false,
                        reason: 'disconnect',
                        isNetworkConnected: false,
                        networkReason: 'disconnect',
                    },
                } as StatusEvent)
            }

            return null
        },
        isConnected: async () => {
            if (!context || !(await store.getSession(context.accessToken))) {
                return {
                    isConnected: false,
                    isNetworkConnected: false,
                    networkReason: 'Unauthenticated',
                    userUrl: `${userUrl}/login/`,
                } satisfies ConnectResult
            }

            const network = await store.getCurrentNetwork()
            const ledgerClient = new LedgerClient({
                baseUrl: new URL(network.ledgerApi.baseUrl),
                logger,
                accessTokenProvider: AuthTokenProvider.fromToken(
                    context.accessToken,
                    logger
                ),
            })
            const status = await networkStatus(ledgerClient)
            return {
                isConnected: true,
                reason: 'OK',
                isNetworkConnected: status.isConnected,
                networkReason: status.reason ? status.reason : 'OK',
                userUrl: `${userUrl}/login/`,
            } satisfies ConnectResult
        },
        ledgerApi: async (params: LedgerApiParams) => {
            const connectedContext = assertConnected(context)
            const network = await store.getCurrentNetwork()
            const ledgerClient = new LedgerClient({
                baseUrl: new URL(network.ledgerApi.baseUrl),
                logger,
                accessTokenProvider: AuthTokenProvider.fromToken(
                    connectedContext.accessToken,
                    logger
                ),
            })

            let result: LedgerApiResult

            switch (params.requestMethod) {
                case 'get':
                    if (!isValidGetEndpoint(params.resource)) {
                        throw new Error(
                            `Unsupported get resource: ${params.resource}`
                        )
                    }
                    result = await ledgerClient.getWithRetry(
                        params.resource as GetEndpoint,
                        undefined,
                        { path: params.path ?? {}, query: params.query ?? {} }
                    )
                    break
                case 'post': {
                    if (!isValidPostEndpoint(params.resource)) {
                        throw new Error(
                            `Unsupported post resource: ${params.resource}`
                        )
                    }

                    let body = params.body

                    // AllocateExternalPartyRequest.user_id (field 6, see
                    // com/daml/ledger/api/v2/admin/party_management_service.proto):
                    // "The user who will get the act_as rights to the newly
                    // allocated party." The dApp calling this generic
                    // passthrough has no business knowing about ledger-api
                    // userIds -- every other business-specific RPC here
                    // (submitDelegatedSignatures, prepareExecute, ...) already
                    // derives and fills this in server-side from the
                    // session itself, so this generic one should too rather
                    // than requiring the caller to supply it. Same
                    // ledgerUserId derivation as submitDelegatedSignatures below.
                    if (
                        // Cast around core-ledger-client's isValidPostEndpoint
                        // -- it incorrectly narrows to `resource is GetEndpoint`
                        // (a pre-existing bug, unrelated to this change), which
                        // would otherwise make this comparison a type error.
                        (params.resource as string) ===
                        '/v2/parties/external/allocate'
                    ) {
                        const ledgerUserId = connectedContext.isApiKey
                            ? connectedContext.ledgerUserId
                            : connectedContext.userId
                        body = { ...body, userId: ledgerUserId }
                    }

                    result = await ledgerClient.postWithRetry(
                        params.resource as PostEndpoint,
                        body as never,
                        undefined,
                        { query: params.query ?? {}, path: params.path ?? {} }
                    )
                    break
                }
                default:
                    throw new Error(
                        `Unsupported request method: ${params.requestMethod}`
                    )
            }
            return result
        },
        prepareExecute: async (params: PrepareExecuteParams) => {
            const primaryWallet = await store.getPrimaryWallet()
            const wallets = await store.getWallets()
            const network = await store.getCurrentNetwork()

            if (context === undefined) {
                throw new Error('Unauthenticated context')
            }

            // determine user ID
            const gatewayUserId = context.userId
            let ledgerUserId = context.userId
            const accessTokenProvider: AuthTokenProvider =
                AuthTokenProvider.fromToken(context.accessToken, logger)

            if (context?.isApiKey) {
                logger.info(
                    'Authenticated with API Key, fetching m2m token for ledger access'
                )
                ledgerUserId = context.ledgerUserId
            }

            // determine party ID
            let actAs = params.actAs || []
            if (actAs.length === 0) {
                if (!primaryWallet) {
                    throw new Error(
                        'No primary wallet found. Create or sync a wallet and set it as primary before prepareExecute.'
                    )
                }
                actAs = [primaryWallet.partyId]
            }

            assertActAsPartiesBelongToUser(actAs, wallets)

            // determine wallet
            const wallet = wallets.find((w) => w.partyId === actAs[0])
            if (wallet === undefined) {
                throw new Error(
                    'No wallet found for the first acting party. Create or sync a wallet and set it as primary before prepareExecute.'
                )
            }

            const ledgerClient = new LedgerClient({
                baseUrl: new URL(network.ledgerApi.baseUrl),
                logger,
                accessTokenProvider,
            })

            const session = await store.getSession(context.accessToken)
            if (!session) {
                throw new Error('No active session found')
            }
            const notifier = notificationService.getNotifier(session.id)

            const commandId = params.commandId || v4()
            const transactionId = v4()

            notifier.emit('txChanged', { status: 'pending', commandId })

            const synchronizerId =
                network.synchronizerId ??
                (await ledgerClient.getSynchronizerId())

            logDynamically(
                logger,
                'prepareExecute: Submitting request to ledger',
                {
                    info: { transactionId },
                    debug: {
                        commandId,
                        gatewayUserId,
                        ledgerUserId,
                        actAs,
                        params,
                    },
                }
            )

            const prepared = await prepareSubmission(
                ledgerUserId,
                actAs,
                synchronizerId,
                params,
                ledgerClient,
                hashingSchemeVersion
            )

            logDynamically(
                logger,
                'prepareExecute: Received response from ledger',
                {
                    info: { transactionId },
                    debug: {
                        commandId,
                        gatewayUserId,
                        ledgerUserId,
                        actAs,
                        prepared,
                    },
                }
            )

            const transaction: Transaction = {
                id: transactionId,
                commandId,
                status: 'pending',
                preparedTransaction: prepared.preparedTransaction,
                preparedTransactionHash: prepared.preparedTransactionHash,
                payload: params,
                origin: origin || null,
                createdAt: new Date(),
                // Recorded so a request parked with a signing provider can be
                // completed later by whoever finalizes it, who is generally
                // not this caller: a delegated party's owners each
                // authenticate separately, and the parked request is keyed by
                // the user who prepared it.
                userId: gatewayUserId,
            }

            logger.info(
                {
                    actAs,
                    readAs: params.readAs || [],
                    gatewayUserId,
                    ledgerUserId,
                    commandId,
                    commands: params.commands?.[0],
                    confirmationRequestTrafficCostEstimation:
                        prepared.costEstimation
                            ?.confirmationRequestTrafficCostEstimation,
                },
                'prepared transaction traffic estimation'
            )

            // A party whose signing is delegated (signingProviderId
            // 'decentralized') has no key here that can authorize anything.
            // The gateway builds the handoff URL and then steps out entirely:
            // the coordinator collects the owners' signatures and submits to
            // Canton itself.
            //
            // Because the gateway is not going to complete this transaction,
            // it deliberately keeps no record of it. A pending Transaction row
            // would never be closed by anyone -- the owner who finalizes is
            // usually a different gateway account from the one who prepared,
            // and closing a row is a scoped store write they cannot make -- so
            // every coordinated transaction would leak one. Nothing reads the
            // row on this path either: unlike the approve page, which fetches
            // the prepared transaction back by transactionId, the coordination
            // URL carries it directly.
            const isDelegated =
                wallet.signingProviderId === SigningProvider.DECENTRALIZED

            if (context.isApiKey && isDelegated) {
                // A service account has no browser to send anywhere, and a
                // delegated party cannot complete without one.
                throw new Error(
                    `Party ${wallet.partyId} delegates signing to an external coordinator -- it cannot be signed for via an API key/service account.`
                )
            }

            let approveUrl = `${userUrl}/approve/index.html?transactionId=${transactionId}&commandId=${commandId}&closeafteraction`
            let userUrlKind: 'approval' | 'handoff' = 'approval'

            if (isDelegated) {
                // The only place in the system where Canton's own hash and
                // core-tx-visualizer's independent recompute of it are both
                // authentic and in hand at once. Everything downstream signs
                // the recomputed hash -- each owner's wallet derives it from
                // the prepared transaction itself -- so if the visualizer's
                // hashing scheme ever drifts from Canton's (it pins V2), every
                // owner would sign a hash Canton disagrees with, and nothing
                // would say so until the finalizing owner's executeAndWait is
                // rejected, on another gateway, after the whole signing round.
                //
                // Checked here rather than at sign time: once per transaction
                // instead of once per owner, before a URL is built or anything
                // is written to a ledger. Deliberately scoped to this branch --
                // the ordinary approve path signs the Canton hash stored on the
                // Transaction row and never consults the visualizer, so a
                // divergence does not affect it and must not fail it.
                const recomputedHash = await hashPreparedTransaction(
                    prepared.preparedTransaction
                )
                if (recomputedHash !== prepared.preparedTransactionHash) {
                    throw new Error(
                        `Cannot coordinate a signature for party ${wallet.partyId}: this gateway recomputes the prepared transaction's hash as ${recomputedHash}, but the ledger returned ${prepared.preparedTransactionHash}. The hashing scheme used to prepare and the one used to sign have diverged; signatures collected against the recomputed hash would be rejected on submission.`
                    )
                }

                const handoff = await buildDelegatedHandoff(
                    deps!.signingDrivers,
                    gatewayUserId,
                    wallet,
                    {
                        requestId: transactionId,
                        preparedTransaction: prepared.preparedTransaction,
                        preparedTransactionHash:
                            prepared.preparedTransactionHash,
                        commandId,
                    }
                )
                approveUrl = handoff.userUrl
                userUrlKind = handoff.userUrlKind
            } else {
                await store.setTransaction(transaction)
            }

            if (context.isApiKey) {
                logger.info(
                    {
                        gatewayUserId,
                        ledgerUserId,
                        commandId,
                        transactionId,
                        signingProviderId: wallet.signingProviderId,
                    },
                    'Service account straight-through prepare/sign/execute'
                )
                const transactionService = new TransactionService(
                    store,
                    logger,
                    deps!.signingDrivers,
                    notifier,
                    hashingSchemeVersion
                )
                try {
                    await transactionService.signAndExecute(
                        context,
                        network,
                        wallet,
                        transaction
                    )
                } catch (error) {
                    logger.error(
                        {
                            err: error,
                            gatewayUserId,
                            ledgerUserId,
                            commandId,
                            transactionId,
                            actAs,
                            signingProviderId: wallet.signingProviderId,
                        },
                        'Service account sign/execute failed after prepare'
                    )
                    throw error
                }
            }

            // The closeafteraction flag on the ordinary approve page makes
            // approving or deleting a tx close the popup. A coordinator URL
            // carries no such flag: it is a different application, where the
            // party's other owners take part and the user may stay a while.
            //
            // userUrlKind says which of those this is. It is a statement
            // about the page, not an instruction about windows -- a browser
            // client gives a handoff a real tab instead of a cramped popup,
            // and a CLI or mobile client can act on the same distinction.
            return { userUrl: approveUrl, userUrlKind }
        },
        status: async () => {
            const provider = {
                id: kernelInfo.id,
                version: 'TODO',
                providerType: kernelInfo.clientType,
                url: dappUrl,
                userUrl: `${userUrl}/login/`,
            }
            if (!context || !(await store.getSession(context.accessToken))) {
                return {
                    provider: provider,
                    connection: {
                        isConnected: false,
                        reason: 'Unauthenticated',
                        isNetworkConnected: false,
                        networkReason: 'Unauthenticated',
                    },
                }
            }

            const session = await store.getSession(context.accessToken)
            const network = await store.getCurrentNetwork()
            const ledgerClient = new LedgerClient({
                baseUrl: new URL(network.ledgerApi.baseUrl),
                logger,
                accessTokenProvider: AuthTokenProvider.fromToken(
                    context.accessToken,
                    logger
                ),
            })
            const status = await networkStatus(ledgerClient)
            return {
                provider: provider,
                connection: {
                    isConnected: true,
                    reason: 'OK',
                    isNetworkConnected: status.isConnected,
                    networkReason: status.reason ? status.reason : 'OK',
                },
                network: {
                    networkId: network.id,
                    ledgerApi: network.ledgerApi.baseUrl,
                    accessToken: context.accessToken,
                },
                session: {
                    id: session?.id,
                    accessToken: context.accessToken,
                    userId: context.userId,
                },
                userUrl: `${userUrl}/login/`,
            }
        },
        listAccounts: async () => {
            return await store.getWallets()
        },
        getActiveNetwork: async (): Promise<Network> => {
            const network: StoreNetwork = await store.getCurrentNetwork()
            return {
                networkId: network.id,
                ledgerApi: network.ledgerApi.baseUrl,
                ...(context?.accessToken
                    ? { accessToken: context.accessToken }
                    : {}),
            }
        },
        signMessage: async (
            params: SignMessageParams
        ): Promise<SignMessageResult> => {
            if (!params?.message) throw new Error('Message is required')

            const wallet = await store.getPrimaryWallet()

            if (context === undefined) {
                throw new Error('Unauthenticated context')
            }

            if (wallet === undefined) {
                throw new Error('No primary wallet found')
            }

            const session = await store.getSession(context.accessToken)
            const sessionId = session!.id
            const notifier = notificationService.getNotifier(sessionId)
            const messageId = v4()
            await store.setMessageRaw({
                id: messageId,
                status: 'pending',
                userId: context.userId,
                partyId: wallet.partyId,
                publicKey: wallet.publicKey,
                message: params.message,
                origin: origin || null,
                createdAt: new Date(),
            })

            notifier.emit('messageSignature', {
                status: 'pending',
                messageId,
            } satisfies MessageSignatureEvent)

            return {
                messageId,
                userUrl: `${userUrl}/sign-message/index.html?messageId=${messageId}&closeafteraction`,
            }
        },
        signTopologyTransactions: async (
            params: SignTopologyTransactionsParams
        ): Promise<SignTopologyTransactionsResult> => {
            if (!params?.transactions || params.transactions.length === 0) {
                throw new Error('At least one transaction is required')
            }

            const wallet = await store.getPrimaryWallet()

            if (context === undefined) {
                throw new Error('Unauthenticated context')
            }

            if (wallet === undefined) {
                throw new Error('No primary wallet found')
            }

            const session = await store.getSession(context.accessToken)
            const sessionId = session!.id
            const notifier = notificationService.getNotifier(sessionId)
            const requestId = v4()

            // Receipt time: decode + summarize each transaction for display.
            // The decoded summary is never signed -- only the raw bytes
            // stored below (`transactions`) are, and only after being
            // recomputed fresh at sign time (see user-api's
            // `signTopologyTransactions`).
            const summaries = params.transactions.map((tx) => {
                try {
                    return summarizeTopologyTransaction(
                        decodeVersionedTopologyTransaction(tx)
                    )
                } catch (error) {
                    logger.warn(
                        { err: error },
                        'Failed to decode topology transaction for display; showing as unknown'
                    )
                    return {
                        kind: 'unknown' as const,
                        mappingKind: 'undecodable',
                    }
                }
            })

            await store.setTopologyBundleRaw({
                id: requestId,
                status: 'pending',
                userId: context.userId,
                partyId: wallet.partyId,
                publicKey: wallet.publicKey,
                transactions: params.transactions,
                summaries,
                ...(params.synchronizerId !== undefined
                    ? { synchronizerId: params.synchronizerId }
                    : {}),
                origin: origin || null,
                createdAt: new Date(),
            })

            notifier.emit('topologyTransactionsSignature', {
                status: 'pending',
                requestId,
            } satisfies TopologyTransactionsSignatureEvent)

            return {
                requestId,
                userUrl: `${userUrl}/sign-topology/index.html?requestId=${requestId}&closeafteraction`,
            }
        },
        signPreparedTransaction: async (
            params: SignPreparedTransactionParams
        ): Promise<SignPreparedTransactionResult> => {
            if (!params?.preparedTransaction) {
                throw new Error('preparedTransaction is required')
            }

            const wallet = await store.getPrimaryWallet()

            if (context === undefined) {
                throw new Error('Unauthenticated context')
            }

            if (wallet === undefined) {
                throw new Error('No primary wallet found')
            }

            const session = await store.getSession(context.accessToken)
            const sessionId = session!.id
            const notifier = notificationService.getNotifier(sessionId)
            const requestId = v4()

            // Unlike signTopologyTransactions, nothing is decoded/summarized
            // here -- core-tx-visualizer's parsePreparedTransaction decodes
            // preparedTransaction directly, on demand, the same way the
            // existing approve page already does for an ordinary
            // single-signer ledger transaction. The prepared transaction is
            // the only thing stored, and the hash that gets signed is derived
            // from it at sign time (see user-api's signPreparedTransaction):
            // a caller-supplied hash would be checked against these bytes and
            // then discarded, so there is no reason to ask for one.
            await store.setPreparedTransactionToSign({
                id: requestId,
                status: 'pending',
                userId: context.userId,
                partyId: wallet.partyId,
                publicKey: wallet.publicKey,
                preparedTransaction: params.preparedTransaction,
                origin: origin || null,
                createdAt: new Date(),
            })

            notifier.emit('preparedTransactionSignature', {
                status: 'pending',
                requestId,
            } satisfies PreparedTransactionSignatureEvent)

            return {
                requestId,
                userUrl: `${userUrl}/sign-prepared-transaction/index.html?requestId=${requestId}&closeafteraction`,
            }
        },
        getPrimaryAccount: async function (): Promise<Wallet> {
            const wallet = await store.getPrimaryWallet()
            if (!wallet) {
                throw new Error('No primary wallet found')
            }
            return wallet
        },
        connected: async () => {
            throw new Error('Only for events.')
        },
        onStatusChanged: async () => {
            throw new Error('Only for events.')
        },
        accountsChanged: async () => {
            throw new Error('Only for events.')
        },
        txChanged: async () => {
            throw new Error('Only for events.')
        },
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
}

async function prepareSubmission(
    userId: string,
    partyIds: string[],
    synchronizerId: string,
    params: PrepareExecuteParams,
    ledgerClient: LedgerClient,
    hashingSchemeVersion: HASHING_SCHEME_VERSION
): Promise<PrepareSubmissionResponse> {
    return await ledgerClient.postWithRetry(
        '/v2/interactive-submission/prepare',
        ledgerPrepareParams(
            userId,
            partyIds,
            synchronizerId,
            params,
            hashingSchemeVersion
        )
    )
}

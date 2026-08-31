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
    ExecuteWithSignaturesParams,
    ExecuteWithSignaturesResult,
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
            const network = await store.getCurrentNetwork()
            const ledgerClient = new LedgerClient({
                baseUrl: new URL(network.ledgerApi.baseUrl),
                logger,
                accessTokenProvider: AuthTokenProvider.fromToken(
                    assertConnected(context).accessToken,
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
                case 'post':
                    if (!isValidPostEndpoint(params.resource)) {
                        throw new Error(
                            `Unsupported post resource: ${params.resource}`
                        )
                    }
                    result = await ledgerClient.postWithRetry(
                        params.resource as PostEndpoint,
                        params.body as never,
                        undefined,
                        { query: params.query ?? {}, path: params.path ?? {} }
                    )
                    break
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

            await store.setTransaction(transaction)

            // A Safe-like party (wallet.safeAppUrl set, see
            // decentralizer-poc's docs/safe-execution-plan.md) has no single
            // key that can sign for it -- hand off to the companion app that
            // coordinates collecting every owner's signature, instead of
            // wallet-gateway's own one-signer approve flow.
            //
            // The prepared transaction is embedded directly in the redirect
            // URL rather than left as a transactionId reference the
            // companion app fetches later: whichever of the Safe party's
            // owners actually lands on this URL is not necessarily the same
            // wallet-gateway user who called prepareExecute (each owner logs
            // into the companion app independently, with their own
            // individual party -- see safe-execution-plan.md's session
            // decision), so there is no same-origin-authenticated way for
            // them to look this transactionId up afterwards. Once the
            // companion app turns this into its own coordination contract,
            // every other owner learns about it from that contract directly
            // (an ordinary ACS query), never from this URL or wallet-gateway's
            // Transaction store again.
            const approveUrl = wallet.safeAppUrl
                ? `${wallet.safeAppUrl}/coordinate?${new URLSearchParams({
                      preparedTransaction: prepared.preparedTransaction,
                      preparedTransactionHash: prepared.preparedTransactionHash,
                      partyId: wallet.partyId,
                      networkId: wallet.networkId,
                      commandId,
                  }).toString()}`
                : `${userUrl}/approve/index.html?transactionId=${transactionId}&commandId=${commandId}&closeafteraction`

            if (context.isApiKey && wallet.safeAppUrl) {
                // An API key/service account has no browser to redirect to
                // for multi-owner coordination -- fail clearly here rather
                // than attempting signAndExecute below, which would only
                // fail deep inside signWithParticipant with a less specific
                // message.
                throw new Error(
                    `Party ${wallet.partyId} is a Safe-like party coordinated by ${wallet.safeAppUrl} -- it cannot be signed for via an API key/service account.`
                )
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

            return {
                // For an ordinary wallet, the closeafteraction query param
                // flag makes approving or deleting tx close the popup. For a
                // Safe-like wallet, approveUrl points at the companion app
                // instead, which stays open for the whole multi-owner
                // coordination flow -- so it must land in its own browser
                // window rather than the SDK's shared wallet-popup window:
                // that window gets reused/renavigated by any later wallet
                // popup call (e.g. this same companion app's own
                // signPreparedTransaction, or "Manage wallets"), which would
                // otherwise hijack this page instead of opening separately.
                userUrl: approveUrl,
                ...(wallet.safeAppUrl ? { openInNewWindow: true } : {}),
            }
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
            if (
                !params?.preparedTransaction ||
                !params?.preparedTransactionHash
            ) {
                throw new Error(
                    'preparedTransaction and preparedTransactionHash are required'
                )
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
            // single-signer ledger transaction. Only the raw bytes are ever
            // signed; preparedTransactionHash is independently re-verified
            // against them at sign time (see user-api's
            // signPreparedTransaction), never trusted outright.
            await store.setPreparedTransactionToSign({
                id: requestId,
                status: 'pending',
                userId: context.userId,
                partyId: wallet.partyId,
                publicKey: wallet.publicKey,
                preparedTransaction: params.preparedTransaction,
                preparedTransactionHash: params.preparedTransactionHash,
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
        executeWithSignatures: async (
            params: ExecuteWithSignaturesParams
        ): Promise<ExecuteWithSignaturesResult> => {
            if (context === undefined) {
                throw new Error('Unauthenticated context')
            }

            let ledgerUserId = context.userId
            const accessTokenProvider: AuthTokenProvider =
                AuthTokenProvider.fromToken(context.accessToken, logger)
            if (context.isApiKey) {
                ledgerUserId = context.ledgerUserId
            }

            // Core security property, same as signPreparedTransaction: the
            // hash is recomputed fresh from the raw prepared-transaction
            // bytes and never trusted outright. It matters even more here
            // than at signing time -- this is the call that actually
            // submits to Canton, so a mismatch would mean submitting a
            // different transaction than the one every owner signed.
            const recomputedHash = await hashPreparedTransaction(
                params.preparedTransaction
            )
            if (recomputedHash !== params.preparedTransactionHash) {
                throw new Error(
                    `Prepared transaction hash mismatch: the independently recomputed hash does not match the one supplied by the caller`
                )
            }

            const network = await store.getCurrentNetwork()
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

            const transactionService = new TransactionService(
                store,
                logger,
                deps.signingDrivers,
                notifier
            )

            return await transactionService.executeWithSignatures(
                ledgerUserId,
                ledgerClient,
                params
            )
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

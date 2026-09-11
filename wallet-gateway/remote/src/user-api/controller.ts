// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Disabled unused vars rule to allow for future implementations
/* eslint-disable @typescript-eslint/no-unused-vars */
import { LedgerClient } from '@canton-network/core-ledger-client'
import buildController from './rpc-gen/index.js'
import {
    AddNetworkParams,
    RemoveNetworkParams,
    ExecuteParams,
    SignParams,
    SignMessageParams,
    SignMessageResult,
    GetMessageToSignParams,
    GetMessageToSignResult,
    ListMessagesToSignResult,
    DeleteMessageToSignParams,
    SignTopologyTransactionsParams,
    SignTopologyTransactionsResult,
    GetTopologyBundleToSignParams,
    GetTopologyBundleToSignResult,
    ListTopologyBundlesToSignResult,
    DeleteTopologyBundleToSignParams,
    TopologyBundleRaw as TopologyBundleRawDto,
    TopologyTransactionSummary as TopologyTransactionSummaryDto,
    SignPreparedTransactionParams,
    SignPreparedTransactionResult,
    GetPreparedTransactionToSignParams,
    GetPreparedTransactionToSignResult,
    DeletePreparedTransactionToSignParams,
    PreparedTransactionToSign as PreparedTransactionToSignDto,
    AddSessionParams,
    AddSessionResult,
    ListSessionsResult,
    SetPrimaryWalletParams,
    SyncWalletsResult,
    IsWalletSyncNeededResult,
    AddIdpParams,
    RemoveIdpParams,
    CreateWalletParams,
    AllocatePartyForWalletParams,
    ImportPartyParams,
    SetDelegatedSigningParams,
    GetTransactionResult,
    GetTransactionParams,
    DeleteTransactionParams,
    Null,
    ListTransactionsResult,
    GetUserResult,
    GetNetworkParams,
    GetNetworkResult,
    SelfSignedAccessTokenParams,
    SelfSignedAccessTokenResult,
    Network as ApiNetwork,
    PublicNetwork,
    GenerateApiKeyParams,
    GeneratedApiKey,
    ListApiKeysResult,
    RemoveApiKeyParams,
    ListTransactionsParams,
    ChangeSigningProviderParams,
    GetWalletParams,
    GetWalletResult,
    ListSigningProviderKeysParams,
    ListSigningProviderKeysResult,
} from './rpc-gen/typings.js'
import {
    Store,
    Network,
    TopologyBundleRaw as StoreTopologyBundleRaw,
    TopologyTransactionSummary as StoreTopologyTransactionSummary,
    PreparedTransactionToSign as StorePreparedTransactionToSign,
} from '@canton-network/core-wallet-store'
import {
    computeTopologyMultiHash,
    hashPreparedTransaction,
} from '@canton-network/core-tx-visualizer'
import { Logger } from 'pino'
import { NotificationService } from '../notification/NotificationService.js'
import {
    assertConnected,
    AuthContext,
    authSchema,
    Auth,
    AuthTokenProvider,
    idpSchema,
} from '@canton-network/core-wallet-auth'
import { KernelInfo } from '../config/Config.js'
import { WALLET_DISABLED_REASON } from '@canton-network/core-types'
import { isRpcError, SigningProvider } from '@canton-network/core-signing-lib'
import type { UpdateWallet } from '@canton-network/core-wallet-store'

/**
 * Rejects a coordinator URL the gateway would later hand a user's browser to.
 * Only http(s) is allowed: `javascript:` and `data:` URLs in particular would
 * otherwise turn the wallet's own redirect into a script-execution vector.
 */
function assertValidDelegatedSigningUrl(url: string): void {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        throw new Error(`delegatedSigningUrl is not a valid URL: ${url}`)
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(
            `delegatedSigningUrl must be an http(s) URL, got ${parsed.protocol}`
        )
    }
}

/**
 * Builds the wallet update that turns delegation on or off.
 *
 * The provider is pinned alongside the URL because wallet sync resolves a
 * provider by matching the party's namespace against each driver's keys, and a
 * decentralized namespace is no key's fingerprint -- left to itself, sync
 * labels the party PARTICIPANT and disables it on every pass. Clearing the URL
 * releases the pin and hands the wallet back to ordinary resolution.
 */
function delegatedSigningUpdate(
    partyId: string,
    networkId: string,
    url: string
): UpdateWallet {
    return url
        ? {
              partyId,
              networkId,
              delegatedSigningUrl: url,
              signingProviderId: SigningProvider.DECENTRALIZED,
              disabled: false,
              reason: '',
          }
        : {
              partyId,
              networkId,
              delegatedSigningUrl: null,
          }
}
import type { SigningDrivers } from '../signing/signing-drivers.js'
import { PartyAllocationService } from '../ledger/party-allocation-service.js'
import { WalletAllocationService } from '../ledger/wallet-allocation/wallet-allocation-service.js'
import { WalletSyncService } from '../ledger/wallet-sync-service.js'
import { logDynamically, networkStatus } from '../utils.js'
import { v4 } from 'uuid'
import { TransactionService } from '../ledger/transaction-service.js'
import { StatusEvent } from '../dapp-api/rpc-gen/typings.js'
import type {
    MessageSignatureEvent,
    TopologyTransactionsSignatureEvent,
    PreparedTransactionSignatureEvent,
    TxChangedFailedEvent,
} from '../dapp-api/rpc-gen/typings.js'
import { providerErrors, rpcErrors } from '@canton-network/core-rpc-errors'
import crypto from 'crypto'
import { assertTokenClaimsMatchNetwork } from './token-network-matching.js'
import { HASHING_SCHEME_VERSION } from '../env.js'

export const userController = (
    kernelInfo: KernelInfo,
    userUrl: string,
    store: Store,
    notificationService: NotificationService,
    authContext: AuthContext | undefined,
    drivers: SigningDrivers,
    _logger: Logger,
    hashingSchemeVersion: HASHING_SCHEME_VERSION,
    adminUserId?: string
) => {
    const logger = _logger.child({ component: 'user-controller' })
    const provider = {
        id: kernelInfo.id,
        version: 'TODO',
        providerType: kernelInfo.clientType,
        userUrl: `${userUrl}/login/`,
    }

    function isAdmin(): boolean {
        const userId = authContext?.userId
        return !!adminUserId && !!userId && userId === adminUserId
    }

    function assertAdmin(): void {
        const userId = assertConnected(authContext).userId
        if (!adminUserId || userId !== adminUserId) {
            throw new Error(
                'Unauthorized: only the admin user can perform this operation'
            )
        }
    }

    /**
     * Session responses always include user auth for the UI.
     * Privileged credentials are included only for the admin user.
     */
    function toSessionNetwork(network: Network): ApiNetwork {
        const dto = toNetworkDto(network)
        if (isAdmin()) {
            return dto
        }
        const { adminAuth: _adminAuth, serviceAccountAuth: _sa, ...rest } = dto
        return rest
    }

    const getSigningProviderKeys = async (
        params: ListSigningProviderKeysParams
    ) => {
        const network = await store.getCurrentNetwork()
        const idp = await store.getIdp(network.identityProviderId)

        if (!network.adminAuth) {
            throw new Error('No admin auth configured')
        }

        const adminAccessTokenProvider = AuthTokenProvider.fromGatewayConfig(
            idp,
            network.adminAuth,
            logger
        )
        const partyAllocator = new PartyAllocationService({
            synchronizerId: network.synchronizerId,
            accessTokenProvider: adminAccessTokenProvider,
            httpLedgerUrl: network.ledgerApi.baseUrl,
            logger,
        })
        const walletAllocationService = new WalletAllocationService(
            store,
            logger,
            partyAllocator,
            drivers
        )
        if (!drivers[params.signingProviderId as SigningProvider])
            throw new Error(
                `Signing provider ${params.signingProviderId} not supported`
            )
        const keys = await walletAllocationService.getKeys(
            assertConnected(authContext),
            params.signingProviderId as SigningProvider
        )
        if (!keys)
            throw new Error(`No keys ofr ${params.signingProviderId} found`)
        return keys
    }

    function toTopologyTransactionSummaryDto(
        summary: StoreTopologyTransactionSummary
    ): TopologyTransactionSummaryDto {
        switch (summary.kind) {
            case 'namespaceDelegation':
                return {
                    kind: summary.kind,
                    namespace: summary.namespace,
                    isRootDelegation: summary.isRootDelegation,
                }
            case 'decentralizedNamespaceDefinition':
                return {
                    kind: summary.kind,
                    decentralizedNamespace: summary.decentralizedNamespace,
                    threshold: summary.threshold,
                    owners: summary.owners,
                }
            case 'partyToParticipant':
                return {
                    kind: summary.kind,
                    party: summary.party,
                    threshold: summary.threshold,
                    participants: summary.participants,
                }
            case 'partyToKeyMapping':
                return {
                    kind: summary.kind,
                    party: summary.party,
                    threshold: summary.threshold,
                    signingKeyCount: summary.signingKeyCount,
                }
            case 'unknown':
                return {
                    kind: summary.kind,
                    mappingKind: summary.mappingKind,
                }
        }
    }

    function toTopologyBundleRawDto(
        bundle: StoreTopologyBundleRaw
    ): TopologyBundleRawDto {
        return {
            id: bundle.id,
            status: bundle.status,
            partyId: bundle.partyId,
            publicKey: bundle.publicKey,
            transactions: bundle.transactions,
            summaries: bundle.summaries.map(toTopologyTransactionSummaryDto),
            ...(bundle.synchronizerId !== undefined && {
                synchronizerId: bundle.synchronizerId,
            }),
            ...(bundle.origin !== null && { origin: bundle.origin }),
            createdAt: bundle.createdAt.toISOString(),
            ...(bundle.signedAt && {
                signedAt: bundle.signedAt.toISOString(),
            }),
            ...(bundle.signature && { signature: bundle.signature }),
            ...(bundle.multiHash && { multiHash: bundle.multiHash }),
        }
    }

    function toPreparedTransactionToSignDto(
        record: StorePreparedTransactionToSign
    ): PreparedTransactionToSignDto {
        return {
            id: record.id,
            status: record.status,
            partyId: record.partyId,
            publicKey: record.publicKey,
            preparedTransaction: record.preparedTransaction,
            ...(record.origin !== null && { origin: record.origin }),
            createdAt: record.createdAt.toISOString(),
            ...(record.signedAt && {
                signedAt: record.signedAt.toISOString(),
            }),
            ...(record.signature && { signature: record.signature }),
        }
    }

    return buildController({
        getUser: async (): Promise<GetUserResult> => {
            const userId = assertConnected(authContext).userId
            return {
                userId,
                isAdmin: isAdmin(),
            }
        },
        addNetwork: async (params: AddNetworkParams) => {
            assertAdmin()
            const { network } = params

            const ledgerApi = {
                baseUrl: network.ledgerApi ?? '',
            }

            const auth = authSchema.parse(network.auth)
            const adminAuth = network.adminAuth
                ? authSchema.parse(network.adminAuth)
                : undefined
            const serviceAccountAuth = network.serviceAccountAuth
                ? authSchema.parse(network.serviceAccountAuth)
                : undefined

            const newNetwork: Network = {
                name: network.name,
                id: network.id,
                description: network.description,
                synchronizerId: network.synchronizerId,
                identityProviderId: network.identityProviderId,
                auth,
                adminAuth,
                serviceAccountAuth,
                ledgerApi,
            }

            // TODO: Add an explicit updateNetwork method to the User API spec and controller
            const existingNetworks = await store.listNetworks()
            if (existingNetworks.find((n) => n.id === newNetwork.id)) {
                logger.info(`Updating network ${newNetwork.id}`)
                await store.updateNetwork(newNetwork)
            } else {
                logger.info(`Adding network ${newNetwork.id}`)
                await store.addNetwork(newNetwork)
            }

            return null
        },
        removeNetwork: async (params: RemoveNetworkParams) => {
            assertAdmin()
            await store.removeNetwork(params.networkName)
            return null
        },
        listNetworks: async () => {
            const networks = await store.listNetworks()
            return {
                networks: networks.map(toPublicNetwork),
            }
        },
        getNetwork: async (
            params: GetNetworkParams
        ): Promise<GetNetworkResult> => {
            assertAdmin()
            const network = await store.getNetwork(params.networkId)
            return { network: toNetworkDto(network) }
        },
        selfSignedAccessToken: async (
            params: SelfSignedAccessTokenParams
        ): Promise<SelfSignedAccessTokenResult> => {
            const network = (await store.listNetworks()).find(
                (n) => n.id === params.networkId
            )
            if (!network) {
                throw new Error(`Network "${params.networkId}" not found`)
            }
            const auth = network.auth

            if (auth.method !== 'self_signed') {
                throw new Error(
                    'Network does not use self_signed authentication'
                )
            }

            if (params.clientSecret !== auth.clientSecret) {
                throw providerErrors.unauthorized({
                    message: 'Invalid client secret',
                })
            }

            const idp = (await store.listIdps()).find(
                (idp) => idp.id === network.identityProviderId
            )
            if (!idp) {
                throw new Error(
                    `Identity provider "${network.identityProviderId}" not found`
                )
            }
            if (idp.type !== 'self_signed') {
                throw new Error(
                    'Identity provider is not configured for self_signed authentication'
                )
            }

            const accessToken = await new AuthTokenProvider(
                {
                    method: 'self_signed',
                    issuer: idp.issuer,
                    credentials: {
                        clientId: params.clientId,
                        clientSecret: auth.clientSecret,
                        scope: auth.scope,
                        audience: auth.audience,
                    },
                },
                logger
            ).getAccessToken()

            return { accessToken }
        },
        addIdp: async (params: AddIdpParams) => {
            assertAdmin()
            const validatedIdp = idpSchema.parse(params.idp)

            // TODO: Add an explicit updateIdp method to the User API spec and controller
            const existingIdps = await store.listIdps()
            if (existingIdps.find((n) => n.id === validatedIdp.id)) {
                logger.info(`Updating IDP ${validatedIdp.id}`)
                await store.updateIdp(validatedIdp)
            } else {
                logger.info(`Adding IDP ${validatedIdp.id}`)
                await store.addIdp(validatedIdp)
            }

            return null
        },
        removeIdp: async (params: RemoveIdpParams) => {
            assertAdmin()
            logger.info(`Removing IDP ${params.identityProviderId}`)
            await store.removeIdp(params.identityProviderId)
            return null
        },
        listIdps: async () => ({ idps: await store.listIdps() }),
        createWallet: async (params: CreateWalletParams) => {
            const { signingProviderId, primary, partyHint } = params

            const connectedContext = assertConnected(authContext)
            const network = await store.getCurrentNetwork()
            if (network === undefined) {
                throw new Error('No network session found')
            }
            const idp = await store.getIdp(network.identityProviderId)
            if (!network.adminAuth) {
                throw new Error('No admin auth configured')
            }

            const adminTokenProvider = AuthTokenProvider.fromGatewayConfig(
                idp,
                network.adminAuth,
                logger
            )

            const partyAllocator = new PartyAllocationService({
                synchronizerId: network.synchronizerId,
                accessTokenProvider: adminTokenProvider,
                httpLedgerUrl: network.ledgerApi.baseUrl,
                logger,
            })
            const walletAllocationService = new WalletAllocationService(
                store,
                logger,
                partyAllocator,
                drivers
            )

            if (!drivers[signingProviderId as SigningProvider]) {
                throw new Error(
                    `Signing provider ${signingProviderId} not supported`
                )
            }

            const wallet = await walletAllocationService.createWallet(
                connectedContext,
                partyHint,
                primary ?? false,
                signingProviderId as SigningProvider,
                params.keyName
            )

            // Sync wallets (TODO: separate rights sync from wallet sync as we only need rights sync here)
            const ledgerClient = new LedgerClient({
                baseUrl: new URL(network.ledgerApi.baseUrl),
                logger,
                accessTokenProvider: AuthTokenProvider.fromToken(
                    authContext!.accessToken,
                    logger
                ),
            })
            const service = new WalletSyncService(
                store,
                ledgerClient,
                authContext!,
                logger,
                drivers,
                partyAllocator
            )
            await service.syncWallets()

            // Notify about the change and return the new wallet
            const wallets = await store.getWallets()
            notificationService
                .getNotifier(connectedContext.userId)
                .emit('accountsChanged', wallets)

            return { wallet }
        },
        allocatePartyForWallet: async (
            params: AllocatePartyForWalletParams
        ) => {
            const connectedContext = assertConnected(authContext)

            const network = await store.getCurrentNetwork()
            if (!network) {
                throw new Error('No network session found')
            }
            if (!network.adminAuth) {
                throw new Error('No admin auth configured')
            }

            const allWallets = await store.getWallets()
            const existingWallet = allWallets.find(
                (w) =>
                    w.partyId === params.partyId && w.networkId === network.id
            )
            if (!existingWallet) {
                throw new Error(`Wallet not found for party ${params.partyId}`)
            }

            const idp = await store.getIdp(network.identityProviderId)
            const accessTokenProvider = AuthTokenProvider.fromGatewayConfig(
                idp,
                network.adminAuth,
                logger
            )
            const partyAllocator = new PartyAllocationService({
                synchronizerId: network.synchronizerId,
                accessTokenProvider,
                httpLedgerUrl: network.ledgerApi.baseUrl,
                logger,
            })
            const walletAllocationService = new WalletAllocationService(
                store,
                logger,
                partyAllocator,
                drivers
            )

            const signingProviderId =
                existingWallet.signingProviderId as SigningProvider
            if (!drivers[signingProviderId]) {
                throw new Error(
                    `Signing provider ${signingProviderId} not supported`
                )
            }

            await walletAllocationService.allocateParty(
                connectedContext,
                existingWallet,
                signingProviderId
            )

            // Sync wallets (TODO: separate rights sync from wallet sync as we only need rights sync here)
            const ledgerClient = new LedgerClient({
                baseUrl: new URL(network.ledgerApi.baseUrl),
                logger,
                accessTokenProvider: AuthTokenProvider.fromToken(
                    authContext!.accessToken,
                    logger
                ),
            })
            const service = new WalletSyncService(
                store,
                ledgerClient,
                authContext!,
                logger,
                drivers,
                partyAllocator
            )
            await service.syncWallets()

            // Notify about the change and return the updated wallet
            const wallets = await store.getWallets()
            const wallet = wallets.find(
                (w) =>
                    w.partyId === existingWallet.partyId &&
                    w.networkId === network.id
            )!

            notificationService
                .getNotifier(connectedContext.userId)
                .emit('accountsChanged', wallets)

            return { wallet }
        },
        importParty: async (params: ImportPartyParams) => {
            const connectedContext = assertConnected(authContext)

            const network = await store.getCurrentNetwork()
            if (!network) {
                throw new Error('No network session found')
            }
            if (!network.adminAuth) {
                throw new Error('No admin auth configured')
            }

            const idp = await store.getIdp(network.identityProviderId)
            const adminTokenProvider = AuthTokenProvider.fromGatewayConfig(
                idp,
                network.adminAuth,
                logger
            )
            const partyAllocator = new PartyAllocationService({
                synchronizerId: network.synchronizerId,
                accessTokenProvider: adminTokenProvider,
                httpLedgerUrl: network.ledgerApi.baseUrl,
                logger,
            })

            // Just grants rights -- the party is expected to already exist
            // (e.g. a decentralized party created by submitting its
            // onboarding transactions directly, outside this gateway).
            await partyAllocator.importExistingParty(
                connectedContext.userId,
                params.partyId
            )

            // Sync wallets so the newly-rights-granted party shows up
            // immediately, rather than waiting for the next periodic sync.
            const ledgerClient = new LedgerClient({
                baseUrl: new URL(network.ledgerApi.baseUrl),
                logger,
                accessTokenProvider: AuthTokenProvider.fromToken(
                    authContext!.accessToken,
                    logger
                ),
            })
            const service = new WalletSyncService(
                store,
                ledgerClient,
                authContext!,
                logger,
                drivers,
                partyAllocator
            )
            await service.syncWallets()

            let wallets = await store.getWallets()
            let wallet = wallets.find(
                (w) =>
                    w.partyId === params.partyId && w.networkId === network.id
            )
            if (!wallet) {
                throw new Error(
                    `Party ${params.partyId} was imported but is not visible yet -- try Sync`
                )
            }

            if (params.delegatedSigningUrl) {
                await store.updateWallet(
                    delegatedSigningUpdate(
                        wallet.partyId,
                        wallet.networkId,
                        params.delegatedSigningUrl
                    )
                )
                wallets = await store.getWallets()
                wallet = wallets.find(
                    (w) =>
                        w.partyId === params.partyId &&
                        w.networkId === network.id
                )!
            }

            notificationService
                .getNotifier(connectedContext.userId)
                .emit('accountsChanged', wallets)

            return { wallet }
        },
        setDelegatedSigning: async (params: SetDelegatedSigningParams) => {
            assertConnected(authContext)

            const network = await store.getCurrentNetwork()
            if (!network) {
                throw new Error('No network session found')
            }

            const wallets = await store.getWallets()
            const wallet = wallets.find(
                (w) =>
                    w.partyId === params.partyId && w.networkId === network.id
            )
            if (!wallet) {
                throw new Error(
                    `No wallet found for party ${params.partyId} on network ${network.id}`
                )
            }

            const url = params.delegatedSigningUrl.trim()
            if (url) {
                assertValidDelegatedSigningUrl(url)

                // Refuse to delegate a party this gateway can already sign
                // for. Doing so pins the provider to DECENTRALIZED, which
                // strands the key that actually authorizes for the party and
                // parks every transaction at a coordinator with no owner set
                // -- and the pin is deliberately immune to wallet sync, so
                // the wallet stays stuck until the URL is cleared. The UI
                // hides the action for such a wallet; this is the same rule
                // where it can actually be relied on.
                //
                // Clearing (an empty URL) is always allowed, so a wallet
                // delegated by mistake can be recovered.
                const alreadyDelegated =
                    wallet.signingProviderId === SigningProvider.DECENTRALIZED
                const nothingHereCanSign =
                    wallet.disabled === true &&
                    wallet.reason ===
                        WALLET_DISABLED_REASON.NO_SIGNING_PROVIDER_MATCHED
                if (!alreadyDelegated && !nothingHereCanSign) {
                    throw new Error(
                        `Party ${wallet.partyId} is signed for by ${wallet.signingProviderId}, so its signing cannot be delegated. Delegation is only for a party no signing provider here matches -- typically a decentralized/threshold-namespace party.`
                    )
                }
            }

            await store.updateWallet(
                delegatedSigningUpdate(wallet.partyId, wallet.networkId, url)
            )

            const updated = await store.getWallets()
            notificationService
                .getNotifier(assertConnected(authContext).userId)
                .emit('accountsChanged', updated)

            const result = updated.find(
                (w) =>
                    w.partyId === params.partyId && w.networkId === network.id
            )!
            return { wallet: result }
        },
        setPrimaryWallet: async (params: SetPrimaryWalletParams) => {
            await store.setPrimaryWallet(params.partyId)
            const wallets = await store.getWallets()

            notificationService
                .getNotifier(authContext!.userId)
                .emit('accountsChanged', wallets)

            return null
        },
        removeWallet: async (params: { partyId: string }) => {
            throw rpcErrors.methodNotSupported()
        },
        listWallets: async (params: {
            filter?: { signingProviderIds?: string[] }
        }) => {
            return await store.getWallets(params.filter)
        },
        sign: async (signParams: SignParams) => {
            const network = await store.getCurrentNetwork()
            if (network === undefined) {
                throw new Error('No network session found')
            }

            const wallets = await store.getWallets()
            const wallet = wallets.find((w) => w.partyId === signParams.partyId)

            if (wallet === undefined) {
                throw new Error('No primary wallet found')
            }

            const connectedContext = assertConnected(authContext)

            const session = await store.getSession(connectedContext.accessToken)
            if (!session) {
                throw new Error('No active session found')
            }
            const notifier = notificationService.getNotifier(session.id)

            const transactionService = new TransactionService(
                store,
                logger,
                drivers,
                notifier,
                hashingSchemeVersion
            )

            logDynamically(logger, 'signing transaction with params', {
                info: { transactionId: signParams.transactionId },
                debug: { signParams, wallet, connectedContext },
            })

            const response = await transactionService.sign(
                connectedContext,
                wallet,
                signParams
            )

            logDynamically(logger, 'transaction signed with response', {
                info: { transactionId: signParams.transactionId },
                debug: { response },
            })

            return response
        },
        signMessage: async (
            params: SignMessageParams
        ): Promise<SignMessageResult> => {
            const pending = await store.getMessageRaw(params.messageId)
            if (!pending) {
                throw new Error(
                    `Message signing request not found with id: ${params.messageId}`
                )
            }
            if (pending.status !== 'pending') {
                throw new Error(
                    `Cannot sign message with status '${pending.status}'. Only pending messages can be signed.`
                )
            }

            const userId = assertConnected(authContext).userId
            if (pending.userId !== userId) {
                throw new Error(
                    `Message signing request ${pending.id} is not owned by user ${userId}`
                )
            }

            const session = await store.getSession(
                assertConnected(authContext).accessToken
            )
            if (!session) {
                throw new Error('No active session found')
            }
            const notifier = notificationService.getNotifier(session.id)

            const emitFailedAndPersist = async (
                details: string
            ): Promise<never> => {
                // Best-effort: make sure listeners see a terminal state.
                try {
                    await store.setMessageRawStatus(pending.id, 'failed')
                } catch {
                    // ignore (e.g. record removed concurrently)
                }
                notifier.emit('messageSignature', {
                    status: 'failed',
                    messageId: pending.id,
                } satisfies MessageSignatureEvent)
                // Preserve the original error message for the caller/UI.
                throw new Error(details)
            }

            const wallet = (await store.getWallets()).find(
                (w) => w.partyId === pending.partyId
            )
            if (!wallet) {
                return await emitFailedAndPersist(
                    `No wallet found for partyId ${pending.partyId} (from message request ${pending.id})`
                )
            }
            if (wallet.publicKey !== pending.publicKey) {
                return await emitFailedAndPersist(
                    `Wallet public key changed for partyId ${pending.partyId}; refusing to sign message request ${pending.id}`
                )
            }

            // TODO: support other signing providers
            if (wallet.signingProviderId !== SigningProvider.WALLET_KERNEL) {
                return await emitFailedAndPersist(
                    `signMessage is only supported for ${SigningProvider.WALLET_KERNEL} wallets, got ${wallet.signingProviderId}`
                )
            }

            const driver =
                drivers[SigningProvider.WALLET_KERNEL]?.controller(userId)
            if (!driver) {
                return await emitFailedAndPersist(
                    'Wallet Kernel signing driver not available'
                )
            }

            const result = await driver.signMessage({
                message: pending.message,
                keyIdentifier: { publicKey: wallet.publicKey },
            })

            if (isRpcError(result)) {
                await store.setMessageRawStatus(pending.id, 'failed')
                notifier.emit('messageSignature', {
                    status: 'failed',
                    messageId: pending.id,
                } satisfies MessageSignatureEvent)
                throw new Error(result.error_description)
            }

            if (!result?.signature) {
                await store.setMessageRawStatus(pending.id, 'failed')
                notifier.emit('messageSignature', {
                    status: 'failed',
                    messageId: pending.id,
                } satisfies MessageSignatureEvent)
                throw new Error(`signMessage failed`)
            }

            await store.setMessageRawStatus(pending.id, 'signed', {
                signedAt: new Date(),
                signature: result.signature,
            })

            notifier.emit('messageSignature', {
                status: 'signed',
                messageId: pending.id,
                signature: result.signature,
            } satisfies MessageSignatureEvent)

            return {
                signature: result.signature,
                publicKey: wallet.publicKey,
            }
        },
        getMessageToSign: async (
            params: GetMessageToSignParams
        ): Promise<GetMessageToSignResult> => {
            const message = await store.getMessageRaw(params.messageId)
            if (!message) {
                throw new Error(
                    `Message signing request not found with id: ${params.messageId}`
                )
            }
            return {
                message: {
                    id: message.id,
                    status: message.status,
                    partyId: message.partyId,
                    publicKey: message.publicKey,
                    message: message.message,
                    ...(message.origin !== null && { origin: message.origin }),
                    ...(message.createdAt && {
                        createdAt: message.createdAt.toISOString(),
                    }),
                    ...(message.signedAt && {
                        signedAt: message.signedAt.toISOString(),
                    }),
                    ...(message.signature && { signature: message.signature }),
                },
            }
        },
        listMessagesToSign: async (): Promise<ListMessagesToSignResult> => {
            const messages = await store.listMessageRaws()
            return {
                messages: messages.map((message) => ({
                    id: message.id,
                    status: message.status,
                    partyId: message.partyId,
                    publicKey: message.publicKey,
                    message: message.message,
                    ...(message.origin !== null && { origin: message.origin }),
                    ...(message.createdAt && {
                        createdAt: message.createdAt.toISOString(),
                    }),
                    ...(message.signedAt && {
                        signedAt: message.signedAt.toISOString(),
                    }),
                    ...(message.signature && { signature: message.signature }),
                })),
            }
        },
        deleteMessageToSign: async (
            params: DeleteMessageToSignParams
        ): Promise<Null> => {
            const message = await store.getMessageRaw(params.messageId)
            if (!message) {
                throw new Error(
                    `Message signing request not found with id: ${params.messageId}`
                )
            }
            if (message.status !== 'pending') {
                throw new Error(
                    `Cannot delete message with status '${message.status}'. Only pending messages can be deleted.`
                )
            }
            const userId = assertConnected(authContext).userId
            if (message.userId !== userId) {
                throw new Error(
                    `Message signing request ${message.id} is not owned by user ${userId}`
                )
            }
            await store.removeMessageRaw(message.id)
            return null
        },
        signTopologyTransactions: async (
            params: SignTopologyTransactionsParams
        ): Promise<SignTopologyTransactionsResult> => {
            const pending = await store.getTopologyBundleRaw(params.requestId)
            if (!pending) {
                throw new Error(
                    `Topology-transactions signing request not found with id: ${params.requestId}`
                )
            }
            if (pending.status !== 'pending') {
                throw new Error(
                    `Cannot sign topology bundle with status '${pending.status}'. Only pending bundles can be signed.`
                )
            }

            const userId = assertConnected(authContext).userId
            if (pending.userId !== userId) {
                throw new Error(
                    `Topology-transactions signing request ${pending.id} is not owned by user ${userId}`
                )
            }

            const session = await store.getSession(
                assertConnected(authContext).accessToken
            )
            if (!session) {
                throw new Error('No active session found')
            }
            const notifier = notificationService.getNotifier(session.id)

            const emitFailedAndPersist = async (
                details: string
            ): Promise<never> => {
                // Best-effort: make sure listeners see a terminal state.
                try {
                    await store.setTopologyBundleRawStatus(pending.id, 'failed')
                } catch {
                    // ignore (e.g. record removed concurrently)
                }
                notifier.emit('topologyTransactionsSignature', {
                    status: 'failed',
                    requestId: pending.id,
                } satisfies TopologyTransactionsSignatureEvent)
                // Preserve the original error message for the caller/UI.
                throw new Error(details)
            }

            const wallet = (await store.getWallets()).find(
                (w) => w.partyId === pending.partyId
            )
            if (!wallet) {
                return await emitFailedAndPersist(
                    `No wallet found for partyId ${pending.partyId} (from topology-transactions request ${pending.id})`
                )
            }
            if (wallet.publicKey !== pending.publicKey) {
                return await emitFailedAndPersist(
                    `Wallet public key changed for partyId ${pending.partyId}; refusing to sign topology-transactions request ${pending.id}`
                )
            }

            // Only WALLET_KERNEL wallets are supported: this reuses the
            // existing, unmodified `signTransaction` method on the signing
            // driver (which signs a raw hash via signTransactionHash) rather
            // than adding a new method to the driver interface -- `Methods`
            // is exhaustive there, and a new method would force stub
            // implementations into all 6 other driver packages.
            if (wallet.signingProviderId !== SigningProvider.WALLET_KERNEL) {
                return await emitFailedAndPersist(
                    `signTopologyTransactions is only supported for ${SigningProvider.WALLET_KERNEL} wallets, got ${wallet.signingProviderId}`
                )
            }

            const driver =
                drivers[SigningProvider.WALLET_KERNEL]?.controller(userId)
            if (!driver) {
                return await emitFailedAndPersist(
                    'Wallet Kernel signing driver not available'
                )
            }

            // Core security property: the multiHash is recomputed fresh
            // from the raw transaction bytes stored at receipt time --
            // never from a cached or dApp-supplied value.
            const multiHash = await computeTopologyMultiHash(
                pending.transactions
            )

            const result = await driver.signTransaction({
                // Unused by the WALLET_KERNEL driver's signTransaction
                // (it only inspects txHash and keyIdentifier), but required
                // by SignTransactionParams.
                tx: '',
                txHash: multiHash,
                keyIdentifier: { publicKey: wallet.publicKey },
            })

            if (isRpcError(result)) {
                await store.setTopologyBundleRawStatus(pending.id, 'failed')
                notifier.emit('topologyTransactionsSignature', {
                    status: 'failed',
                    requestId: pending.id,
                } satisfies TopologyTransactionsSignatureEvent)
                throw new Error(result.error_description)
            }

            if (!result?.signature) {
                await store.setTopologyBundleRawStatus(pending.id, 'failed')
                notifier.emit('topologyTransactionsSignature', {
                    status: 'failed',
                    requestId: pending.id,
                } satisfies TopologyTransactionsSignatureEvent)
                throw new Error(`signTopologyTransactions failed`)
            }

            await store.setTopologyBundleRawStatus(pending.id, 'signed', {
                signedAt: new Date(),
                signature: result.signature,
                multiHash,
            })

            notifier.emit('topologyTransactionsSignature', {
                status: 'signed',
                requestId: pending.id,
                signature: result.signature,
                multiHash,
            } satisfies TopologyTransactionsSignatureEvent)

            return {
                signature: result.signature,
                publicKey: wallet.publicKey,
                multiHash,
            }
        },
        signPreparedTransaction: async (
            params: SignPreparedTransactionParams
        ): Promise<SignPreparedTransactionResult> => {
            const pending = await store.getPreparedTransactionToSign(
                params.requestId
            )
            if (!pending) {
                throw new Error(
                    `Prepared-transaction signing request not found with id: ${params.requestId}`
                )
            }
            if (pending.status !== 'pending') {
                throw new Error(
                    `Cannot sign prepared transaction with status '${pending.status}'. Only pending requests can be signed.`
                )
            }

            const userId = assertConnected(authContext).userId
            if (pending.userId !== userId) {
                throw new Error(
                    `Prepared-transaction signing request ${pending.id} is not owned by user ${userId}`
                )
            }

            const session = await store.getSession(
                assertConnected(authContext).accessToken
            )
            if (!session) {
                throw new Error('No active session found')
            }
            const notifier = notificationService.getNotifier(session.id)

            const emitFailedAndPersist = async (
                details: string
            ): Promise<never> => {
                // Best-effort: make sure listeners see a terminal state.
                try {
                    await store.setPreparedTransactionToSignStatus(
                        pending.id,
                        'failed'
                    )
                } catch {
                    // ignore (e.g. record removed concurrently)
                }
                notifier.emit('preparedTransactionSignature', {
                    status: 'failed',
                    requestId: pending.id,
                } satisfies PreparedTransactionSignatureEvent)
                // Preserve the original error message for the caller/UI.
                throw new Error(details)
            }

            const wallet = (await store.getWallets()).find(
                (w) => w.partyId === pending.partyId
            )
            if (!wallet) {
                return await emitFailedAndPersist(
                    `No wallet found for partyId ${pending.partyId} (from prepared-transaction request ${pending.id})`
                )
            }
            if (wallet.publicKey !== pending.publicKey) {
                return await emitFailedAndPersist(
                    `Wallet public key changed for partyId ${pending.partyId}; refusing to sign prepared-transaction request ${pending.id}`
                )
            }

            // Only WALLET_KERNEL wallets are supported: this reuses the
            // existing, unmodified `signTransaction` method on the signing
            // driver (which signs a raw hash via signTransactionHash) rather
            // than adding a new method to the driver interface.
            if (wallet.signingProviderId !== SigningProvider.WALLET_KERNEL) {
                return await emitFailedAndPersist(
                    `signPreparedTransaction is only supported for ${SigningProvider.WALLET_KERNEL} wallets, got ${wallet.signingProviderId}`
                )
            }

            const driver =
                drivers[SigningProvider.WALLET_KERNEL]?.controller(userId)
            if (!driver) {
                return await emitFailedAndPersist(
                    'Wallet Kernel signing driver not available'
                )
            }

            // The hash is derived here, from the raw prepared-transaction
            // bytes stored at receipt time, and never taken from a caller --
            // mirroring signTopologyTransactions's own principle. A supplied
            // hash could only ever be checked against these bytes and then
            // discarded, and for every owner but the first it would have
            // arrived via a peer rather than from Canton, so it is not asked
            // for at all. The one comparison worth making -- Canton's hash
            // against this recompute -- happens where both are authentic, in
            // dapp-api's prepareExecute.
            const txHash = await hashPreparedTransaction(
                pending.preparedTransaction
            )

            const result = await driver.signTransaction({
                // Unused by the WALLET_KERNEL driver's signTransaction
                // (it only inspects txHash and keyIdentifier), but required
                // by SignTransactionParams.
                tx: '',
                txHash,
                keyIdentifier: { publicKey: wallet.publicKey },
            })

            if (isRpcError(result)) {
                await store.setPreparedTransactionToSignStatus(
                    pending.id,
                    'failed'
                )
                notifier.emit('preparedTransactionSignature', {
                    status: 'failed',
                    requestId: pending.id,
                } satisfies PreparedTransactionSignatureEvent)
                throw new Error(result.error_description)
            }

            if (!result?.signature) {
                await store.setPreparedTransactionToSignStatus(
                    pending.id,
                    'failed'
                )
                notifier.emit('preparedTransactionSignature', {
                    status: 'failed',
                    requestId: pending.id,
                } satisfies PreparedTransactionSignatureEvent)
                throw new Error(`signPreparedTransaction failed`)
            }

            await store.setPreparedTransactionToSignStatus(
                pending.id,
                'signed',
                {
                    signedAt: new Date(),
                    signature: result.signature,
                }
            )

            notifier.emit('preparedTransactionSignature', {
                status: 'signed',
                requestId: pending.id,
                signature: result.signature,
                signedBy: wallet.publicKey,
            } satisfies PreparedTransactionSignatureEvent)

            return {
                signature: result.signature,
                signedBy: wallet.publicKey,
            }
        },
        getPreparedTransactionToSign: async (
            params: GetPreparedTransactionToSignParams
        ): Promise<GetPreparedTransactionToSignResult> => {
            const record = await store.getPreparedTransactionToSign(
                params.requestId
            )
            if (!record) {
                throw new Error(
                    `Prepared-transaction signing request not found with id: ${params.requestId}`
                )
            }
            return { record: toPreparedTransactionToSignDto(record) }
        },
        deletePreparedTransactionToSign: async (
            params: DeletePreparedTransactionToSignParams
        ): Promise<Null> => {
            const record = await store.getPreparedTransactionToSign(
                params.requestId
            )
            if (!record) {
                throw new Error(
                    `Prepared-transaction signing request not found with id: ${params.requestId}`
                )
            }
            if (record.status !== 'pending') {
                throw new Error(
                    `Cannot delete prepared-transaction request with status '${record.status}'. Only pending requests can be deleted.`
                )
            }
            const userId = assertConnected(authContext).userId
            if (record.userId !== userId) {
                throw new Error(
                    `Prepared-transaction signing request ${record.id} is not owned by user ${userId}`
                )
            }
            await store.removePreparedTransactionToSign(record.id)
            return null
        },
        getTopologyBundleToSign: async (
            params: GetTopologyBundleToSignParams
        ): Promise<GetTopologyBundleToSignResult> => {
            const bundle = await store.getTopologyBundleRaw(params.requestId)
            if (!bundle) {
                throw new Error(
                    `Topology-transactions signing request not found with id: ${params.requestId}`
                )
            }
            return { bundle: toTopologyBundleRawDto(bundle) }
        },
        listTopologyBundlesToSign:
            async (): Promise<ListTopologyBundlesToSignResult> => {
                const bundles = await store.listTopologyBundleRaws()
                return { bundles: bundles.map(toTopologyBundleRawDto) }
            },
        deleteTopologyBundleToSign: async (
            params: DeleteTopologyBundleToSignParams
        ): Promise<Null> => {
            const bundle = await store.getTopologyBundleRaw(params.requestId)
            if (!bundle) {
                throw new Error(
                    `Topology-transactions signing request not found with id: ${params.requestId}`
                )
            }
            if (bundle.status !== 'pending') {
                throw new Error(
                    `Cannot delete topology bundle with status '${bundle.status}'. Only pending bundles can be deleted.`
                )
            }
            const userId = assertConnected(authContext).userId
            if (bundle.userId !== userId) {
                throw new Error(
                    `Topology-transactions signing request ${bundle.id} is not owned by user ${userId}`
                )
            }
            await store.removeTopologyBundleRaw(bundle.id)
            return null
        },
        execute: async (executeParams: ExecuteParams) => {
            const wallets = await store.getWallets()
            const network = await store.getCurrentNetwork()
            const transaction = await store.getTransaction(
                executeParams.transactionId
            )
            const wallet = wallets.find(
                (w) => w.partyId === executeParams.partyId
            )

            if (wallet === undefined) {
                throw new Error('Requested wallet not found for user')
            }

            if (transaction === undefined) {
                throw new Error('No transaction found')
            }

            const connectedContext = assertConnected(authContext)
            const accessTokenProvider: AuthTokenProvider =
                AuthTokenProvider.fromToken(
                    connectedContext.accessToken,
                    logger
                )

            if (network === undefined) {
                throw new Error('No network session found')
            }

            const session = await store.getSession(connectedContext.accessToken)
            if (!session) {
                throw new Error('No active session found')
            }
            const notifier = notificationService.getNotifier(session.id)

            const ledgerClient = new LedgerClient({
                baseUrl: new URL(network.ledgerApi.baseUrl),
                logger,
                accessTokenProvider,
            })

            const transactionService = new TransactionService(
                store,
                logger,
                drivers,
                notifier,
                hashingSchemeVersion
            )

            logDynamically(logger, 'executing transaction with params', {
                info: { transactionId: executeParams.transactionId },
                debug: {
                    executeParams,
                    transaction,
                    wallet,
                    userId: connectedContext.userId,
                },
            })

            const response = await transactionService.execute(
                connectedContext.userId,
                wallet,
                transaction,
                executeParams,
                ledgerClient,
                network
            )

            logDynamically(logger, 'transaction executed with response', {
                info: { transactionId: executeParams.transactionId },
                debug: { response },
            })

            return response
        },
        addSession: async function (
            params: AddSessionParams
        ): Promise<AddSessionResult> {
            try {
                const connectedContext = assertConnected(authContext)
                const { userId, accessToken } = connectedContext

                const newSessionId = v4()

                logger.info(
                    `Adding session with ID ${newSessionId} for network ${params.networkId}`
                )
                const network = await store.getNetwork(params.networkId)
                const idp = await store.getIdp(network.identityProviderId)

                assertTokenClaimsMatchNetwork(accessToken, network, idp)

                await store.setSession({
                    id: newSessionId,
                    origin: params.origin,
                    network: params.networkId,
                    accessToken: connectedContext.accessToken || '',
                })

                const notifier = notificationService.getNotifier(newSessionId)

                const ledgerClient = new LedgerClient({
                    baseUrl: new URL(network.ledgerApi.baseUrl),
                    logger,
                    accessTokenProvider: AuthTokenProvider.fromToken(
                        accessToken,
                        logger
                    ),
                })
                const status = await networkStatus(ledgerClient)
                const statusEvent: StatusEvent = {
                    provider: provider,
                    connection: {
                        isConnected: status.isConnected,
                        reason: status.reason ? status.reason : 'OK',
                        isNetworkConnected: status.isConnected,
                        networkReason: status.reason ? status.reason : 'OK',
                    },
                    network: {
                        networkId: network.id,
                        ledgerApi: network.ledgerApi.baseUrl,
                        accessToken: accessToken,
                    },
                    session: {
                        accessToken: accessToken,
                        userId: userId,
                    },
                }
                notifier.emit('statusChanged', statusEvent)
                notifier.emit('connected', statusEvent)

                // Only bootstrap wallets the first time a session is created.
                // Session creation must remain successful when the ledger or
                // wallet synchronization is unavailable.
                const wallets = await store.getWallets()
                if (wallets.length === 0) {
                    if (!status.isConnected) {
                        logger.warn(
                            {
                                networkId: network.id,
                                reason: status.reason,
                            },
                            'Skipping initial wallet sync because the ledger is unavailable'
                        )
                    } else {
                        try {
                            if (!network.adminAuth) {
                                throw new Error('No admin auth configured')
                            }

                            const adminAccessTokenProvider =
                                AuthTokenProvider.fromGatewayConfig(
                                    idp,
                                    network.adminAuth,
                                    logger
                                )
                            const partyAllocator = new PartyAllocationService({
                                synchronizerId: network.synchronizerId,
                                accessTokenProvider: adminAccessTokenProvider,
                                httpLedgerUrl: network.ledgerApi.baseUrl,
                                logger,
                            })

                            const service = new WalletSyncService(
                                store,
                                ledgerClient,
                                connectedContext,
                                logger,
                                drivers,
                                partyAllocator
                            )
                            await service.syncWallets()
                        } catch (error) {
                            logger.warn(
                                { err: error, networkId: network.id },
                                'Initial wallet sync failed; keeping session active'
                            )
                        }
                    }
                }

                const rights = await store.getUserRights(network.id)
                return {
                    id: newSessionId,
                    accessToken,
                    network: toSessionNetwork(network),
                    idp,
                    status: status.isConnected ? 'connected' : 'disconnected',
                    reason: status.reason ? status.reason : 'OK',
                    rights: rights,
                }
            } catch (error) {
                logger.error(error, 'Failed to add session')
                throw new Error(`Failed to add session`, {
                    cause: error,
                })
            }
        },
        removeSession: async (): Promise<Null> => {
            logger.info({ authContext }, 'Removing session')
            const { accessToken } = assertConnected(authContext)

            const session = await store.getSession(accessToken)
            if (!session) {
                return null
            }
            const notifier = notificationService.getNotifier(session.id)

            await store.removeSession(accessToken)

            notifier.emit('statusChanged', {
                provider: provider,
                connection: {
                    isConnected: false,
                    reason: 'disconnect',
                    isNetworkConnected: false,
                    networkReason: 'removed session',
                },
                network: undefined,
                session: undefined,
                userUrl: `${userUrl}/login/`,
            })
            notifier.emit('logout')

            return null
        },
        // TODO: follow up with store.listSessions to display all sessions in the UI
        listSessions: async (): Promise<ListSessionsResult> => {
            const token = authContext!.accessToken
            const session = await store.getSession(token)

            if (!session) {
                return { sessions: [] }
            }

            const network = await store.getNetwork(session.network)
            const ledgerClient = new LedgerClient({
                baseUrl: new URL(network.ledgerApi.baseUrl),
                logger,
                accessTokenProvider: AuthTokenProvider.fromToken(
                    authContext!.accessToken,
                    logger
                ),
            })
            const idp = await store.getIdp(network.identityProviderId)
            const status = await networkStatus(ledgerClient)
            const rights = await store.getUserRights(network.id)

            return {
                sessions: [
                    {
                        id: session.id,
                        origin: session.origin,
                        network: toSessionNetwork(network),
                        idp: idp,
                        accessToken: authContext!.accessToken,
                        status: status.isConnected
                            ? 'connected'
                            : 'disconnected',
                        reason: status.reason ? status.reason : 'OK',
                        rights: rights,
                    },
                ],
            }
        },
        syncWallets: async function (): Promise<SyncWalletsResult> {
            const network = await store.getCurrentNetwork()
            const { userId } = assertConnected(authContext)

            const userAccessTokenProvider = AuthTokenProvider.fromToken(
                authContext!.accessToken,
                logger
            )

            const idp = await store.getIdp(network.identityProviderId)

            if (!network.adminAuth) {
                throw new Error('No admin auth configured')
            }

            const adminAccessTokenProvider =
                AuthTokenProvider.fromGatewayConfig(
                    idp,
                    network.adminAuth,
                    logger
                )

            const partyAllocator = new PartyAllocationService({
                synchronizerId: network.synchronizerId,
                accessTokenProvider: adminAccessTokenProvider,
                httpLedgerUrl: network.ledgerApi.baseUrl,
                logger,
            })

            const userLedger = new LedgerClient({
                baseUrl: new URL(network.ledgerApi.baseUrl),
                logger,
                accessTokenProvider: userAccessTokenProvider,
            })

            const service = new WalletSyncService(
                store,
                userLedger,
                authContext!,
                logger,
                drivers,
                partyAllocator
            )
            const result = await service.syncWallets()
            if (
                (result.added.length === 0 && result.updated.length === 0) ||
                result.disabled.length === 0
            ) {
                return result
            }

            const wallets = await store.getWallets()
            notificationService
                .getNotifier(userId)
                .emit('accountsChanged', wallets)

            return result
        },
        isWalletSyncNeeded: async (): Promise<IsWalletSyncNeededResult> => {
            const network = await store.getCurrentNetwork()
            assertConnected(authContext)

            const userAccessTokenProvider = AuthTokenProvider.fromToken(
                authContext!.accessToken,
                logger
            )

            const idp = await store.getIdp(network.identityProviderId)

            if (!network.adminAuth) {
                throw new Error('No admin auth configured')
            }

            const adminAccessTokenProvider =
                AuthTokenProvider.fromGatewayConfig(
                    idp,
                    network.adminAuth,
                    logger
                )

            const partyAllocator = new PartyAllocationService({
                synchronizerId: network.synchronizerId,
                accessTokenProvider: adminAccessTokenProvider,
                httpLedgerUrl: network.ledgerApi.baseUrl,
                logger,
            })

            const userLedger = new LedgerClient({
                baseUrl: new URL(network.ledgerApi.baseUrl),
                logger,
                accessTokenProvider: userAccessTokenProvider,
            })

            const service = new WalletSyncService(
                store,
                userLedger,
                authContext!,
                logger,
                drivers,
                partyAllocator
            )
            const walletSyncNeeded = await service.isWalletSyncNeeded()
            return { walletSyncNeeded }
        },
        getTransaction: async (
            params: GetTransactionParams
        ): Promise<GetTransactionResult> => {
            const transaction = await store.getTransaction(params.transactionId)
            if (!transaction) {
                throw new Error(
                    `Transaction not found with id: ${params.transactionId}`
                )
            }
            return {
                id: transaction.id,
                commandId: transaction.commandId,
                status: transaction.status,
                preparedTransaction: transaction.preparedTransaction,
                preparedTransactionHash: transaction.preparedTransactionHash,
                payload: transaction.payload
                    ? JSON.stringify(transaction.payload)
                    : '',
                ...(transaction.origin !== null && {
                    origin: transaction.origin,
                }),
                ...(transaction.createdAt && {
                    createdAt: transaction.createdAt.toISOString(),
                }),
                ...(transaction.signedAt && {
                    signedAt: transaction.signedAt.toISOString(),
                }),
                ...(transaction.externalTxId && {
                    externalTxId: transaction.externalTxId,
                }),
            }
        },
        listTransactions: async function (
            params?: ListTransactionsParams
        ): Promise<ListTransactionsResult> {
            const txCount = await store.transactionsCount()
            const page = await store.listTransactions(params)
            const transactions = page.transactions
            const txs = transactions.map((transaction) => ({
                id: transaction.id,
                commandId: transaction.commandId,
                status: transaction.status,
                preparedTransaction: transaction.preparedTransaction,
                preparedTransactionHash: transaction.preparedTransactionHash,
                payload: transaction.payload
                    ? JSON.stringify(transaction.payload)
                    : '',
                ...(transaction.origin !== null && {
                    origin: transaction.origin,
                }),
                ...(transaction.createdAt && {
                    createdAt: transaction.createdAt.toISOString(),
                }),
                ...(transaction.signedAt && {
                    signedAt: transaction.signedAt.toISOString(),
                }),
                ...(transaction.externalTxId && {
                    externalTxId: transaction.externalTxId,
                }),
            }))

            if (page.nextCursor === null) {
                return { transactions: txs, count: txCount }
            } else {
                return {
                    transactions: txs,
                    nextCursor: page.nextCursor,
                    count: txCount,
                }
            }
        },
        deleteTransaction: async (
            params: DeleteTransactionParams
        ): Promise<Null> => {
            const transaction = await store.getTransaction(params.transactionId)
            if (!transaction) {
                throw new Error(
                    `Transaction not found with id: ${params.transactionId}`
                )
            }
            if (transaction.status !== 'pending') {
                throw new Error(
                    `Cannot delete transaction with status '${transaction.status}'. Only pending transactions can be deleted.`
                )
            }
            const session = await store.getSession(
                assertConnected(authContext).accessToken
            )
            if (!session) {
                throw new Error('No active session found')
            }

            await store.removeTransaction(transaction.id)
            notificationService.getNotifier(session.id).emit('txChanged', {
                status: 'failed',
                commandId: transaction.commandId,
            } satisfies TxChangedFailedEvent)
            return null
        },
        generateApiKey: async (
            params: GenerateApiKeyParams
        ): Promise<GeneratedApiKey> => {
            const userId = assertConnected(authContext).userId
            const network = await store.getCurrentNetwork()

            const apiKeyId = v4()
            const generatedApiKey = crypto.randomBytes(32).toString('hex')
            const hashedApiKey = crypto
                .createHash('sha256')
                .update(generatedApiKey)
                .digest('hex')

            const storedApiKey = {
                id: apiKeyId,
                name: params.name,
                digest: hashedApiKey,
                userId,
                networkId: network.id,
                email: authContext?.email || null,
                createdAt: new Date(),
            }

            await store.addApiKey(storedApiKey)

            logDynamically(logger, 'Generated new API key', {
                info: { apiKeyId: storedApiKey.id },
                debug: {
                    name: storedApiKey.name,
                    userId: storedApiKey.userId,
                    networkId: storedApiKey.networkId,
                    createdAt: storedApiKey.createdAt,
                },
            })

            return {
                id: storedApiKey.id,
                apiKey: generatedApiKey,
            }
        },
        listApiKeys: async (): Promise<ListApiKeysResult> => {
            const apiKeys = await store.listApiKeys().then((keys) =>
                keys.map((key) => ({
                    id: key.id,
                    name: key.name,
                    createdAt: key.createdAt.toISOString(),
                }))
            )
            return { apiKeys }
        },
        removeApiKey: async (params: RemoveApiKeyParams): Promise<Null> => {
            await store.removeApiKey(params.id)
            return null
        },
        listSigningProviderKeys: async (
            params: ListSigningProviderKeysParams
        ): Promise<ListSigningProviderKeysResult> => {
            return await getSigningProviderKeys(params)
        },
        changeSigningProvider: async (
            params: ChangeSigningProviderParams
        ): Promise<null> => {
            const { signingProviderId, partyId, publicKey } = params
            const signingProviderKeys = await getSigningProviderKeys(params)
            if (
                !signingProviderKeys.keys
                    .map((key) => key.publicKey)
                    .includes(publicKey)
            )
                throw new Error(
                    `provided publicKey does not belong to ${signingProviderId}`
                )
            const network = await store.getCurrentNetwork()
            if (network === undefined) {
                throw new Error('No network session found')
            }
            if (!network.adminAuth) {
                throw new Error('No admin auth configured')
            }
            const idp = await store.getIdp(network.identityProviderId)
            const adminTokenProvider = AuthTokenProvider.fromGatewayConfig(
                idp,
                network.adminAuth,
                logger
            )
            const partyAllocator = new PartyAllocationService({
                synchronizerId: network.synchronizerId,
                accessTokenProvider: adminTokenProvider,
                httpLedgerUrl: network.ledgerApi.baseUrl,
                logger,
            })
            const normalizedKey =
                partyAllocator.normalizePublicKeyToBase64(publicKey)
            if (!normalizedKey) {
                throw new Error(
                    'provided key cannot be converted to Base64 format'
                )
            }
            const namespace =
                partyAllocator.createFingerprintFromKey(normalizedKey)

            await store.updateWallet({
                partyId,
                signingProviderId,
                publicKey,
                namespace,
                reason: '',
                disabled: false,
            })
            return null
        },
        getWallet: async (
            params: GetWalletParams
        ): Promise<GetWalletResult> => {
            return await store.getWallet(params.partyId)
        },
    })
}

function toAuthDto(auth: Auth): ApiNetwork['auth'] {
    const base = {
        method: auth.method,
        audience: auth.audience,
        scope: auth.scope,
        clientId: auth.clientId,
    }

    if (auth.method === 'self_signed') {
        return {
            ...base,
            issuer: auth.issuer,
            clientSecret: auth.clientSecret,
        }
    }

    if (auth.method === 'client_credentials') {
        return {
            ...base,
            clientSecret: auth.clientSecret,
        }
    }

    return base
}

function toNetworkDto(network: Network): ApiNetwork {
    return {
        id: network.id,
        name: network.name,
        description: network.description,
        synchronizerId: network.synchronizerId,
        identityProviderId: network.identityProviderId,
        ledgerApi: network.ledgerApi.baseUrl,
        auth: toAuthDto(network.auth),
        ...(network.adminAuth
            ? { adminAuth: toAuthDto(network.adminAuth) }
            : {}),
        ...(network.serviceAccountAuth
            ? { serviceAccountAuth: toAuthDto(network.serviceAccountAuth) }
            : {}),
    }
}

function toPublicNetwork(network: Network): PublicNetwork {
    const auth = network.auth

    return {
        id: network.id,
        name: network.name,
        description: network.description,
        synchronizerId: network.synchronizerId,
        identityProviderId: network.identityProviderId,
        ledgerApi: network.ledgerApi.baseUrl,
        authMethod: auth.method,
        ...(auth.method !== 'client_credentials' && {
            clientId: auth.clientId,
            scope: auth.scope,
            audience: auth.audience,
        }),
    }
}

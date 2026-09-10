// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino'
import { LedgerClient, Types } from '@canton-network/core-ledger-client'
import {
    Store,
    Transaction,
    Wallet,
    Network,
} from '@canton-network/core-wallet-store'
import type { SignResult } from '../user-api/rpc-gen/typings.js'
import {
    Error as SigningError,
    GetTransactionResult,
    SigningProvider,
    SignTransactionResult,
    Methods as SigningController,
    SignTransactionParams,
} from '@canton-network/core-signing-lib'
import type { SigningDrivers } from '../signing/signing-drivers.js'
import {
    ExecuteParams,
    ExecuteResult,
    SignParams,
} from '../user-api/rpc-gen/typings.js'
import { UserId } from '../dapp-api/rpc-gen/typings.js'
import type { DelegatedSignTransactionParams } from '@canton-network/core-signing-decentralized'
import { Notifier } from '../notification/NotificationService.js'
import {
    ledgerPrepareParams,
    logDynamically,
    type PrepareParams,
} from '../utils.js'
import {
    AuthContext,
    AuthTokenProvider,
} from '@canton-network/core-wallet-auth'
import { keyLabelFromPublicKey } from '@canton-network/core-signing-securosys'
import { HASHING_SCHEME_VERSION } from '../env.js'

export type SignAndExecuteResult = SignResult | ExecuteResult

/** One owner's signature over a prepared transaction's hash. */
export interface DelegatedSignature {
    signature: string
    signedBy: string
}

export interface ExecuteDelegatedParams {
    preparedTransaction: string
    partyId: string
    commandId: string
    signatures: DelegatedSignature[]
}

function handleSigningError<T extends object>(result: SigningError | T): T {
    if ('error' in result) {
        throw new Error(
            `Error from signing driver: ${result.error_description}`
        )
    }
    return result
}

export class TransactionService {
    constructor(
        private store: Store,
        private logger: Logger,
        private signingDrivers: SigningDrivers = {},
        private notifier: Notifier,
        private hashingSchemeVersion: HASHING_SCHEME_VERSION
    ) {}

    public async sign(
        authContext: AuthContext,
        wallet: Wallet,
        signParams: SignParams
    ): Promise<SignResult> {
        const signingProvider = wallet.signingProviderId as SigningProvider
        const driver = this.signingDrivers[signingProvider]?.controller(
            authContext.userId
        )
        if (!driver) {
            throw new Error(`No driver found for ${signingProvider}`)
        }

        const tx = await this.loadPreparedTransactionForSigning(
            signParams.transactionId
        )

        const baseSignParams = {
            tx: tx.preparedTransaction,
            txHash: tx.preparedTransactionHash,
            keyIdentifier: {
                publicKey: wallet.publicKey,
            },
        }

        const internalTxId = crypto
            .randomUUID()
            .replace(/-/g, '')
            .substring(0, 16)

        /**
         * The ultimate goal is that every signing driver is indistinguishable,
         * and so we can just call the same function for all of them.
         * However, some drivers have different requirements, so we need to handle them separately for now.
         *
         * This is a soft-blocker for 3rd-party driver plugins, since we wouldn't be able to add them to the codebase here
         */
        switch (signingProvider) {
            case SigningProvider.PARTICIPANT:
            case SigningProvider.WALLET_KERNEL:
            case SigningProvider.DFNS:
            case SigningProvider.BITGO: {
                return this.signWithDriver(
                    driver,
                    signingProvider,
                    authContext.userId,
                    wallet,
                    tx,
                    baseSignParams
                )
            }
            case SigningProvider.BLOCKDAEMON: {
                if (!authContext.email) {
                    throw new Error(
                        'Email is required for Blockdaemon wallet allocation'
                    )
                }

                const blockdaemonDriver = this.signingDrivers[
                    SigningProvider.BLOCKDAEMON
                ]?.controller(authContext.email)

                return this.signWithDriver(
                    blockdaemonDriver!, // we checked the driver existence above, so this is safe
                    signingProvider,
                    authContext.email,
                    wallet,
                    tx,
                    { ...baseSignParams, internalTxId }
                )
            }
            case SigningProvider.FIREBLOCKS: {
                return this.signWithDriver(
                    driver,
                    signingProvider,
                    authContext.userId,
                    wallet,
                    tx,
                    { ...baseSignParams, userId: authContext.userId }
                )
            }
            case SigningProvider.SECUROSYS: {
                return this.signWithDriver(
                    driver,
                    signingProvider,
                    authContext.userId,
                    wallet,
                    tx,
                    {
                        ...baseSignParams,
                        keyIdentifier: {
                            id: keyLabelFromPublicKey(wallet.publicKey),
                            publicKey: wallet.publicKey,
                        },
                    }
                )
            }
            case SigningProvider.DECENTRALIZED: {
                return this.signWithDecentralized(
                    authContext.userId,
                    wallet,
                    signParams
                )
            }
            default:
                throw new Error(
                    `Unsupported signing provider: ${wallet.signingProviderId}`
                )
        }
    }

    public execute(
        userId: UserId,
        wallet: Wallet,
        transaction: Transaction,
        executeParams: ExecuteParams,
        ledgerClient: LedgerClient,
        network?: Network
    ): Promise<ExecuteResult> {
        if (transaction.status !== 'signed') {
            throw new Error(
                `Cannot execute a ${transaction.status} transaction. Expected status: signed.`
            )
        }

        if (wallet.signingProviderId === SigningProvider.PARTICIPANT) {
            try {
                if (!network) {
                    throw new Error(
                        'Network is required for participant signing'
                    )
                }
                return this.executeWithParticipant(
                    userId,
                    executeParams,
                    transaction,
                    ledgerClient,
                    network
                )
            } catch (error) {
                this.logger.error(error, 'Failed to submit transaction')
                throw error
            }
        }

        return this.executeWithExternal(
            userId,
            executeParams,
            transaction,
            ledgerClient
        )
    }

    public async signAndExecute(
        authContext: AuthContext,
        network: Network,
        wallet: Wallet,
        transaction: Transaction
    ): Promise<SignAndExecuteResult> {
        const signParams: SignParams = {
            transactionId: transaction.id,
            partyId: wallet.partyId,
        }

        const signResult = await this.sign(authContext, wallet, signParams)

        if (signResult.status === 'pending') {
            return signResult
        }

        if (signResult.status !== 'signed') {
            throw new Error(
                `Service account signing failed with status: ${signResult.status}`
            )
        }

        if (
            !('signature' in signResult) ||
            signResult.signature === undefined
        ) {
            throw new Error(
                'Service account signing did not return a signature'
            )
        }

        const ledgerClient = new LedgerClient({
            baseUrl: new URL(network.ledgerApi.baseUrl),
            logger: this.logger,
            accessTokenProvider: AuthTokenProvider.fromToken(
                authContext.accessToken,
                this.logger
            ),
        })

        const executeParams: ExecuteParams = {
            transactionId: transaction.id,
            partyId: wallet.partyId,
            signature: signResult.signature,
            signedBy: signResult.signedBy,
        }

        const userId = authContext.isApiKey
            ? authContext.ledgerUserId
            : authContext.userId

        return this.execute(
            userId,
            wallet,
            { ...transaction, status: 'signed' as const },
            executeParams,
            ledgerClient,
            network
        )
    }

    private async loadPreparedTransactionForSigning(
        transactionId: Transaction['id']
    ): Promise<Transaction> {
        const existingTx = await this.store.getTransaction(transactionId)

        if (!existingTx) {
            throw new Error(`Transaction not found with id: ${transactionId}`)
        }

        if (existingTx.status !== 'pending') {
            throw new Error(
                `Cannot sign an already ${existingTx.status} transaction`
            )
        }

        return existingTx
    }

    private async signWithDriver(
        driver: SigningController,
        driverId: SigningProvider,
        userId: UserId,
        wallet: Wallet,
        tx: Transaction,
        signTransactionParams: SignTransactionParams
    ): Promise<SignResult> {
        // resolveSigningProvider (wallet-sync-service.ts) labels a wallet
        // SigningProvider.PARTICIPANT in two different situations that must not
        // be conflated: (1) the party's namespace genuinely IS the
        // participant's own namespace -- signing and execution really are
        // handled implicitly by participant keys; (2) nothing else matched
        // either, and PARTICIPANT was used as a fallback label -- there is no
        // key here that can actually authorize anything (e.g. a
        // decentralized/multi-owner party's threshold namespace). Only
        // `wallet.disabled` distinguishes them. Letting case (2) reach a
        // driver produces a transaction wallet-gateway believes is signed but
        // isn't, which fails (or worse, misbehaves) later at real submission
        // -- fail loudly here instead.
        if (driverId === SigningProvider.PARTICIPANT && wallet.disabled) {
            throw new Error(
                `Cannot sign as party ${wallet.partyId}: no signing provider matches its namespace, so there is no key here that can authorize this transaction.`
            )
        }

        let signingResult: Exclude<
            GetTransactionResult | SignTransactionResult,
            SigningError
        >

        if (tx.externalTxId) {
            signingResult = await driver
                .getTransaction({
                    userId,
                    txId: tx.externalTxId,
                })
                .then(handleSigningError)
        } else {
            signingResult = await driver
                .signTransaction(signTransactionParams)
                .then(handleSigningError)
        }

        const now = new Date()

        logDynamically(this.logger, 'Driver signing result', {
            info: {
                transactionId: tx.id,
                status: signingResult.status,
                driverId,
            },
            debug: { signingResult, tx },
        })

        if (signingResult.status === 'signed') {
            if (!signingResult.signature) {
                throw new Error('No signature returned from signing driver')
            }

            const signedTx: Transaction = {
                id: tx.id,
                commandId: tx.commandId,
                status: signingResult.status,
                preparedTransaction: tx.preparedTransaction,
                preparedTransactionHash: tx.preparedTransactionHash,
                origin: tx?.origin ?? null,
                ...(tx?.createdAt && {
                    createdAt: tx.createdAt,
                }),
                signedAt: now,
                externalTxId: signingResult.txId,
            }

            await this.store.setTransactionSigned(
                tx.id,
                now,
                signingResult.txId
            )
            this.notifier.emit('txChanged', signedTx)

            return {
                status: signingResult.status,
                signature: signingResult.signature,
                signedBy: wallet.namespace,
                partyId: wallet.partyId,
                externalTxId: signingResult.txId,
            }
        } else {
            const status =
                signingResult.status === 'pending' ? 'pending' : 'failed'
            const pendingTx: Transaction = {
                id: tx.id,
                commandId: tx.commandId,
                status,
                preparedTransaction: tx.preparedTransaction,
                preparedTransactionHash: tx.preparedTransactionHash,
                externalTxId: signingResult.txId,
                origin: tx?.origin ?? null,
                ...(tx?.createdAt && {
                    createdAt: tx.createdAt,
                }),
            }

            await this.store.setTransactionStatus(tx.id, status, {
                externalTxId: signingResult.txId,
            })

            this.notifier.emit('txChanged', pendingTx)

            return {
                status: signingResult.status,
                externalTxId: signingResult.txId,
                partyId: wallet.partyId,
            }
        }
    }

    private async signWithFireblocks(
        userId: UserId,
        wallet: Wallet,
        signParams: SignParams
    ): Promise<SignResult> {
        const signingProvider = this.signingDrivers[SigningProvider.FIREBLOCKS]
        if (!signingProvider) {
            throw new Error('Fireblocks signing driver not available')
        }
        const driver = signingProvider.controller(userId)

        const tx = await this.loadPreparedTransactionForSigning(
            signParams.transactionId
        )
        let signingResult: Exclude<
            GetTransactionResult | SignTransactionResult,
            SigningError
        >

        if (tx.externalTxId) {
            signingResult = await driver
                .getTransaction({
                    userId,
                    txId: tx.externalTxId,
                })
                .then(handleSigningError)
        } else {
            signingResult = await driver
                .signTransaction({
                    userId,
                    tx: tx.preparedTransaction,
                    txHash: Buffer.from(
                        tx.preparedTransactionHash,
                        'base64'
                    ).toString('hex'),
                    keyIdentifier: {
                        publicKey: wallet.publicKey,
                    },
                })
                .then(handleSigningError)
        }

        const now = new Date()

        logDynamically(this.logger, 'Fireblocks signing result', {
            info: { transactionId: tx.id, status: signingResult.status },
            debug: { signingResult, tx },
        })

        if (signingResult.status === 'signed') {
            if (!signingResult.signature) {
                throw new Error('No signature returned from signing driver')
            }

            const signedTx: Transaction = {
                id: tx.id,
                commandId: tx.commandId,
                status: signingResult.status,
                preparedTransaction: tx.preparedTransaction,
                preparedTransactionHash: tx.preparedTransactionHash,
                origin: tx?.origin ?? null,
                ...(tx?.createdAt && {
                    createdAt: tx.createdAt,
                }),
                signedAt: now,
                externalTxId: signingResult.txId,
            }

            await this.store.setTransactionSigned(
                tx.id,
                now,
                signingResult.txId
            )
            this.notifier.emit('txChanged', signedTx)

            // return signature in format that is already usable in execute
            const decodedSignature = Buffer.from(
                signingResult.signature,
                'hex'
            ).toString('base64')

            return {
                status: signingResult.status,
                signature: decodedSignature,
                signedBy: wallet.namespace,
                partyId: wallet.partyId,
                externalTxId: signingResult.txId,
            }
        } else {
            const status =
                signingResult.status === 'pending' ? 'pending' : 'failed'
            const pendingTx: Transaction = {
                id: tx.id,
                commandId: tx.commandId,
                status,
                preparedTransaction: tx.preparedTransaction,
                preparedTransactionHash: tx.preparedTransactionHash,
                externalTxId: signingResult.txId,
                origin: tx?.origin ?? null,
                ...(tx?.createdAt && {
                    createdAt: tx.createdAt,
                }),
            }

            await this.store.setTransactionStatus(tx.id, status, {
                externalTxId: signingResult.txId,
            })
            this.notifier.emit('txChanged', pendingTx)

            return {
                status: signingResult.status,
                externalTxId: signingResult.txId,
                partyId: wallet.partyId,
            }
        }
    }

    /**
     * Parks a signing request with the coordinator this party's signing is
     * delegated to, then reports its progress.
     *
     * Structurally identical to the remote-custody drivers above -- first pass
     * submits, later passes poll by `externalTxId` -- because it is the same
     * problem: authority lives somewhere this gateway can only wait on. The
     * difference is that a decentralized party needs a *set* of signatures, so
     * a signed result carries `signatures` and the caller submits via
     * {@link executeDelegated} rather than the single-signature path.
     */
    private async signWithDecentralized(
        userId: UserId,
        wallet: Wallet,
        signParams: SignParams
    ): Promise<SignResult> {
        const signingProvider =
            this.signingDrivers[SigningProvider.DECENTRALIZED]
        if (!signingProvider) {
            throw new Error('Decentralized signing driver not available')
        }
        if (!wallet.delegatedSigningUrl) {
            throw new Error(
                `Party ${wallet.partyId} is configured for delegated signing but has no delegatedSigningUrl. Set one before transacting as this party.`
            )
        }
        const driver = signingProvider.controller(userId)

        const tx = await this.loadPreparedTransactionForSigning(
            signParams.transactionId
        )

        let signingResult: Exclude<
            GetTransactionResult | SignTransactionResult,
            SigningError
        >
        if (tx.externalTxId) {
            signingResult = await driver
                .getTransaction({ userId, txId: tx.externalTxId })
                .then(handleSigningError)
        } else {
            // The coordinator and every co-signing wallet work from the
            // base64 Canton hash, so unlike the custody drivers this is
            // passed through as-is rather than hex-encoded.
            const params: DelegatedSignTransactionParams = {
                tx: tx.preparedTransaction,
                txHash: tx.preparedTransactionHash,
                keyIdentifier: { publicKey: wallet.publicKey },
                internalTxId: tx.id,
                delegatedSigningUrl: wallet.delegatedSigningUrl,
                partyId: wallet.partyId,
                commandId: tx.commandId,
            }
            signingResult = await driver
                .signTransaction(params)
                .then(handleSigningError)
        }

        const now = new Date()

        logDynamically(this.logger, 'Delegated signing result', {
            info: {
                transactionId: tx.id,
                status: signingResult.status,
                partyId: wallet.partyId,
            },
            debug: { signingResult, tx },
        })

        if (signingResult.status === 'signed') {
            if (!signingResult.signature) {
                throw new Error('No signature returned from signing driver')
            }
            await this.store.setTransactionSigned(
                tx.id,
                now,
                signingResult.txId
            )
            this.notifier.emit('txChanged', {
                ...tx,
                status: 'signed',
                signedAt: now,
                externalTxId: signingResult.txId,
            } satisfies Transaction)

            return {
                status: 'signed',
                signature: signingResult.signature,
                signedBy: wallet.namespace,
                partyId: wallet.partyId,
                externalTxId: signingResult.txId,
            }
        }

        const status = signingResult.status === 'pending' ? 'pending' : 'failed'
        await this.store.setTransactionStatus(tx.id, status, {
            externalTxId: signingResult.txId,
        })
        this.notifier.emit('txChanged', {
            ...tx,
            status,
            externalTxId: signingResult.txId,
        } satisfies Transaction)

        const handoff = signingResult.metadata as
            | { userUrl?: string; userUrlKind?: 'approval' | 'handoff' }
            | undefined

        return {
            status: signingResult.status,
            externalTxId: signingResult.txId,
            partyId: wallet.partyId,
            ...(status === 'pending' && handoff?.userUrl
                ? {
                      userUrl: handoff.userUrl,
                      ...(handoff.userUrlKind
                          ? { userUrlKind: handoff.userUrlKind }
                          : {}),
                  }
                : {}),
        } as SignResult
    }

    private async signWithDfns(
        userId: UserId,
        wallet: Wallet,
        signParams: SignParams
    ): Promise<SignResult> {
        const signingProvider = this.signingDrivers[SigningProvider.DFNS]
        if (!signingProvider) {
            throw new Error('Dfns signing driver not available')
        }
        const driver = signingProvider.controller(userId)

        const tx = await this.loadPreparedTransactionForSigning(
            signParams.transactionId
        )

        let signingResult: Exclude<
            GetTransactionResult | SignTransactionResult,
            SigningError
        >
        if (tx.externalTxId) {
            signingResult = await driver
                .getTransaction({
                    userId,
                    txId: tx.externalTxId,
                })
                .then(handleSigningError)
        } else {
            signingResult = await driver
                .signTransaction({
                    tx: tx.preparedTransaction,
                    txHash: tx.preparedTransactionHash,
                    keyIdentifier: {
                        publicKey: wallet.publicKey,
                    },
                })
                .then(handleSigningError)
        }

        const now = new Date()

        logDynamically(this.logger, 'Dfns signing result', {
            info: { transactionId: tx.id, status: signingResult.status },
            debug: { signingResult, tx },
        })

        if (signingResult.status === 'signed') {
            if (!signingResult.signature) {
                throw new Error(
                    'No signature returned from Dfns signing driver'
                )
            }

            const signedTx: Transaction = {
                id: tx.id,
                commandId: tx.commandId,
                status: signingResult.status,
                preparedTransaction: tx.preparedTransaction,
                preparedTransactionHash: tx.preparedTransactionHash,
                origin: tx?.origin ?? null,
                ...(tx?.createdAt && {
                    createdAt: tx.createdAt,
                }),
                signedAt: now,
                externalTxId: signingResult.txId,
            }

            await this.store.setTransactionSigned(
                tx.id,
                now,
                signingResult.txId
            )
            this.notifier.emit('txChanged', signedTx)

            return {
                status: signingResult.status,
                signature: signingResult.signature,
                signedBy: wallet.namespace,
                partyId: wallet.partyId,
                externalTxId: signingResult.txId,
            }
        } else {
            const status =
                signingResult.status === 'pending' ? 'pending' : 'failed'
            const pendingTx: Transaction = {
                id: tx.id,
                commandId: tx.commandId,
                status,
                preparedTransaction: tx.preparedTransaction,
                preparedTransactionHash: tx.preparedTransactionHash,
                externalTxId: signingResult.txId,
                origin: tx?.origin ?? null,
                ...(tx?.createdAt && {
                    createdAt: tx.createdAt,
                }),
            }

            await this.store.setTransactionStatus(tx.id, status, {
                externalTxId: signingResult.txId,
            })
            this.notifier.emit('txChanged', pendingTx)

            return {
                status: signingResult.status,
                externalTxId: signingResult.txId,
                partyId: wallet.partyId,
            }
        }
    }

    private async signWithSecurosys(
        userId: UserId,
        wallet: Wallet,
        signParams: SignParams
    ): Promise<SignResult> {
        const signingProvider = this.signingDrivers[SigningProvider.SECUROSYS]
        if (!signingProvider) {
            throw new Error('Securosys signing driver not available')
        }
        const driver = signingProvider.controller(userId)

        const tx = await this.loadPreparedTransactionForSigning(
            signParams.transactionId
        )

        let signingResult: Exclude<
            GetTransactionResult | SignTransactionResult,
            SigningError
        >
        if (tx.externalTxId) {
            signingResult = await driver
                .getTransaction({
                    txId: tx.externalTxId,
                })
                .then(handleSigningError)
        } else {
            signingResult = await driver
                .signTransaction({
                    tx: tx.preparedTransaction,
                    txHash: tx.preparedTransactionHash,
                    keyIdentifier: {
                        id: keyLabelFromPublicKey(wallet.publicKey),
                        publicKey: wallet.publicKey,
                    },
                })
                .then(handleSigningError)
        }

        const now = new Date()

        logDynamically(this.logger, 'Securosys signing result', {
            info: { transactionId: tx.id, status: signingResult.status },
            debug: { signingResult, tx },
        })

        if (signingResult.status === 'signed') {
            if (!signingResult.signature) {
                throw new Error('No signature returned from signing driver')
            }

            const signedTx: Transaction = {
                id: tx.id,
                commandId: tx.commandId,
                status: signingResult.status,
                preparedTransaction: tx.preparedTransaction,
                preparedTransactionHash: tx.preparedTransactionHash,
                origin: tx?.origin ?? null,
                ...(tx?.createdAt && {
                    createdAt: tx.createdAt,
                }),
                signedAt: now,
                externalTxId: signingResult.txId,
            }

            await this.store.setTransactionSigned(
                tx.id,
                now,
                signingResult.txId
            )
            this.notifier.emit('txChanged', signedTx)

            return {
                status: signingResult.status,
                signature: signingResult.signature,
                signedBy: wallet.namespace,
                partyId: wallet.partyId,
                externalTxId: signingResult.txId,
            }
        } else {
            const status =
                signingResult.status === 'pending' ? 'pending' : 'failed'
            const pendingTx: Transaction = {
                id: tx.id,
                commandId: tx.commandId,
                status,
                preparedTransaction: tx.preparedTransaction,
                preparedTransactionHash: tx.preparedTransactionHash,
                externalTxId: signingResult.txId,
                origin: tx?.origin ?? null,
                ...(tx?.createdAt && {
                    createdAt: tx.createdAt,
                }),
            }

            await this.store.setTransactionStatus(tx.id, status, {
                externalTxId: signingResult.txId,
            })

            this.notifier.emit('txChanged', pendingTx)

            return {
                status: signingResult.status,
                externalTxId: signingResult.txId,
                partyId: wallet.partyId,
            }
        }
    }

    private async signWithBitgo(
        userId: UserId,
        wallet: Wallet,
        signParams: SignParams
    ): Promise<SignResult> {
        const signingProvider = this.signingDrivers[SigningProvider.BITGO]
        if (!signingProvider) {
            throw new Error('BitGo signing driver not available')
        }
        const driver = signingProvider.controller(userId)

        const tx = await this.loadPreparedTransactionForSigning(
            signParams.transactionId
        )

        let signingResult: Exclude<
            GetTransactionResult | SignTransactionResult,
            SigningError
        >
        if (tx.externalTxId) {
            signingResult = await driver
                .getTransaction({
                    userId,
                    txId: tx.externalTxId,
                })
                .then(handleSigningError)
        } else {
            signingResult = await driver
                .signTransaction({
                    tx: tx.preparedTransaction,
                    txHash: tx.preparedTransactionHash,
                    keyIdentifier: {
                        publicKey: wallet.publicKey,
                    },
                })
                .then(handleSigningError)
        }

        const now = new Date()

        logDynamically(this.logger, 'BitGo signing result', {
            info: { transactionId: tx.id, status: signingResult.status },
            debug: { signingResult, tx },
        })

        if (signingResult.status === 'signed') {
            if (!signingResult.signature) {
                throw new Error(
                    'No signature returned from BitGo signing driver'
                )
            }

            const signedTx: Transaction = {
                id: tx.id,
                commandId: tx.commandId,
                status: signingResult.status,
                preparedTransaction: tx.preparedTransaction,
                preparedTransactionHash: tx.preparedTransactionHash,
                origin: tx?.origin ?? null,
                ...(tx?.createdAt && {
                    createdAt: tx.createdAt,
                }),
                signedAt: now,
                externalTxId: signingResult.txId,
            }

            await this.store.setTransactionSigned(
                tx.id,
                now,
                signingResult.txId
            )
            this.notifier.emit('txChanged', signedTx)

            return {
                status: signingResult.status,
                signature: signingResult.signature,
                signedBy: wallet.namespace,
                partyId: wallet.partyId,
                externalTxId: signingResult.txId,
            }
        } else {
            const status =
                signingResult.status === 'pending' ? 'pending' : 'failed'
            const pendingTx: Transaction = {
                id: tx.id,
                commandId: tx.commandId,
                status,
                preparedTransaction: tx.preparedTransaction,
                preparedTransactionHash: tx.preparedTransactionHash,
                externalTxId: signingResult.txId,
                origin: tx?.origin ?? null,
                ...(tx?.createdAt && {
                    createdAt: tx.createdAt,
                }),
            }

            await this.store.setTransactionStatus(tx.id, status, {
                externalTxId: signingResult.txId,
            })

            this.notifier.emit('txChanged', pendingTx)

            return {
                status: signingResult.status,
                externalTxId: signingResult.txId,
                partyId: wallet.partyId,
            }
        }
    }

    private async executeWithParticipant(
        userId: UserId,
        executeParams: ExecuteParams,
        transaction: Transaction,
        ledgerClient: LedgerClient,
        network: Network
    ): Promise<ExecuteResult> {
        const { partyId } = executeParams
        const { commandId } = transaction

        const synchronizerId =
            network.synchronizerId ?? (await ledgerClient.getSynchronizerId())

        const prep = ledgerPrepareParams(
            userId,
            [partyId],
            synchronizerId,
            transaction.payload as PrepareParams,
            this.hashingSchemeVersion
        )
        const result = await ledgerClient.postWithRetry(
            '/v2/commands/submit-and-wait',
            prep
        )

        logDynamically(this.logger, 'Participant execution result', {
            info: { transactionId: transaction.id },
            debug: { result, transaction, executeParams, userId },
        })

        const executedTx: Transaction = {
            id: transaction.id,
            commandId,
            status: 'executed',
            preparedTransaction: transaction.preparedTransaction,
            preparedTransactionHash: transaction.preparedTransactionHash,
            payload: result,
            origin: transaction.origin ?? null,
            ...(transaction.createdAt && {
                createdAt: transaction.createdAt,
            }),
            ...(transaction.signedAt && {
                signedAt: transaction.signedAt,
            }),
        }
        await this.store.setTransactionStatus(transaction.id, 'executed', {
            payload: result,
        })
        this.notifier.emit('txChanged', executedTx)

        return result
    }

    private async executeWithExternal(
        userId: UserId,
        executeParams: ExecuteParams,
        transaction: Transaction,
        ledgerClient: LedgerClient
    ): Promise<ExecuteResult> {
        const { partyId, signature, signedBy } = executeParams
        const { commandId } = transaction

        const result = await ledgerClient.postWithRetry(
            '/v2/interactive-submission/executeAndWait',
            {
                userId,
                preparedTransaction: transaction.preparedTransaction,
                hashingSchemeVersion: this.hashingSchemeVersion,
                submissionId: commandId,
                deduplicationPeriod: {
                    Empty: {},
                },
                partySignatures: {
                    signatures: [
                        {
                            party: partyId,
                            signatures: [
                                {
                                    signature,
                                    signedBy,
                                    format: 'SIGNATURE_FORMAT_CONCAT',
                                    signingAlgorithmSpec:
                                        'SIGNING_ALGORITHM_SPEC_ED25519',
                                },
                            ],
                        },
                    ],
                },
            } as Types['JsExecuteSubmissionAndWaitRequest']
        )

        logDynamically(this.logger, 'Externally signed execution result', {
            info: { transactionId: transaction.id },
            debug: { result, transaction, executeParams, userId },
        })

        const executedTx: Transaction = {
            id: transaction.id,
            commandId,
            status: 'executed',
            preparedTransaction: transaction.preparedTransaction,
            preparedTransactionHash: transaction.preparedTransactionHash,
            payload: result,
            origin: transaction.origin ?? null,
            ...(transaction.createdAt && {
                createdAt: transaction.createdAt,
            }),
            ...(transaction.signedAt && {
                signedAt: transaction.signedAt,
            }),
        }
        await this.store.setTransactionStatus(transaction.id, 'executed', {
            payload: result,
        })
        this.notifier.emit('txChanged', executedTx)

        return result
    }

    /**
     * Submits a delegated party's transaction once, carrying every owner's
     * signature.
     *
     * Internal to the gateway: unlike the old dApp-facing
     * dApp-facing submit method, a coordinator never submits directly. It hands
     * the collected signatures to `submitDelegatedSignatures`, which records
     * them against the parked request and then calls this. The gateway
     * already holds the prepared transaction, so nothing security-relevant
     * travels back in from the caller except the signatures themselves --
     * and Canton verifies those against the hash it derives from the
     * transaction being submitted.
     */
    public async executeDelegated(
        userId: UserId,
        ledgerClient: LedgerClient,
        params: ExecuteDelegatedParams
    ): Promise<unknown> {
        const { preparedTransaction, partyId, commandId, signatures } = params

        if (signatures.length === 0) {
            throw new Error(
                'At least one signature is required to submit a delegated transaction'
            )
        }

        const result = await ledgerClient.postWithRetry(
            '/v2/interactive-submission/executeAndWait',
            {
                userId,
                preparedTransaction,
                // Must match what the transaction was prepared with; the
                // scheme is configured once (config.hashingScheme.version)
                // and threaded through, exactly as executeWithExternal does.
                hashingSchemeVersion: this.hashingSchemeVersion,
                submissionId: commandId,
                deduplicationPeriod: { Empty: {} },
                partySignatures: {
                    signatures: [
                        {
                            party: partyId,
                            signatures: signatures.map((entry) => ({
                                signature: entry.signature,
                                signedBy: entry.signedBy,
                                format: 'SIGNATURE_FORMAT_CONCAT',
                                signingAlgorithmSpec:
                                    'SIGNING_ALGORITHM_SPEC_ED25519',
                            })),
                        },
                    ],
                },
            } as Types['JsExecuteSubmissionAndWaitRequest']
        )

        logDynamically(this.logger, 'Delegated multi-signature execution', {
            info: { partyId, commandId, signatureCount: signatures.length },
            debug: { result, params, userId },
        })

        return result
    }
}

// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, beforeEach } from 'vitest'
import nacl from 'tweetnacl'
import naclUtil from 'tweetnacl-util'
import {
    PartyMode,
    SigningProvider,
    type SigningDriverStore,
    type SigningTransaction,
} from '@canton-network/core-signing-lib'
import {
    buildCoordinationUrl,
    DecentralizedSigningDriver,
} from './controller.js'

const USER = 'user-1'
const PARTY = 'joint::namespace'
const PREPARED = 'cHJlcGFyZWQtdHg='
// A real 34-byte Canton multihash shape, base64 -- what actually gets signed.
const TX_HASH = naclUtil.encodeBase64(
    Uint8Array.from([0x12, 0x20, ...new Array(32).fill(7)])
)

function makeStore(): SigningDriverStore {
    const txs = new Map<string, SigningTransaction>()
    const key = (userId: string, txId: string) => `${userId}::${txId}`
    return {
        getSigningTransaction: async (userId: string, txId: string) =>
            txs.get(key(userId, txId)),
        setSigningTransaction: async (
            userId: string,
            transaction: SigningTransaction
        ) => {
            txs.set(key(userId, transaction.id), transaction)
        },
        listSigningTransactionsByTxIdsAndPublicKeys: async (
            txIds: string[],
            publicKeys: string[]
        ) =>
            [...txs.values()].filter(
                (t) => txIds.includes(t.id) || publicKeys.includes(t.publicKey)
            ),
    } as unknown as SigningDriverStore
}

const signParams = (overrides: Record<string, unknown> = {}) => ({
    tx: PREPARED,
    txHash: TX_HASH,
    keyIdentifier: { publicKey: 'owner-public-key' },
    internalTxId: 'request-1',
    delegatedSigningUrl: 'https://coordinator.example',
    partyId: PARTY,
    commandId: 'command-1',
    ...overrides,
})

describe('buildCoordinationUrl', () => {
    it('carries everything an owner needs to act, including the request id', () => {
        const url = new URL(
            buildCoordinationUrl('https://coordinator.example', {
                requestId: 'request-1',
                preparedTransaction: PREPARED,
                preparedTransactionHash: TX_HASH,
                partyId: PARTY,
                commandId: 'command-1',
            })
        )

        expect(url.origin + url.pathname).toBe(
            'https://coordinator.example/coordinate'
        )
        expect(url.searchParams.get('requestId')).toBe('request-1')
        expect(url.searchParams.get('preparedTransaction')).toBe(PREPARED)
        expect(url.searchParams.get('preparedTransactionHash')).toBe(TX_HASH)
        expect(url.searchParams.get('partyId')).toBe(PARTY)
        expect(url.searchParams.get('commandId')).toBe('command-1')
    })

    it('does not double the separator when the configured URL has a trailing slash', () => {
        const url = buildCoordinationUrl('https://coordinator.example/', {
            requestId: 'r',
            preparedTransaction: 'p',
            preparedTransactionHash: 'h',
        })
        expect(url.startsWith('https://coordinator.example/coordinate?')).toBe(
            true
        )
    })
})

describe('DecentralizedSigningDriver', () => {
    let store: SigningDriverStore
    let driver: DecentralizedSigningDriver

    beforeEach(() => {
        store = makeStore()
        driver = new DecentralizedSigningDriver(store)
    })

    it('declares itself as an external-party decentralized provider', () => {
        expect(driver.partyMode).toBe(PartyMode.EXTERNAL)
        expect(driver.signingProvider).toBe(SigningProvider.DECENTRALIZED)
    })

    describe('signTransaction', () => {
        it('parks the request as pending and returns where the owner must go', async () => {
            const result = await driver
                .controller(USER)
                .signTransaction(signParams())

            expect(result).toMatchObject({
                txId: 'request-1',
                status: 'pending',
            })
            expect('signature' in result).toBe(false)

            const userUrl = (result as { metadata?: { userUrl?: string } })
                .metadata?.userUrl
            expect(userUrl).toContain('https://coordinator.example/coordinate')
            expect(userUrl).toContain('requestId=request-1')
        })

        it('declares the coordination page a handoff, not an approval', async () => {
            // A client needs to know this is someone else's application --
            // a browser gives it a real tab instead of the small popup used
            // for this wallet's own approve page.
            const result = await driver
                .controller(USER)
                .signTransaction(signParams())

            expect(
                (result as { metadata?: { userUrlKind?: string } }).metadata
                    ?.userUrlKind
            ).toBe('handoff')
        })

        it('records the hash it was asked to sign, so later signatures are checked against it', async () => {
            await driver.controller(USER).signTransaction(signParams())
            const stored = await store.getSigningTransaction(USER, 'request-1')
            expect(stored?.hash).toBe(TX_HASH)
            expect(stored?.status).toBe('pending')
        })

        it('refuses when the party has no coordinator configured', async () => {
            const result = await driver
                .controller(USER)
                .signTransaction(signParams({ delegatedSigningUrl: undefined }))

            expect(result).toMatchObject({ error: 'signing_error' })
            expect(
                (result as { error_description: string }).error_description
            ).toMatch(/no delegatedSigningUrl/)
        })

        it('refuses without a user context, rather than parking an unreachable request', async () => {
            const result = await driver
                .controller(undefined)
                .signTransaction(signParams())
            expect(result).toMatchObject({ error: 'signing_error' })
        })
    })

    describe('submitSignatures', () => {
        beforeEach(async () => {
            await driver.controller(USER).signTransaction(signParams())
        })

        it('marks the request signed and returns the whole set', async () => {
            await driver.submitSignatures(USER, 'request-1', [
                { signature: 'sig-1', signedBy: 'owner-1' },
                { signature: 'sig-2', signedBy: 'owner-2' },
            ])

            const result = await driver
                .controller(USER)
                .getTransaction({ txId: 'request-1' })

            expect(result).toMatchObject({ status: 'signed' })
            expect(
                (result as { signatures?: unknown[] }).signatures
            ).toHaveLength(2)
            // `signature` stays populated so the ordinary single-signature
            // execute path keeps working against this driver unchanged.
            expect((result as { signature?: string }).signature).toBe('sig-1')
        })

        it('rejects a signature that does not verify against the recorded hash', async () => {
            const keyPair = nacl.sign.keyPair()
            const wrong = naclUtil.encodeBase64(
                nacl.sign.detached(
                    naclUtil.decodeBase64(
                        naclUtil.encodeBase64(new Uint8Array([1, 2, 3]))
                    ),
                    keyPair.secretKey
                )
            )

            await expect(
                driver.submitSignatures(USER, 'request-1', [
                    {
                        signature: wrong,
                        signedBy: 'owner-1',
                        publicKey: naclUtil.encodeBase64(keyPair.publicKey),
                    },
                ])
            ).rejects.toThrow(/does not verify/)
        })

        it('accepts a signature that does verify against the recorded hash', async () => {
            const keyPair = nacl.sign.keyPair()
            const good = naclUtil.encodeBase64(
                nacl.sign.detached(
                    naclUtil.decodeBase64(TX_HASH),
                    keyPair.secretKey
                )
            )

            await expect(
                driver.submitSignatures(USER, 'request-1', [
                    {
                        signature: good,
                        signedBy: 'owner-1',
                        publicKey: naclUtil.encodeBase64(keyPair.publicKey),
                    },
                ])
            ).resolves.toBeUndefined()
        })

        it('refuses an unknown request', async () => {
            await expect(
                driver.submitSignatures(USER, 'nope', [
                    { signature: 's', signedBy: 'o' },
                ])
            ).rejects.toThrow(/No delegated signing request/)
        })

        it('refuses an empty signature set', async () => {
            await expect(
                driver.submitSignatures(USER, 'request-1', [])
            ).rejects.toThrow(/At least one signature/)
        })

        it('refuses to complete the same request twice', async () => {
            await driver.submitSignatures(USER, 'request-1', [
                { signature: 'sig-1', signedBy: 'owner-1' },
            ])
            await expect(
                driver.submitSignatures(USER, 'request-1', [
                    { signature: 'sig-2', signedBy: 'owner-2' },
                ])
            ).rejects.toThrow(/already signed/)
        })
    })

    describe('rejectRequest', () => {
        it('marks the request rejected with a reason', async () => {
            await driver.controller(USER).signTransaction(signParams())
            await driver.rejectRequest(USER, 'request-1', 'owners declined')

            const parked = await driver.getRequest(USER, 'request-1')
            expect(parked).toMatchObject({
                status: 'rejected',
                reason: 'owners declined',
            })
        })

        it('refuses an unknown request', async () => {
            await expect(
                driver.rejectRequest(USER, 'nope', 'x')
            ).rejects.toThrow(/No delegated signing request/)
        })
    })

    describe('getRequest', () => {
        it('returns undefined for an unknown request', async () => {
            expect(await driver.getRequest(USER, 'nope')).toBeUndefined()
        })

        it('exposes the party, so the gateway can submit without trusting the caller', async () => {
            await driver.controller(USER).signTransaction(signParams())
            const parked = await driver.getRequest(USER, 'request-1')
            expect(parked).toMatchObject({
                requestId: 'request-1',
                partyId: PARTY,
                commandId: 'command-1',
                delegatedSigningUrl: 'https://coordinator.example',
                status: 'pending',
            })
        })
    })

    describe('the rest of the driver surface', () => {
        it('reports no keys, so wallet sync never matches a namespace to this driver', async () => {
            // Assignment is explicit (a wallet is pinned to this provider when
            // its coordinator is set); a decentralized namespace is no key's
            // fingerprint, so matching here would only ever be wrong.
            await expect(driver.controller(USER).getKeys()).resolves.toEqual({
                keys: [],
            })
        })

        it('cannot sign an arbitrary message', async () => {
            await expect(
                driver.controller(USER).signMessage({ message: 'hello' })
            ).resolves.toMatchObject({ error: 'not_allowed' })
        })

        it('cannot create a key', async () => {
            await expect(
                driver.controller(USER).createKey({ name: 'k' })
            ).resolves.toMatchObject({ error: 'not_allowed' })
        })

        it('is configured per wallet, not per driver', async () => {
            await expect(
                driver.controller(USER).setConfiguration({})
            ).resolves.toMatchObject({ error: 'not_allowed' })
            await expect(
                driver.controller(USER).getConfiguration()
            ).resolves.toEqual({})
        })

        it('reports a missing transaction rather than throwing', async () => {
            await expect(
                driver.controller(USER).getTransaction({ txId: 'nope' })
            ).resolves.toMatchObject({ error: 'transaction_not_found' })
        })

        it('needs a user context to read a transaction back', async () => {
            await expect(
                driver.controller(undefined).getTransaction({ txId: 'x' })
            ).resolves.toMatchObject({ error: 'transaction_not_found' })
        })

        it('lists parked requests by id', async () => {
            await driver.controller(USER).signTransaction(signParams())
            const result = await driver
                .controller(USER)
                .getTransactions({ txIds: ['request-1'] })
            expect(
                (result as { transactions: unknown[] }).transactions
            ).toHaveLength(1)
        })

        it('lists nothing without a user context', async () => {
            await expect(
                driver.controller(undefined).getTransactions({ txIds: ['x'] })
            ).resolves.toEqual({ transactions: [] })
        })

        it('does not implement subscriptions', () => {
            expect(() =>
                driver.controller(USER).subscribeTransactions({ txIds: [] })
            ).toThrow(/not implemented/)
        })
    })
})

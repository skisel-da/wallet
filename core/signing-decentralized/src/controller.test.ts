// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import naclUtil from 'tweetnacl-util'
import { PartyMode, SigningProvider } from '@canton-network/core-signing-lib'
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
    const driver = new DecentralizedSigningDriver()

    it('declares itself as an external-party decentralized provider', () => {
        expect(driver.partyMode).toBe(PartyMode.EXTERNAL)
        expect(driver.signingProvider).toBe(SigningProvider.DECENTRALIZED)
    })

    describe('signTransaction', () => {
        it('returns where the owner must go, and signs nothing', async () => {
            const result = await driver
                .controller(USER)
                .signTransaction(signParams())

            expect(result).toMatchObject({
                txId: 'request-1',
                status: 'pending',
            })
            expect('signature' in result).toBe(false)

            const metadata = (result as { metadata?: { userUrl?: string } })
                .metadata
            expect(metadata?.userUrl).toContain(
                'https://coordinator.example/coordinate'
            )
            expect(metadata?.userUrl).toContain('requestId=request-1')
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

        it('refuses when the party has no coordinator configured', async () => {
            const result = await driver
                .controller(USER)
                .signTransaction(signParams({ delegatedSigningUrl: undefined }))

            expect(result).toMatchObject({ error: 'signing_error' })
            expect(
                (result as { error_description: string }).error_description
            ).toMatch(/no delegatedSigningUrl/)
        })

        it('refuses without a user context', async () => {
            const result = await driver
                .controller(undefined)
                .signTransaction(signParams())
            expect(result).toMatchObject({ error: 'signing_error' })
        })
    })

    describe('the rest of the driver surface', () => {
        it('keeps no record, because it completes nothing', async () => {
            // The coordinator submits to Canton itself. A record here could
            // only be closed by the user who prepared it -- never the one who
            // finalizes -- so keeping one would leak on every transaction.
            await driver.controller(USER).signTransaction(signParams())

            await expect(
                driver.controller(USER).getTransaction({ txId: 'request-1' })
            ).resolves.toMatchObject({ error: 'transaction_not_found' })
            await expect(
                driver
                    .controller(USER)
                    .getTransactions({ txIds: ['request-1'] })
            ).resolves.toEqual({ transactions: [] })
        })

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

        it('does not implement subscriptions', () => {
            expect(() =>
                driver.controller(USER).subscribeTransactions({ txIds: [] })
            ).toThrow(/not implemented/)
        })
    })
})

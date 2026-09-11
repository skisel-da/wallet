// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixture, waitUntil } from '@open-wc/testing-helpers'
import { html } from 'lit'
import {
    TransactionApproveEvent,
    TransactionDeleteEvent,
} from '@canton-network/core-wallet-ui-components'
import { createMockUserClient, mockRequest } from '../test-helpers.js'

const {
    mockCreateUserClient,
    showToast,
    handleErrorToast,
    setLocationHref,
    parsePreparedTransaction,
    hashPreparedTransaction,
} = vi.hoisted(() => ({
    mockCreateUserClient: vi.fn(),
    showToast: vi.fn(),
    handleErrorToast: vi.fn(),
    setLocationHref: vi.fn(),
    parsePreparedTransaction: vi.fn(() => ({ summary: 'parsed' })),
    hashPreparedTransaction: vi.fn(async () => 'hash-of-blob'),
}))

vi.mock('../index.js', () => ({}))
vi.mock('../navigation.js', () => ({ setLocationHref }))
vi.mock('../rpc-client.js', () => ({
    createUserClient: mockCreateUserClient,
}))
vi.mock('../state-manager.js', () => ({
    stateManager: {
        accessToken: { get: () => 'test-token' },
        currentOrigin: {
            get: vi.fn().mockReturnValue('http://localhost'),
            set: vi.fn(),
            clear: vi.fn(),
        },
    },
}))
vi.mock('../utils.js', () => ({ showToast }))
vi.mock('@canton-network/core-tx-visualizer', () => ({
    parsePreparedTransaction,
    hashPreparedTransaction,
}))
vi.mock('@canton-network/core-wallet-ui-components', async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import('@canton-network/core-wallet-ui-components')
        >()
    return {
        ...actual,
        handleErrorToast,
    }
})

import './index.js'
import { UserUiSignPreparedTransaction } from './index.js'

function makePreparedTransactionToSignDto(
    overrides: Partial<{
        id: string
        status: string
        partyId: string
        publicKey: string
        preparedTransaction: string
        origin: string
        createdAt: string
        signedAt: string
    }> = {}
) {
    return {
        id: 'req-1',
        status: 'pending',
        partyId: 'alice::1220abc',
        publicKey: 'pk',
        preparedTransaction: 'prepared-tx-blob',
        origin: 'https://dapp.example',
        createdAt: '2024-06-01T12:00:00.000Z',
        ...overrides,
    }
}

function mockSignState(record = makePreparedTransactionToSignDto()) {
    mockRequest.mockImplementation(async ({ method }) => {
        if (method === 'getPreparedTransactionToSign') {
            return { record }
        }
        if (method === 'signPreparedTransaction') {
            return { signature: 'sig', signedBy: 'pk' }
        }
        if (method === 'deletePreparedTransactionToSign') {
            return null
        }
        return undefined
    })
}

describe('UserUiSignPreparedTransaction', () => {
    let el: UserUiSignPreparedTransaction
    const componentFixture = html`<user-ui-sign-prepared-transaction></user-ui-sign-prepared-transaction>`

    beforeEach(() => {
        mockCreateUserClient.mockReset()
        mockRequest.mockReset()
        showToast.mockReset()
        handleErrorToast.mockReset()
        setLocationHref.mockReset()
        parsePreparedTransaction.mockClear()
        hashPreparedTransaction.mockClear()
        mockCreateUserClient.mockResolvedValue(createMockUserClient())
        history.replaceState({}, '', '?requestId=req-1')
    })

    afterEach(() => {
        document.body.innerHTML = ''
        vi.unstubAllGlobals()
        vi.useRealTimers()
    })

    describe('with a pending signing request', () => {
        beforeEach(async () => {
            mockSignState()
            el = await fixture<UserUiSignPreparedTransaction>(componentFixture)
            await waitUntil(() => el.status === 'pending')
        })

        it('loads the request from the URL and renders the detail view', () => {
            expect(el.requestId).toBe('req-1')
            expect(parsePreparedTransaction).toHaveBeenCalledWith(
                'prepared-tx-blob'
            )
            // Derived from the blob the page is showing, not served with it.
            expect(hashPreparedTransaction).toHaveBeenCalledWith(
                'prepared-tx-blob'
            )
            expect(el.preparedTransactionHash).toBe('hash-of-blob')
            expect(
                el.shadowRoot?.querySelector('wg-transaction-detail')
            ).not.toBeNull()
        })

        it('signs the prepared transaction and redirects to activities on approve', async () => {
            el.shadowRoot
                ?.querySelector('wg-transaction-detail')
                ?.dispatchEvent(new TransactionApproveEvent('req-1'))

            await waitUntil(() =>
                mockRequest.mock.calls.some(
                    (c) => c[0]?.method === 'signPreparedTransaction'
                )
            )
            await waitUntil(
                () => setLocationHref.mock.calls.length > 0,
                'redirect after approve',
                { timeout: 3000 }
            )

            expect(mockRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'signPreparedTransaction',
                    params: { requestId: 'req-1' },
                })
            )
            expect(showToast).toHaveBeenCalledWith(
                '',
                'Prepared transaction signed',
                'success'
            )
            expect(setLocationHref).toHaveBeenCalledWith(
                expect.stringContaining('/activities')
            )
            expect(el.disabled).toBe(true)
        })

        it('deletes the signing request on reject', async () => {
            el.shadowRoot
                ?.querySelector('wg-transaction-detail')
                ?.dispatchEvent(new TransactionDeleteEvent('req-1'))

            await waitUntil(() =>
                mockRequest.mock.calls.some(
                    (c) => c[0]?.method === 'deletePreparedTransactionToSign'
                )
            )
            await waitUntil(
                () => setLocationHref.mock.calls.length > 0,
                'redirect after reject',
                { timeout: 3000 }
            )

            expect(mockRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'deletePreparedTransactionToSign',
                    params: { requestId: 'req-1' },
                })
            )
            expect(showToast).toHaveBeenCalledWith(
                '',
                'Signing request rejected',
                'success'
            )
            expect(setLocationHref).toHaveBeenCalledWith(
                expect.stringContaining('/activities')
            )
        })
    })

    describe('with closeafteraction in the URL', () => {
        beforeEach(async () => {
            history.replaceState({}, '', '?requestId=req-1&closeafteraction')
            mockSignState()
            el = await fixture<UserUiSignPreparedTransaction>(componentFixture)
            await waitUntil(() => el.status === 'pending')
        })

        it('closes the window after approve when opened from the Safe App', async () => {
            const openerGet = vi
                .spyOn(window, 'opener', 'get')
                .mockReturnValue({} as Window)
            const closeSpy = vi
                .spyOn(window, 'close')
                .mockImplementation(() => {})

            el.shadowRoot
                ?.querySelector('wg-transaction-detail')
                ?.dispatchEvent(new TransactionApproveEvent('req-1'))

            await waitUntil(() =>
                mockRequest.mock.calls.some(
                    (c) => c[0]?.method === 'signPreparedTransaction'
                )
            )
            await waitUntil(
                () => closeSpy.mock.calls.length > 0,
                'close popup after approve',
                { timeout: 3000 }
            )

            openerGet.mockRestore()
            closeSpy.mockRestore()

            expect(setLocationHref).not.toHaveBeenCalled()
            expect(el.disabled).toBe(true)
        })
    })

    describe('when the request is missing', () => {
        beforeEach(async () => {
            mockRequest.mockImplementation(async ({ method }) => {
                if (method === 'getPreparedTransactionToSign') {
                    throw new Error('not found')
                }
                return undefined
            })
            el = await fixture<UserUiSignPreparedTransaction>(componentFixture)
            await waitUntil(() => el.loadError !== null)
        })

        it('shows an error message instead of the detail view', () => {
            expect(el.loadError).toContain('not found')
            expect(
                el.shadowRoot?.querySelector('wg-transaction-detail')
            ).toBeNull()
            expect(
                el.shadowRoot?.querySelector('.alert-warning')
            ).not.toBeNull()
        })
    })
})

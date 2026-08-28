// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixture, waitUntil } from '@open-wc/testing-helpers'
import { html } from 'lit'
import { createMockUserClient, mockRequest } from '../test-helpers.js'

const { mockCreateUserClient, handleErrorToast, setLocationHref } = vi.hoisted(
    () => ({
        mockCreateUserClient: vi.fn(),
        handleErrorToast: vi.fn(),
        setLocationHref: vi.fn(),
    })
)

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
vi.mock('@canton-network/core-wallet-ui-components', async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import('@canton-network/core-wallet-ui-components')
        >()
    return { ...actual, handleErrorToast }
})

import './index.js'
import { UserUiSignTopology } from './index.js'

function makeRpcTransportError(rpcMessage: string) {
    return {
        error: {
            code: -32600,
            message: 'Bad Request',
            data: JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32600, message: rpcMessage },
                id: null,
            }),
        },
    }
}

describe('UserUiSignTopology', () => {
    let el: UserUiSignTopology
    const componentFixture = html`<user-ui-sign-topology></user-ui-sign-topology>`

    beforeEach(() => {
        mockCreateUserClient.mockReset()
        mockRequest.mockReset()
        handleErrorToast.mockReset()
        setLocationHref.mockReset()
        mockCreateUserClient.mockResolvedValue(createMockUserClient())
        vi.stubGlobal(
            'confirm',
            vi.fn(() => true)
        )
    })

    afterEach(() => {
        document.body.innerHTML = ''
        vi.unstubAllGlobals()
    })

    it('shows an error when requestId is missing from the URL', async () => {
        history.replaceState({}, '', '/sign-topology')

        el = await fixture<UserUiSignTopology>(componentFixture)

        await waitUntil(() => el.loadError !== null)

        expect(el.shadowRoot?.textContent).toContain(
            'Topology-transactions request not found'
        )
        expect(mockRequest).not.toHaveBeenCalled()
    })

    it('renders the decoded summaries after loading', async () => {
        history.replaceState({}, '', '?requestId=req-1')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getTopologyBundleToSign') {
                return {
                    bundle: {
                        id: 'req-1',
                        status: 'pending',
                        partyId: 'party-1',
                        publicKey: 'pk',
                        transactions: ['dGVzdA=='],
                        summaries: [
                            {
                                kind: 'decentralizedNamespaceDefinition',
                                decentralizedNamespace: 'ns::1',
                                threshold: 2,
                                owners: ['a', 'b', 'c'],
                            },
                        ],
                        synchronizerId: 'synchronizer::1',
                        origin: 'https://dapp.example',
                        createdAt: '2026-01-01T00:00:00.000Z',
                    },
                }
            }
            return undefined
        })

        el = await fixture<UserUiSignTopology>(componentFixture)

        await waitUntil(() => el.summaries.length > 0)

        expect(el.shadowRoot?.textContent).toContain('ns::1')
        expect(el.shadowRoot?.textContent).toContain('https://dapp.example')
        expect(el.shadowRoot?.textContent).toContain('synchronizer::1')
        expect(el.shadowRoot?.querySelector('.btn-primary')).not.toBeNull()
    })

    it('calls signTopologyTransactions when approve is clicked', async () => {
        history.replaceState({}, '', '?requestId=req-1')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getTopologyBundleToSign') {
                return {
                    bundle: {
                        id: 'req-1',
                        status: 'pending',
                        partyId: 'party-1',
                        publicKey: 'pk',
                        transactions: ['dGVzdA=='],
                        summaries: [
                            { kind: 'unknown', mappingKind: 'unknown' },
                        ],
                        createdAt: '2026-01-01T00:00:00.000Z',
                    },
                }
            }
            if (method === 'signTopologyTransactions') {
                return undefined
            }
            return undefined
        })

        el = await fixture<UserUiSignTopology>(componentFixture)
        await waitUntil(() => el.summaries.length > 0)

        el.shadowRoot?.querySelector<HTMLButtonElement>('.btn-primary')?.click()

        await waitUntil(() =>
            mockRequest.mock.calls.some(
                (c) => c[0]?.method === 'signTopologyTransactions'
            )
        )
        await waitUntil(
            () => setLocationHref.mock.calls.length > 0,
            'navigation after sign',
            { timeout: 1000 }
        )

        expect(mockRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'signTopologyTransactions',
                params: { requestId: 'req-1' },
            })
        )
    })

    it('calls deleteTopologyBundleToSign when reject is confirmed', async () => {
        history.replaceState({}, '', '?requestId=req-1')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getTopologyBundleToSign') {
                return {
                    bundle: {
                        id: 'req-1',
                        status: 'pending',
                        partyId: 'party-1',
                        publicKey: 'pk',
                        transactions: ['dGVzdA=='],
                        summaries: [
                            { kind: 'unknown', mappingKind: 'unknown' },
                        ],
                        createdAt: '2026-01-01T00:00:00.000Z',
                    },
                }
            }
            if (method === 'deleteTopologyBundleToSign') {
                return undefined
            }
            return undefined
        })

        el = await fixture<UserUiSignTopology>(componentFixture)
        await waitUntil(() => el.summaries.length > 0)

        el.shadowRoot
            ?.querySelector<HTMLButtonElement>('.btn-outline-danger')
            ?.click()

        await waitUntil(() =>
            mockRequest.mock.calls.some(
                (c) => c[0]?.method === 'deleteTopologyBundleToSign'
            )
        )
        await waitUntil(
            () => setLocationHref.mock.calls.length > 0,
            'navigation after reject',
            { timeout: 1000 }
        )

        expect(mockRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'deleteTopologyBundleToSign',
                params: { requestId: 'req-1' },
            })
        )
    })

    it('shows the extracted RPC error message when signTopologyTransactions fails', async () => {
        history.replaceState({}, '', '?requestId=req-1')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getTopologyBundleToSign') {
                return {
                    bundle: {
                        id: 'req-1',
                        status: 'pending',
                        partyId: 'party-1',
                        publicKey: 'pk',
                        transactions: ['dGVzdA=='],
                        summaries: [
                            { kind: 'unknown', mappingKind: 'unknown' },
                        ],
                        createdAt: '2026-01-01T00:00:00.000Z',
                    },
                }
            }
            if (method === 'signTopologyTransactions') {
                throw makeRpcTransportError('Party not authorized to sign')
            }
            return undefined
        })

        el = await fixture<UserUiSignTopology>(componentFixture)
        await waitUntil(() => el.summaries.length > 0)

        el.shadowRoot?.querySelector<HTMLButtonElement>('.btn-primary')?.click()

        await waitUntil(() => handleErrorToast.mock.calls.length > 0)

        expect(handleErrorToast).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Party not authorized to sign',
            }),
            { message: 'Party not authorized to sign' }
        )
        expect(setLocationHref).not.toHaveBeenCalled()
        expect(el.isApproving).toBe(false)
    })

    it('redirects to activities after approve when closeafteraction is not set', async () => {
        history.replaceState({}, '', '?requestId=req-1')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getTopologyBundleToSign') {
                return {
                    bundle: {
                        id: 'req-1',
                        status: 'pending',
                        partyId: 'party-1',
                        publicKey: 'pk',
                        transactions: ['dGVzdA=='],
                        summaries: [
                            { kind: 'unknown', mappingKind: 'unknown' },
                        ],
                        createdAt: '2026-01-01T00:00:00.000Z',
                    },
                }
            }
            if (method === 'signTopologyTransactions') {
                return undefined
            }
            return undefined
        })

        el = await fixture<UserUiSignTopology>(componentFixture)
        await waitUntil(() => el.summaries.length > 0)

        const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})

        el.shadowRoot?.querySelector<HTMLButtonElement>('.btn-primary')?.click()

        await waitUntil(() =>
            mockRequest.mock.calls.some(
                (c) => c[0]?.method === 'signTopologyTransactions'
            )
        )
        await waitUntil(
            () => setLocationHref.mock.calls.length > 0,
            'redirect after sign',
            { timeout: 3000 }
        )
        closeSpy.mockRestore()

        expect(closeSpy).not.toHaveBeenCalled()
        expect(setLocationHref).toHaveBeenCalledWith(
            expect.stringContaining('/activities')
        )
        expect(el.disabled).toBe(true)
    })
})

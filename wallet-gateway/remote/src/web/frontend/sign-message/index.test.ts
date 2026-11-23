// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError } from '@canton-network/core-rpc-errors'
import { fixture, waitUntil } from '@open-wc/testing-helpers'
import { html } from 'lit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockUserClient, mockRequest } from '../__tests__/test-helpers.ts'

const { mockCreateUserClient, handleErrorToast, setLocationHref, showToast } =
    vi.hoisted(() => ({
        mockCreateUserClient: vi.fn(),
        handleErrorToast: vi.fn(),
        setLocationHref: vi.fn(),
        showToast: vi.fn(),
    }))

vi.mock('../index.ts', () => ({}))
vi.mock('../utils.ts', () => ({ showToast }))
vi.mock('../navigation.ts', () => ({ setLocationHref }))
vi.mock('../rpc-client.ts', () => ({
    createUserClient: mockCreateUserClient,
}))
vi.mock('../state-manager.ts', () => ({
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

import './index.ts'
import type { UserUiSignMessage } from './index.ts'

function approveButton(el: UserUiSignMessage) {
    return el.shadowRoot
        ?.querySelector('wg-message-detail')
        ?.shadowRoot?.querySelector<HTMLButtonElement>('.btn-primary')
}

function rejectButton(el: UserUiSignMessage) {
    return el.shadowRoot
        ?.querySelector('wg-message-detail')
        ?.shadowRoot?.querySelector<HTMLButtonElement>('.btn-outline-danger')
}

function detailText(el: UserUiSignMessage) {
    return el.shadowRoot?.querySelector('wg-message-detail')?.shadowRoot
        ?.textContent
}

const preparedTransaction =
    'Ct8ECgMyLjESATAasAQKATDCPqkECqYECgMyLjESQjAwOWE3N2MwMDg1YTcxYzk4YzI0YTZjNmVhN2FiOGE3YWU5MGQ3ZmMzMWJjMjFlMGY4NmJhYTgzMThmNjc0YjJjNhoMaGFzaC12ZWN0b3JzIlYKQDdhYzA2NTBlZjRkMzg2YTQyYmNiYzdmZTEyOWY0MTgwNmRhYTA0MDYzZmYwOTcwYTVhM2NkZDZmNGY4MjllNjgSC0hhc2hWZWN0b3JzGgVQbGFpbirAAXK9AQpWCkA3YWMwNjUwZWY0ZDM4NmE0MmJjYmM3ZmUxMjlmNDE4MDZkYWEwNDA2M2ZmMDk3MGE1YTNjZGQ2ZjRmODI5ZTY4EgtIYXNoVmVjdG9ycxoFUGxhaW4SYwoFb3duZXISWjpYaGFzaC12ZWN0b3JzLW93bmVyOjoxMjIwZWQzYjIxNzQ1NGJiNmRmNzE1MzlkODExOWQ2NzkyMTBlZjUyOGNhOGQzNjcxMTc3OWViMDlkNWQ3MzM3YjA5NTJYaGFzaC12ZWN0b3JzLW93bmVyOjoxMjIwZWQzYjIxNzQ1NGJiNmRmNzE1MzlkODExOWQ2NzkyMTBlZjUyOGNhOGQzNjcxMTc3OWViMDlkNWQ3MzM3YjA5NTpYaGFzaC12ZWN0b3JzLW93bmVyOjoxMjIwZWQzYjIxNzQ1NGJiNmRmNzE1MzlkODExOWQ2NzkyMTBlZjUyOGNhOGQzNjcxMTc3OWViMDlkNWQ3MzM3YjA5NSIiEiAgG/aBryCzULzqnIUtSxt6QhqaSPxEPec7P1A5OonL9RKGAhKAAQpYaGFzaC12ZWN0b3JzLW93bmVyOjoxMjIwZWQzYjIxNzQ1NGJiNmRmNzE1MzlkODExOWQ2NzkyMTBlZjUyOGNhOGQzNjcxMTc3OWViMDlkNWQ3MzM3YjA5NRIkMWRiOTE0Y2MtMjU5ZC00NmMwLWExYTAtNDk3YzJlOTcxYjJmGlJ3YWxsZXQ6OjEyMjBlN2IyM2VhNTJlYjVjNjcyZmIwYjFjZGJjOTE2OTIyZmZlZDNkZDc2NzZjMjIzYTYwNTY2NDMxNWUyZDQzZWRkOjozNS0wKiQ4MTY1MzI2NS01NmFhLTQzOGMtYjMxYS0yYzEwYTcwNzVhNmEw7+a/ivrTlwM='
const topologyTransaction =
    'CoQCCAEQARr9AUr6AQphZ29sZGVuLXZlY3Rvci0xNzg3OTE3ODM4Mzk2OjoxMjIwMThhZDRlODg4MzM2YzMzNWE1ZTI1MWM1YTY2NmM1Yzg1M2I4ZThmNjY1OTA2NTMyYWNhOWJjMzVhNzAwYzVlMBABGlYKUnBhcnRpY2lwYW50MTo6MTIyMGQ5ZmQwMTgyZjk0MDc0NWU4MDQ4MDljNGZjMDNlYTM2ZWM4NTA5ZTYzOGFiNzY3NzUwN2VmNjliMDlkODUwNGIQAjI7CjcQBBosMCowBQYDK2VwAyEAvW4WzV5napgjv6Gmm3NaWoUKH5p1P3GvTHLaXgwD4iMqAwEFBDABEAEQHg=='
const topologyParty =
    'golden-vector-1787917838396::122018ad4e888336c335a5e251c5a666c5c853b8e8f665906532aca9bc35a700c5e0'

const signedResult = {
    status: 'signed',
    signature: 'signature',
    publicKey: 'public-key',
}
const POLL_INTERVAL_MS = 3000

function makeRpcTransportError(rpcMessage: string) {
    return new JsonRpcError(
        -32600,
        'Bad Request',
        JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32600, message: rpcMessage },
            id: null,
        })
    )
}

describe('UserUiSignMessage', () => {
    let el: UserUiSignMessage
    const componentFixture = html`<user-ui-sign-message></user-ui-sign-message>`

    beforeEach(() => {
        mockCreateUserClient.mockReset()
        mockRequest.mockReset()
        handleErrorToast.mockReset()
        setLocationHref.mockReset()
        showToast.mockReset()
        mockCreateUserClient.mockResolvedValue(createMockUserClient())
        vi.stubGlobal(
            'confirm',
            vi.fn(() => true)
        )
    })

    afterEach(() => {
        // make sure toast is gone from DOM
        document.body.innerHTML = ''
        vi.unstubAllGlobals()
    })

    it('shows an error when messageId is missing from the URL', async () => {
        history.replaceState({}, '', '/sign-message')

        el = await fixture<UserUiSignMessage>(componentFixture)

        await waitUntil(() => el.loadError !== null)

        expect(el.shadowRoot?.textContent).toContain('Message not found')
        expect(mockRequest).not.toHaveBeenCalled()
    })

    it('renders the message content after loading', async () => {
        history.replaceState({}, '', '?messageId=msg-1')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getMessageToSign') {
                return {
                    message: {
                        message: 'Hello, Canton',
                        origin: 'https://dapp.example',
                        status: 'pending',
                    },
                }
            }
            return undefined
        })

        el = await fixture<UserUiSignMessage>(componentFixture)

        await waitUntil(() => !el.isLoading && el.message === 'Hello, Canton')

        expect(detailText(el)).toContain('Hello, Canton')
        expect(detailText(el)).toContain('https://dapp.example')
        expect(approveButton(el)).not.toBeNull()
    })

    it('renders a prepared transaction to co-sign', async () => {
        history.replaceState({}, '', '?messageId=msg-prepared')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getMessageToSign') {
                return {
                    message: {
                        message: preparedTransaction,
                        messageType: 'canton-prepared-transaction',
                        origin: 'https://dapp.example',
                        status: 'pending',
                    },
                }
            }
            if (method === 'signMessage') {
                return signedResult
            }
            return undefined
        })

        el = await fixture<UserUiSignMessage>(componentFixture)
        await waitUntil(() => !el.isLoading && el.parsed !== null)

        expect(detailText(el)).toContain('You sign as an owner')
        expect(detailText(el)).toContain('Transaction JSON Object')
        expect(detailText(el)).toContain('HashVectors')

        approveButton(el)?.click()

        await waitUntil(() =>
            mockRequest.mock.calls.some((c) => c[0]?.method === 'signMessage')
        )
        await waitUntil(
            () => setLocationHref.mock.calls.length > 0,
            'navigation after sign',
            { timeout: 3000 }
        )
        expect(mockRequest).toHaveBeenCalledWith({
            method: 'signMessage',
            params: { messageId: 'msg-prepared' },
        })
    })

    it('renders topology transactions to sign', async () => {
        history.replaceState({}, '', '?messageId=msg-topology')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getMessageToSign') {
                return {
                    message: {
                        message: [topologyTransaction],
                        messageType: 'canton-topology-transactions',
                        status: 'pending',
                    },
                }
            }
            return undefined
        })

        el = await fixture<UserUiSignMessage>(componentFixture)
        await waitUntil(() => !el.isLoading && el.topologySummaries.length > 0)

        expect(el.topologySummaries).toHaveLength(1)
        expect(el.topologySummaries[0]?.kind).toBe('partyToParticipant')
        expect(detailText(el)).toContain('Party to participant')
        expect(detailText(el)).toContain(topologyParty)
        expect(approveButton(el)).not.toBeNull()
    })

    it('shows an error when a typed message does not decode', async () => {
        history.replaceState({}, '', '?messageId=msg-bad')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getMessageToSign') {
                return {
                    message: {
                        message: 'bm90IGEgdHg=',
                        messageType: 'canton-prepared-transaction',
                        status: 'pending',
                    },
                }
            }
            return undefined
        })

        el = await fixture<UserUiSignMessage>(componentFixture)
        await waitUntil(() => el.loadError !== null)

        expect(el.shadowRoot?.textContent).toContain(
            'Message could not be decoded.'
        )
        expect(approveButton(el)).toBeUndefined()
    })

    it('calls signMessage when approve is clicked', async () => {
        history.replaceState({}, '', '?messageId=msg-1')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getMessageToSign') {
                return {
                    message: {
                        message: 'Sign me',
                        status: 'pending',
                    },
                }
            }
            if (method === 'signMessage') {
                return signedResult
            }
            return undefined
        })

        el = await fixture<UserUiSignMessage>(componentFixture)
        await waitUntil(() => !el.isLoading && el.message === 'Sign me')

        approveButton(el)?.click()

        await waitUntil(() =>
            mockRequest.mock.calls.some((c) => c[0]?.method === 'signMessage')
        )
        await waitUntil(
            () => setLocationHref.mock.calls.length > 0,
            'navigation after sign',
            { timeout: 3000 }
        )

        expect(mockRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'signMessage',
                params: { messageId: 'msg-1' },
            })
        )
    })

    it('calls deleteMessageToSign when reject is confirmed', async () => {
        history.replaceState({}, '', '?messageId=msg-1')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getMessageToSign') {
                return {
                    message: {
                        message: 'Sign me',
                        status: 'pending',
                    },
                }
            }
            if (method === 'deleteMessageToSign') {
                return undefined
            }
            return undefined
        })

        el = await fixture<UserUiSignMessage>(componentFixture)
        await waitUntil(() => !el.isLoading && el.message === 'Sign me')

        rejectButton(el)?.click()

        await waitUntil(() =>
            mockRequest.mock.calls.some(
                (c) => c[0]?.method === 'deleteMessageToSign'
            )
        )
        await waitUntil(
            () => setLocationHref.mock.calls.length > 0,
            'navigation after reject',
            { timeout: 3000 }
        )

        expect(mockRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'deleteMessageToSign',
                params: { messageId: 'msg-1' },
            })
        )
    })

    it('shows the extracted RPC error message when signMessage fails', async () => {
        history.replaceState({}, '', '?messageId=msg-1')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getMessageToSign') {
                return {
                    message: { message: 'Sign me', status: 'pending' },
                }
            }
            if (method === 'signMessage') {
                throw makeRpcTransportError('Party not authorized to sign')
            }
            return undefined
        })

        el = await fixture<UserUiSignMessage>(componentFixture)
        await waitUntil(() => !el.isLoading && el.message === 'Sign me')

        approveButton(el)?.click()

        await waitUntil(() => handleErrorToast.mock.calls.length > 0)

        expect(handleErrorToast).toHaveBeenCalledWith(expect.any(Error), {
            message: 'Error signing message',
        })
        expect(setLocationHref).not.toHaveBeenCalled()
        expect(el.isApproving).toBe(false)
    })

    it('shows the failure reason and stays on the page when the signing provider fails the message', async () => {
        history.replaceState({}, '', '?messageId=msg-1')
        let stored: Record<string, string> = {
            message: 'Sign me',
            status: 'pending',
        }
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getMessageToSign') {
                return { message: stored }
            }
            if (method === 'signMessage') {
                stored = {
                    ...stored,
                    status: 'failed',
                    failureReason: 'Signing provider returned status: rejected',
                }
                return {
                    status: 'failed',
                    publicKey: 'public-key',
                    failureReason: 'Signing provider returned status: rejected',
                }
            }
            return undefined
        })

        el = await fixture<UserUiSignMessage>(componentFixture)
        await waitUntil(() => !el.isLoading && el.message === 'Sign me')

        approveButton(el)?.click()

        await waitUntil(() => el.status === 'failed')
        await el.updateComplete

        expect(el.shadowRoot?.querySelector('.alert')?.textContent).toContain(
            'Signing provider returned status: rejected'
        )
        expect(showToast).not.toHaveBeenCalled()
        expect(handleErrorToast).not.toHaveBeenCalled()
        expect(setLocationHref).not.toHaveBeenCalled()
        expect(approveButton(el)).toBeNull()
    })

    it('shows a fallback error message when reject fails without RPC details', async () => {
        history.replaceState({}, '', '?messageId=msg-1')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getMessageToSign') {
                return {
                    message: { message: 'Sign me', status: 'pending' },
                }
            }
            if (method === 'deleteMessageToSign') {
                throw new Error('network failure')
            }
            return undefined
        })

        el = await fixture<UserUiSignMessage>(componentFixture)
        await waitUntil(() => !el.isLoading && el.message === 'Sign me')

        rejectButton(el)?.click()

        await waitUntil(() => handleErrorToast.mock.calls.length > 0)

        expect(handleErrorToast).toHaveBeenCalledWith(expect.any(Error), {
            message: 'Error rejecting message',
        })
        expect(setLocationHref).not.toHaveBeenCalled()
        expect(el.isDeleting).toBe(false)
    })

    it('closes the window after approve when opened from a dApp with closeafteraction', async () => {
        history.replaceState({}, '', '?messageId=msg-1&closeafteraction')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getMessageToSign') {
                return {
                    message: { message: 'Sign me', status: 'pending' },
                }
            }
            if (method === 'signMessage') {
                return signedResult
            }
            return undefined
        })

        el = await fixture<UserUiSignMessage>(componentFixture)
        await waitUntil(() => !el.isLoading && el.message === 'Sign me')

        setLocationHref.mockClear()
        const openerGet = vi
            .spyOn(window, 'opener', 'get')
            .mockReturnValue({} as Window)
        const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})

        approveButton(el)?.click()

        await waitUntil(() =>
            mockRequest.mock.calls.some((c) => c[0]?.method === 'signMessage')
        )
        await waitUntil(
            () => closeSpy.mock.calls.length > 0,
            'close popup after sign',
            { timeout: 3000 }
        )

        openerGet.mockRestore()
        closeSpy.mockRestore()

        expect(setLocationHref).not.toHaveBeenCalled()
    })

    it('redirects to activities after approve when closeafteraction is not set', async () => {
        history.replaceState({}, '', '?messageId=msg-1')
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'getMessageToSign') {
                return {
                    message: { message: 'Sign me', status: 'pending' },
                }
            }
            if (method === 'signMessage') {
                return signedResult
            }
            return undefined
        })

        el = await fixture<UserUiSignMessage>(componentFixture)
        await waitUntil(() => !el.isLoading && el.message === 'Sign me')

        const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})

        approveButton(el)?.click()

        await waitUntil(() =>
            mockRequest.mock.calls.some((c) => c[0]?.method === 'signMessage')
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

    it('shows an error when getMessageToSign fails', async () => {
        history.replaceState({}, '', '?messageId=msg-1')
        mockRequest.mockRejectedValue(new Error('not found'))

        el = await fixture<UserUiSignMessage>(componentFixture)
        await waitUntil(() => !el.isLoading && el.loadError !== null)

        expect(el.shadowRoot?.textContent).toContain('Message not found.')
        expect(callsTo('getSignMessageStatus')).toBe(0)
    })

    describe('polling while awaiting a signature', () => {
        const pollingFixture = html`<user-ui-sign-message></user-ui-sign-message>`

        let stored: Record<string, string>
        let statusResult: Record<string, string>

        beforeEach(() => {
            vi.useFakeTimers()
            history.replaceState({}, '', '?messageId=msg-1')
            stored = { message: 'Sign me', status: 'awaiting-signature' }
            statusResult = { status: 'awaiting-signature' }
            mockRequest.mockImplementation(async ({ method }) => {
                if (method === 'getMessageToSign') {
                    return { message: stored }
                }
                if (method === 'getSignMessageStatus') {
                    stored = { ...stored, ...statusResult }
                    return statusResult
                }
                return undefined
            })
        })

        afterEach(() => {
            el?.remove()
            vi.useRealTimers()
        })

        it('starts polling when signMessage returns awaiting-signature and closes once signed', async () => {
            stored = { message: 'Sign me', status: 'pending' }
            const defaultImpl = mockRequest.getMockImplementation()!
            mockRequest.mockImplementation(async (args) => {
                if (args.method === 'signMessage') {
                    stored = { ...stored, status: 'awaiting-signature' }
                    return {
                        status: 'awaiting-signature',
                        publicKey: 'public-key',
                        externalTxId: 'provider-req-1',
                    }
                }
                return defaultImpl(args)
            })

            el = await fixture<UserUiSignMessage>(pollingFixture)
            await vi.waitFor(() => {
                expect(el.isLoading).toBe(false)
                expect(el.status).toBe('pending')
            })
            expect(callsTo('getSignMessageStatus')).toBe(0)

            approveButton(el)?.click()
            await vi.waitFor(() => expect(el.status).toBe('awaiting-signature'))
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
            await vi.waitFor(() =>
                expect(callsTo('getSignMessageStatus')).toBeGreaterThan(0)
            )

            statusResult = { status: 'signed', signature: 'sig' }
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)
            await vi.waitFor(() => expect(el.status).toBe('signed'))
            await vi.waitFor(
                () =>
                    expect(setLocationHref.mock.calls.length).toBeGreaterThan(
                        0
                    ),
                { timeout: 3000 }
            )

            expect(showToast).toHaveBeenCalledWith(
                '',
                'Message signed successfully',
                'success'
            )
        })

        it('starts polling right away when the message is already awaiting a signature', async () => {
            el = await fixture<UserUiSignMessage>(pollingFixture)
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)

            await vi.waitFor(() =>
                expect(callsTo('getSignMessageStatus')).toBeGreaterThanOrEqual(
                    2
                )
            )

            expect(mockRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'getSignMessageStatus',
                    params: { messageId: 'msg-1' },
                })
            )
            expect(callsTo('getMessageToSign')).toBe(1)
        })

        it('shows the failure reason and stops polling when the provider fails the message', async () => {
            el = await fixture<UserUiSignMessage>(pollingFixture)
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
            await vi.waitFor(() =>
                expect(callsTo('getSignMessageStatus')).toBeGreaterThan(0)
            )

            statusResult = {
                status: 'failed',
                failureReason: 'Signing provider returned status: rejected',
            }
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)
            await vi.waitFor(() => expect(el.status).toBe('failed'))
            await el.updateComplete

            expect(
                el.shadowRoot?.querySelector('.alert')?.textContent
            ).toContain('Signing provider returned status: rejected')
            const pollsAfterFailure = callsTo('getSignMessageStatus')
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)
            expect(callsTo('getSignMessageStatus')).toBe(pollsAfterFailure)
            expect(setLocationHref).not.toHaveBeenCalled()
        })

        it('pauses polling while the document is hidden and resumes when visible', async () => {
            el = await fixture<UserUiSignMessage>(pollingFixture)
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
            await vi.waitFor(() =>
                expect(callsTo('getSignMessageStatus')).toBeGreaterThan(0)
            )

            const hidden = vi
                .spyOn(document, 'hidden', 'get')
                .mockReturnValue(true)
            document.dispatchEvent(new Event('visibilitychange'))
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)
            const pollsWhileHidden = callsTo('getSignMessageStatus')
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)
            expect(callsTo('getSignMessageStatus')).toBe(pollsWhileHidden)

            hidden.mockReturnValue(false)
            document.dispatchEvent(new Event('visibilitychange'))
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
            await vi.waitFor(() =>
                expect(callsTo('getSignMessageStatus')).toBeGreaterThan(
                    pollsWhileHidden
                )
            )
            hidden.mockRestore()
        })

        it('stops polling when the element is removed', async () => {
            el = await fixture<UserUiSignMessage>(pollingFixture)
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
            await vi.waitFor(() =>
                expect(callsTo('getSignMessageStatus')).toBeGreaterThan(0)
            )

            el.remove()
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)
            const pollsAfterRemoval = callsTo('getSignMessageStatus')
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)

            expect(callsTo('getSignMessageStatus')).toBe(pollsAfterRemoval)
        })

        it('does not schedule another poll when a status request finishes after removal', async () => {
            const defaultImpl = mockRequest.getMockImplementation()!
            let resolveStatus: (value: unknown) => void = () => {}
            mockRequest.mockImplementation(async (args) => {
                if (args.method === 'getSignMessageStatus') {
                    return new Promise((resolve) => {
                        resolveStatus = resolve
                    })
                }
                return defaultImpl(args)
            })

            el = await fixture<UserUiSignMessage>(pollingFixture)
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
            await vi.waitFor(() =>
                expect(callsTo('getSignMessageStatus')).toBe(1)
            )

            el.remove()
            resolveStatus({ status: 'awaiting-signature' })
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)

            expect(callsTo('getSignMessageStatus')).toBe(1)
        })

        it('does not start polling when the initial load finishes after removal', async () => {
            const defaultImpl = mockRequest.getMockImplementation()!
            let resolveMessage: (value: unknown) => void = () => {}
            mockRequest.mockImplementation(async (args) => {
                if (args.method === 'getMessageToSign') {
                    return new Promise((resolve) => {
                        resolveMessage = resolve
                    })
                }
                return defaultImpl(args)
            })

            el = await fixture<UserUiSignMessage>(pollingFixture)
            await vi.waitFor(() => expect(callsTo('getMessageToSign')).toBe(1))

            el.remove()
            resolveMessage({ message: stored })
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)

            expect(callsTo('getSignMessageStatus')).toBe(0)
        })
    })
})

function callsTo(method: string) {
    return mockRequest.mock.calls.filter((c) => c[0]?.method === method).length
}

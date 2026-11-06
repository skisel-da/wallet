// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventListener } from '@canton-network/core-splice-provider'
import type { StatusEvent } from '@canton-network/core-wallet-dapp-rpc-client'
import { JsonRpcError } from '@canton-network/core-rpc-errors'
import { WALLETCONNECT_ICON } from '../assets'
import {
    WalletConnectAdapter,
    type WalletConnectAdapterConfig,
} from './walletconnect-adapter'

const { mockSession, mockSignClient, SignClientInit, sessionEventHandler } =
    vi.hoisted(() => {
        // An approved WalletConnect session holding a canton namespace, the
        // shape restore() looks for among the SignClient's persisted sessions.
        const mockSession = {
            topic: 'session-topic',
            namespaces: {
                canton: {
                    accounts: ['account'],
                },
            },
        }

        let sessionEventHandler:
            | ((event: {
                  params: { event: { name: string; data: unknown } }
              }) => void)
            | undefined

        const mockSignClient = {
            connect: vi.fn().mockResolvedValue({
                uri: 'wc:test-uri',
                approval: vi.fn().mockResolvedValue(mockSession),
            }),
            request: vi.fn(),
            disconnect: vi.fn(),
            on: vi.fn((event: string, handler: (arg: unknown) => void) => {
                if (event === 'session_event') sessionEventHandler = handler
            }),
            session: {
                getAll: vi.fn().mockReturnValue([]),
            },
        }

        return {
            mockSession,
            mockSignClient,
            SignClientInit: vi.fn().mockResolvedValue(mockSignClient),
            sessionEventHandler: () => sessionEventHandler,
        }
    })

vi.mock('@walletconnect/sign-client', () => ({
    default: {
        init: SignClientInit,
    },
}))

beforeEach(() => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
        'request-id' as ReturnType<typeof crypto.randomUUID>
    )
})

const { getActiveWalletPickerWindow } = vi.hoisted(() => ({
    getActiveWalletPickerWindow: vi.fn(),
}))

vi.mock(
    '@canton-network/core-wallet-ui-components',
    async (importOriginal) => ({
        ...(await importOriginal<object>()),
        getActiveWalletPickerWindow,
    })
)

const makeAdapter = (
    overrides: Partial<
        Pick<
            WalletConnectAdapterConfig,
            'onUri' | 'onSignInWithCanton' | 'signInWithCanton'
        >
    > = {}
) =>
    WalletConnectAdapter.create({
        projectId: 'test-project-id',
        ...overrides,
    })

describe('WalletConnectAdapter', () => {
    beforeEach(() => {})

    it('exposes wallet picker metadata', () => {
        const adapter = makeAdapter()

        expect(adapter.providerId).toBe('walletconnect')
        expect(adapter.getInfo()).toEqual({
            providerId: 'walletconnect',
            name: 'WalletConnect',
            type: 'mobile',
            icon: WALLETCONNECT_ICON,
            description: 'Connect via WalletConnect',
            reuseGlobalWalletPopup: true,
        })
    })

    it('returns itself as the provider instance', () => {
        const adapter = makeAdapter()

        expect(adapter.provider()).toBe(adapter)
    })

    it('reports disconnected status before a session exists', async () => {
        const adapter = makeAdapter()

        await expect(adapter.request({ method: 'status' })).resolves.toEqual({
            provider: {
                id: 'walletconnect',
                providerType: 'mobile',
            },
            connection: {
                isConnected: false,
                isNetworkConnected: false,
            },
        })
    })

    it('establishes a session on connect and emits statusChanged', async () => {
        const onUri = vi.fn()
        const statusListener = vi.fn<EventListener<StatusEvent>>()
        const adapter = makeAdapter({ onUri })
        adapter.on('statusChanged', statusListener)

        await expect(adapter.request({ method: 'connect' })).resolves.toEqual({
            isConnected: true,
            isNetworkConnected: true,
        })

        expect(SignClientInit).toHaveBeenCalledWith(
            expect.objectContaining({ projectId: 'test-project-id' })
        )
        expect(onUri).toHaveBeenCalledWith('wc:test-uri')
        expect(statusListener).toHaveBeenCalledWith(
            expect.objectContaining({
                connection: {
                    isConnected: true,
                    isNetworkConnected: true,
                },
            })
        )
    })

    it('disconnects the WalletConnect session and emits a local status update', async () => {
        const adapter = makeAdapter()
        const statusListener = vi.fn<EventListener<StatusEvent>>()

        await adapter.request({ method: 'connect' })
        adapter.on('statusChanged', statusListener)
        statusListener.mockClear()

        await expect(
            adapter.request({ method: 'disconnect' })
        ).resolves.toBeNull()

        expect(mockSignClient.disconnect).toHaveBeenCalledWith({
            topic: 'session-topic',
            reason: { code: 6000, message: 'User disconnected' },
        })
        expect(statusListener).toHaveBeenCalledWith(
            expect.objectContaining({
                connection: expect.objectContaining({
                    isConnected: false,
                    reason: 'User disconnected',
                }),
            })
        )
    })

    it('buffers events until a listener is attached', () => {
        const adapter = makeAdapter()
        const listener = vi.fn<EventListener<StatusEvent>>()

        adapter.emit('statusChanged', {
            provider: { id: 'walletconnect', providerType: 'mobile' },
            connection: { isConnected: true, isNetworkConnected: true },
        })
        expect(listener).not.toHaveBeenCalled()

        adapter.on('statusChanged', listener)
        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({
                connection: { isConnected: true, isNetworkConnected: true },
            })
        )
    })

    it('removes event listeners', () => {
        const adapter = makeAdapter()
        const listener = vi.fn<EventListener<StatusEvent>>()

        adapter.on('statusChanged', listener)
        adapter.removeListener('statusChanged', listener)
        adapter.emit('statusChanged', {
            provider: { id: 'walletconnect', providerType: 'mobile' },
            connection: { isConnected: false, isNetworkConnected: false },
        })

        expect(listener).not.toHaveBeenCalled()
    })

    it('restores an existing Canton WalletConnect session', async () => {
        mockSignClient.session.getAll.mockReturnValueOnce([mockSession])

        const adapter = makeAdapter()
        const restored = await adapter.restore()

        expect(restored).toBe(adapter)
        expect(mockSignClient.on).toHaveBeenCalledWith(
            'session_event',
            expect.any(Function)
        )
    })

    it('forwards session events to local listeners', async () => {
        mockSignClient.session.getAll.mockReturnValueOnce([mockSession])
        const adapter = makeAdapter()
        const listener = vi.fn()

        await adapter.restore()
        adapter.on('accountsChanged', listener)

        sessionEventHandler()?.({
            params: {
                event: {
                    name: 'accountsChanged',
                    data: [{ partyId: 'party::alice' }],
                },
            },
        })

        expect(listener).toHaveBeenCalledWith([{ partyId: 'party::alice' }])
    })

    it('maps prepareExecute to canton_prepareSignExecute and emits txChanged', async () => {
        const adapter = makeAdapter()
        const txListener = vi.fn()

        await adapter.request({ method: 'connect' })
        adapter.on('txChanged', txListener)

        mockSignClient.request.mockResolvedValueOnce({
            commandId: 'cmd-1',
            status: 'executed',
            payload: { updateId: '1', completionOffset: 1 },
        })

        await expect(
            adapter.request({
                method: 'prepareExecute',
                params: { commands: [] },
            })
        ).resolves.toEqual({
            tx: {
                commandId: 'cmd-1',
                status: 'executed',
                payload: { updateId: '1', completionOffset: 1 },
            },
        })

        expect(mockSignClient.request).toHaveBeenCalledWith({
            topic: 'session-topic',
            chainId: 'canton:devnet',
            request: {
                method: 'canton_prepareSignExecute',
                // A commandId is always sent, so a later txChanged can be matched.
                params: { commands: [], commandId: 'request-id' },
            },
        })
        expect(txListener).toHaveBeenCalledWith({
            commandId: 'cmd-1',
            status: 'executed',
            payload: { updateId: '1', completionOffset: 1 },
        })
    })

    it('rejects WalletConnect RPC failures with the wallet error code', async () => {
        const adapter = makeAdapter()

        await adapter.request({ method: 'connect' })

        mockSignClient.request.mockImplementationOnce(() =>
            Promise.reject({ code: 4001, message: 'User rejected' })
        )

        const pending = adapter.request({ method: 'listAccounts' })
        await expect(pending).rejects.toBeInstanceOf(JsonRpcError)
        await expect(pending).rejects.toMatchObject({
            code: 4001,
            message: 'User rejected',
        })
    })

    it('only posts WalletConnect URI to dApp origin, not wildcard', async () => {
        const mockPostMessage = vi.fn()
        const mockPopupWindow = {
            postMessage: mockPostMessage,
            closed: false,
        }

        // The picker window comes from the UI components: popup names are
        // unique per page, so it can't be found with window.open('', name).
        getActiveWalletPickerWindow.mockReturnValue(mockPopupWindow)

        const adapter = makeAdapter()
        await adapter.request({ method: 'connect' })

        expect(getActiveWalletPickerWindow).toHaveBeenCalled()
        expect(mockPostMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'wc-uri',
                uri: 'wc:test-uri',
            }),
            window.location.origin
        )
        expect(mockPostMessage).not.toHaveBeenCalledWith(
            expect.any(Object),
            '*'
        )
    })

    it('prepareExecute returns a pending answer without waiting', async () => {
        const adapter = makeAdapter()
        await adapter.request({ method: 'connect' })
        mockSignClient.request.mockResolvedValueOnce({
            commandId: 'cmd-2',
            status: 'pending',
        })

        await expect(
            adapter.request({
                method: 'prepareExecute',
                params: { commands: [], commandId: 'cmd-2' },
            })
        ).resolves.toEqual({ tx: { commandId: 'cmd-2', status: 'pending' } })
    })

    it('prepareExecuteAndWait waits past pending for the executed txChanged event', async () => {
        const adapter = makeAdapter()
        await adapter.request({ method: 'connect' })
        mockSignClient.request.mockResolvedValueOnce({
            commandId: 'cmd-3',
            status: 'pending',
        })

        let settled = false
        const result = adapter
            .request({
                method: 'prepareExecuteAndWait',
                params: { commands: [], commandId: 'cmd-3' },
            })
            .finally(() => {
                settled = true
            })
        await new Promise((r) => setTimeout(r, 0))
        expect(settled).toBe(false)

        const executed = {
            commandId: 'cmd-3',
            status: 'executed',
            payload: { updateId: 'u', completionOffset: 7 },
        }
        sessionEventHandler()!({
            params: { event: { name: 'txChanged', data: executed } },
        })

        await expect(result).resolves.toEqual({ tx: executed })
    })

    it('prepareExecuteAndWait rejects on a failed txChanged event', async () => {
        const adapter = makeAdapter()
        await adapter.request({ method: 'connect' })
        mockSignClient.request.mockResolvedValueOnce({
            commandId: 'cmd-4',
            status: 'pending',
        })

        const result = adapter.request({
            method: 'prepareExecuteAndWait',
            params: { commands: [], commandId: 'cmd-4' },
        })
        await new Promise((r) => setTimeout(r, 0))
        sessionEventHandler()!({
            params: {
                event: {
                    name: 'txChanged',
                    data: { commandId: 'cmd-4', status: 'failed' },
                },
            },
        })

        await expect(result).rejects.toThrow('cmd-4 failed to execute')
    })

    it('requests the txChanged event', async () => {
        const adapter = makeAdapter()
        await adapter.request({ method: 'connect' })

        expect(mockSignClient.connect).toHaveBeenCalledWith({
            requiredNamespaces: {
                canton: expect.objectContaining({
                    events: expect.arrayContaining(['txChanged']),
                }),
            },
        })
    })
})

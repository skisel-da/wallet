// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixture, waitUntil } from '@open-wc/testing-helpers'
import { html } from 'lit'
import {
    createMockUserClient,
    makeWallet,
    mockRequest,
} from '../../test-helpers.js'

const { mockCreateUserClient, handleErrorToast, showToast, setLocationHref } =
    vi.hoisted(() => ({
        mockCreateUserClient: vi.fn(),
        handleErrorToast: vi.fn(),
        showToast: vi.fn(),
        setLocationHref: vi.fn(),
    }))

vi.mock('../../index.js', () => ({}))
vi.mock('../../navigation.js', () => ({ setLocationHref }))
vi.mock('../../utils.js', () => ({ showToast }))
vi.mock('../../rpc-client.js', () => ({
    createUserClient: mockCreateUserClient,
}))
vi.mock('../../state-manager.js', () => ({
    stateManager: {
        accessToken: { get: () => 'test-token' },
        networkId: { get: vi.fn() },
        currentOrigin: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
    },
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
import { UserUiImportParty } from './index.js'

describe('UserUiImportParty', () => {
    let el: UserUiImportParty
    const componentFixture = html`<user-ui-import-party></user-ui-import-party>`

    beforeEach(async () => {
        mockCreateUserClient.mockReset()
        mockRequest.mockReset()
        handleErrorToast.mockReset()
        showToast.mockReset()
        setLocationHref.mockReset()
        mockCreateUserClient.mockResolvedValue(createMockUserClient())
        el = await fixture<UserUiImportParty>(componentFixture)
    })

    afterEach(() => {
        document.body.innerHTML = ''
        vi.clearAllMocks()
    })

    function fillPartyId(value: string) {
        const input =
            el.shadowRoot?.querySelector<HTMLInputElement>('#party-id')
        input!.value = value
    }

    function fillDelegatedSigningUrl(value: string) {
        const input = el.shadowRoot?.querySelector<HTMLInputElement>(
            '#delegated-signing-url'
        )
        input!.value = value
    }

    function submitForm() {
        const form = el.shadowRoot?.querySelector('form')
        form!.dispatchEvent(new Event('submit', { cancelable: true }))
    }

    it('renders the import header and form', () => {
        expect(el.shadowRoot?.querySelector('h1')?.textContent).toBe(
            'Import an existing party'
        )
        expect(el.shadowRoot?.querySelector('#party-id')).not.toBeNull()
    })

    it('navigates back to parties list when Back is clicked', () => {
        const backBtn = el.shadowRoot?.querySelector(
            '.page-header button'
        ) as HTMLButtonElement
        backBtn.click()

        expect(setLocationHref).toHaveBeenCalledWith(
            expect.stringContaining('/parties')
        )
    })

    it('imports the party and redirects to the parties list on success', async () => {
        mockRequest.mockImplementation(async ({ method, params }) => {
            if (method === 'importParty') {
                expect(params).toEqual({ partyId: 'alice::12200a1b2c' })
                return { wallet: makeWallet({ partyId: 'alice::12200a1b2c' }) }
            }
            return undefined
        })

        fillPartyId('alice::12200a1b2c')
        submitForm()

        await waitUntil(() => setLocationHref.mock.calls.length > 0)

        expect(showToast).toHaveBeenCalledWith(
            'Party imported',
            'The party has been imported into this wallet.',
            'success'
        )
        expect(setLocationHref).toHaveBeenCalledWith(
            expect.stringContaining('/parties/')
        )
    })

    it('submits delegatedSigningUrl when filled in, and shows the delegated-signing toast', async () => {
        mockRequest.mockImplementation(async ({ method, params }) => {
            if (method === 'importParty') {
                expect(params).toEqual({
                    partyId: 'decentralized::abc123',
                    delegatedSigningUrl: 'https://safe.example',
                })
                return {
                    wallet: makeWallet({
                        partyId: 'decentralized::abc123',
                        disabled: true,
                        delegatedSigningUrl: 'https://safe.example',
                    }),
                }
            }
            return undefined
        })

        fillPartyId('decentralized::abc123')
        fillDelegatedSigningUrl('https://safe.example')
        submitForm()

        await waitUntil(() => showToast.mock.calls.length > 0)

        expect(showToast).toHaveBeenCalledWith(
            'Party imported with delegated signing',
            'Signing for this party is delegated to its coordinator -- transactions will be parked there until every owner has signed.',
            'success'
        )
    })

    it('omits delegatedSigningUrl from the request when left blank', async () => {
        mockRequest.mockImplementation(async ({ method, params }) => {
            if (method === 'importParty') {
                expect(params).toEqual({ partyId: 'alice::12200a1b2c' })
                return { wallet: makeWallet({ partyId: 'alice::12200a1b2c' }) }
            }
            return undefined
        })

        fillPartyId('alice::12200a1b2c')
        submitForm()

        await waitUntil(() => setLocationHref.mock.calls.length > 0)
    })

    it('shows an info toast when the imported wallet has no matching signing provider', async () => {
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'importParty') {
                return {
                    wallet: makeWallet({ disabled: true }),
                }
            }
            return undefined
        })

        fillPartyId('decentralized::abc123')
        submitForm()

        await waitUntil(() => showToast.mock.calls.length > 0)

        expect(showToast).toHaveBeenCalledWith(
            'Party imported',
            "The party was imported, but no signing provider matches its namespace -- it's shown but disabled.",
            'info'
        )
    })

    it('calls handleErrorToast and clears loading when importParty fails', async () => {
        mockRequest.mockImplementation(async ({ method }) => {
            if (method === 'importParty') {
                throw new Error('Party not found on this participant')
            }
            return undefined
        })

        fillPartyId('missing::party')
        submitForm()

        await waitUntil(() => handleErrorToast.mock.calls.length > 0)

        expect(handleErrorToast).toHaveBeenCalled()
        expect(el.submitting).toBe(false)
    })

    it('does not submit when the party id field is empty', () => {
        fillPartyId('')
        submitForm()

        expect(mockRequest).not.toHaveBeenCalled()
    })
})

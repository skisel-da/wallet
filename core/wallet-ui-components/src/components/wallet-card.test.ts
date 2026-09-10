// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { fixture } from '@open-wc/testing-helpers'
import { html } from 'lit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WALLET_DISABLED_REASON } from '@canton-network/core-types'
import './copy-button.js'
import './wallet-card.js'
import { WalletAllocateEvent, WalletSetPrimaryEvent } from './wallet-card.js'
import { makeWallet, PartyLevelRight } from './fixtures.js'

describe('wg-wallet-card', () => {
    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('sets the party-id host element attribute', async () => {
        const wallet = makeWallet({ partyId: 'party::abc' })
        const el = await fixture(
            html`<wg-wallet-card .wallet=${wallet}></wg-wallet-card>`
        )

        expect(el.getAttribute('party-id')).toBe('party::abc')
    })

    it('truncates long party IDs in the display value', async () => {
        const longPartyId = 'a'.repeat(30)
        const el = await fixture(
            html`<wg-wallet-card
                .wallet=${makeWallet({ partyId: longPartyId })}
                .verified=${true}
            ></wg-wallet-card>`
        )

        const partyValue =
            el.shadowRoot!.querySelector<HTMLElement>('.party-id-value')!
        expect(partyValue.textContent?.trim()).toBe(
            `${longPartyId.slice(0, 10)}...${longPartyId.slice(-10)}`
        )
        expect(partyValue.title).toBe(longPartyId)
    })

    it('emits WalletSetPrimaryEvent for verified non-primary wallets', async () => {
        const wallet = makeWallet({ primary: false, disabled: false })
        const el = await fixture(
            html`<wg-wallet-card
                .wallet=${wallet}
                .verified=${true}
            ></wg-wallet-card>`
        )

        const listener = vi.fn()
        el.addEventListener('wallet-set-primary', listener)

        el.shadowRoot!.querySelector<HTMLButtonElement>('.link-action')!.click()

        expect(listener).toHaveBeenCalledOnce()
        expect(listener.mock.calls[0][0]).toBeInstanceOf(WalletSetPrimaryEvent)
        expect(
            (listener.mock.calls[0][0] as WalletSetPrimaryEvent).wallet
        ).toBe(wallet)
    })

    it('emits WalletAllocateEvent when the wallet is not verified', async () => {
        const wallet = makeWallet()
        const el = await fixture(
            html`<wg-wallet-card
                .wallet=${wallet}
                .verified=${false}
            ></wg-wallet-card>`
        )

        const listener = vi.fn()
        el.addEventListener('wallet-allocate', listener)

        el.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click()

        expect(listener).toHaveBeenCalledOnce()
        expect(listener.mock.calls[0][0]).toBeInstanceOf(WalletAllocateEvent)
    })

    it('renders rights badges when present', async () => {
        const wallet = makeWallet({
            rights: [PartyLevelRight.CanActAs, PartyLevelRight.CanReadAs],
            primary: true,
        })
        const el = await fixture(
            html`<wg-wallet-card
                .wallet=${wallet}
                .verified=${true}
            ></wg-wallet-card>`
        )

        expect(el.shadowRoot?.textContent).toContain('CanActAs')
        expect(el.shadowRoot?.textContent).toContain('CanReadAs')
    })

    it('renders a delegated-signing badge when delegatedSigningUrl is set', async () => {
        const wallet = makeWallet({
            delegatedSigningUrl: 'https://coordinator.example',
        })
        const el = await fixture(
            html`<wg-wallet-card .wallet=${wallet}></wg-wallet-card>`
        )

        expect(
            el
                .shadowRoot!.querySelector('.badge-delegated')
                ?.textContent?.trim()
        ).toBe('Delegated signing')
    })

    it('does not render a delegated-signing badge for an ordinary wallet', async () => {
        const wallet = makeWallet()
        const el = await fixture(
            html`<wg-wallet-card .wallet=${wallet}></wg-wallet-card>`
        )

        expect(el.shadowRoot!.querySelector('.badge-delegated')).toBeNull()
    })

    it('does not offer to set an ordinary disabled wallet as primary', async () => {
        const wallet = makeWallet({ disabled: true, primary: false })
        const el = await fixture(
            html`<wg-wallet-card
                .wallet=${wallet}
                .verified=${true}
            ></wg-wallet-card>`
        )

        const labels = [...el.shadowRoot!.querySelectorAll('.link-action')].map(
            (b) => b.textContent?.trim()
        )
        expect(labels).not.toContain('Set as primary')
    })

    it('offers to delegate signing when no provider here matches the party', async () => {
        const wallet = makeWallet({
            primary: false,
            disabled: true,
            reason: WALLET_DISABLED_REASON.NO_SIGNING_PROVIDER_MATCHED,
        })
        const el = await fixture(
            html`<wg-wallet-card
                .wallet=${wallet}
                .verified=${true}
            ></wg-wallet-card>`
        )

        const listener = vi.fn()
        el.addEventListener('wallet-edit-delegated-signing', listener)

        const button = [
            ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(
                '.link-action'
            ),
        ].find((b) => b.textContent?.trim() === 'Delegate signing')
        expect(button).toBeDefined()
        button!.click()

        expect(listener).toHaveBeenCalledOnce()
    })

    it('does not offer to delegate a wallet this gateway can sign for', async () => {
        // Delegating a working wallet strands the key that actually signs
        // for it, and the pin survives wallet sync -- so the action must not
        // be reachable at all here.
        const wallet = makeWallet({ primary: false })
        const el = await fixture(
            html`<wg-wallet-card
                .wallet=${wallet}
                .verified=${true}
            ></wg-wallet-card>`
        )

        const labels = [...el.shadowRoot!.querySelectorAll('.link-action')].map(
            (b) => b.textContent?.trim()
        )
        expect(labels).not.toContain('Delegate signing')
        expect(labels).toContain('Set as primary')
    })

    it('does not offer to delegate a wallet disabled for an unrelated reason', async () => {
        const wallet = makeWallet({
            primary: false,
            disabled: true,
            reason: WALLET_DISABLED_REASON.PARTICIPANT_NAMESPACE_CHANGED,
        })
        const el = await fixture(
            html`<wg-wallet-card
                .wallet=${wallet}
                .verified=${true}
            ></wg-wallet-card>`
        )

        const labels = [...el.shadowRoot!.querySelectorAll('.link-action')].map(
            (b) => b.textContent?.trim()
        )
        expect(labels).not.toContain('Delegate signing')
    })

    it('offers to edit an existing delegation rather than create one', async () => {
        const wallet = makeWallet({
            primary: true,
            delegatedSigningUrl: 'https://coordinator.example',
        })
        const el = await fixture(
            html`<wg-wallet-card
                .wallet=${wallet}
                .verified=${true}
            ></wg-wallet-card>`
        )

        const labels = [...el.shadowRoot!.querySelectorAll('.link-action')].map(
            (b) => b.textContent?.trim()
        )
        expect(labels).toContain('Edit delegated signing')
    })
})

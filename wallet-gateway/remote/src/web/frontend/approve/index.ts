// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import {
    BaseElement,
    handleErrorToast,
    toRelHref,
} from '@canton-network/core-wallet-ui-components'
import {
    hashPreparedTransaction,
    ParsedTransactionInfo,
    parsePreparedTransaction,
} from '@canton-network/core-tx-visualizer'
import { createUserClient } from '../rpc-client'
import { setLocationHref } from '../navigation.js'
import { stateManager } from '../state-manager'
import '../index'
import { ACTIVITIES_PAGE_REDIRECT } from '../constants'
import { showToast } from '../utils'
import { SignResult } from '@canton-network/core-wallet-user-rpc-client'
import { PartyLevelRight } from '@canton-network/core-wallet-store'
import { detectCurrentOrigin } from '../listeners.js'

@customElement('user-ui-approve')
export class ApproveUi extends BaseElement {
    @state() accessor isApproving = false
    @state() accessor isDeleting = false
    @state() accessor disabled = false
    @state() accessor transactionId = ''
    @state() accessor commandId = ''
    @state() accessor partyId = ''
    @state() accessor txHash = ''
    @state() accessor tx = ''
    @state() accessor txParsed: ParsedTransactionInfo | null = null
    @state() accessor status = ''
    @state() accessor createdAt: string | null = null
    @state() accessor signedAt: string | null = null
    @state() accessor origin: string | null = null
    @state() accessor canSubmit = true
    @state() accessor walletCapabilityMessage: string | null = null
    // Set when the acting party delegates its signing: the coordinator page
    // the user is sent on to instead of approving here.
    @state() accessor coordinationUrl: string | null = null

    connectedCallback(): void {
        super.connectedCallback()
        const url = new URL(window.location.href)
        this.transactionId = url.searchParams.get('transactionId') || ''
        // dapp-api's prepareExecute puts it in the fragment for a party whose
        // signing is delegated -- there is no Transaction row to fetch then.
        const delegate = new URLSearchParams(url.hash.slice(1)).get('delegate')
        void (delegate
            ? this.updateDelegatedState(delegate)
            : this.updateState())
    }

    private closeOrGoToList() {
        // Disable action buttons while leaving the page
        this.disabled = true
        const params = new URLSearchParams(window.location.search)
        // if approve view was triggered via dApp, close it after action
        // otherwise go back to activity list
        const shouldClose = params.has('closeafteraction')
        setTimeout(() => {
            if (shouldClose && window.opener) {
                window.close()
            } else {
                setLocationHref(toRelHref(ACTIVITIES_PAGE_REDIRECT))
            }
        }, 2000)
    }

    private async updateState() {
        const currentOrigin = await detectCurrentOrigin()
        const userClient = await createUserClient(
            await stateManager.accessToken.get(currentOrigin)
        )

        const result = await userClient.request({
            method: 'getTransaction',
            params: { transactionId: this.transactionId },
        })
        this.transactionId = result.id
        this.commandId = result.commandId
        this.txHash = result.preparedTransactionHash
        this.tx = result.preparedTransaction
        this.status = result.status
        this.createdAt = result.createdAt || null
        this.signedAt = result.signedAt || null
        this.origin = result.origin || null

        try {
            this.txParsed = parsePreparedTransaction(this.tx)
        } catch (error) {
            console.error('Error parsing prepared transaction:', error)
            this.txParsed = null
        }

        const wallets = await userClient.request({
            method: 'listWallets',
            params: {},
        })
        const primaryWallet = wallets.find((w) => w.primary === true)
        this.partyId = primaryWallet?.partyId || ''
        const rights = primaryWallet?.rights
        const submitCapable = !!(
            rights?.includes(PartyLevelRight.CanActAs) ||
            rights?.includes(PartyLevelRight.CanExecuteAs)
        )
        this.canSubmit = submitCapable
        this.walletCapabilityMessage = submitCapable
            ? null
            : 'The selected wallet is read-only for submission (no CanActAs/CanExecuteAs right).'
    }

    /**
     * A party whose signing is delegated (signingProviderId 'decentralized')
     * is not approved here: its owners sign in the coordinator. The dApp got
     * this same approve page, as for any other party, so the routing happens
     * here rather than in the dApp API.
     *
     * The link is only offered if the party really is a delegated wallet in
     * this account and the URL really is its own coordinator -- the fragment
     * is input, the wallet's configuration is not.
     */
    private async updateDelegatedState(coordinationUrl: string) {
        const currentOrigin = await detectCurrentOrigin()
        const userClient = await createUserClient(
            await stateManager.accessToken.get(currentOrigin)
        )
        const wallets = await userClient.request({
            method: 'listWallets',
            params: {},
        })

        let coordination: URL
        try {
            coordination = new URL(coordinationUrl)
        } catch {
            this.walletCapabilityMessage = 'Malformed coordination link.'
            return
        }
        const partyId = coordination.searchParams.get('partyId') || ''
        const wallet = wallets.find((w) => w.partyId === partyId)
        const base = wallet?.delegatedSigningUrl?.replace(/\/+$/, '')
        const expected = base ? new URL(`${base}/coordinate`) : null
        if (
            wallet?.signingProviderId !== 'decentralized' ||
            !expected ||
            coordination.origin !== expected.origin ||
            coordination.pathname !== expected.pathname
        ) {
            this.walletCapabilityMessage = `Party ${partyId} does not delegate its signing to ${coordination.origin}.`
            return
        }

        this.partyId = partyId
        this.commandId = coordination.searchParams.get('commandId') || ''
        this.tx = coordination.searchParams.get('preparedTransaction') || ''
        this.status = 'pending'
        this.coordinationUrl = coordination.toString()
        try {
            this.txParsed = parsePreparedTransaction(this.tx)
            // Derived from the bytes shown, the same derivation every owner's
            // wallet signs -- there is no stored Canton hash to show here.
            this.txHash = await hashPreparedTransaction(this.tx)
        } catch (error) {
            console.error('Error parsing prepared transaction:', error)
            this.txParsed = null
        }
    }

    private continueToCoordinator() {
        // A tab of its own, not this popup: the coordinator is another
        // application, where the party's other owners take part and the user
        // may stay a while. Opened from this click, so it is not blocked.
        // noopener: it has no business scripting this wallet page.
        window.open(this.coordinationUrl!, '_blank', 'noopener')
        this.closeOrGoToList()
    }

    private async handleReject() {
        if (this.coordinationUrl) {
            // Nothing was recorded for a delegated party, so nothing to delete.
            this.closeOrGoToList()
            return
        }
        if (!confirm(`Reject pending activity "${this.commandId}"?`)) {
            return
        }

        this.isDeleting = true

        try {
            const currentOrigin = await detectCurrentOrigin()
            const userClient = await createUserClient(
                await stateManager.accessToken.get(currentOrigin)
            )
            await userClient.request({
                method: 'deleteTransaction',
                params: { transactionId: this.transactionId },
            })

            showToast('', 'Activity rejected successfully', 'success')
            this.closeOrGoToList()
        } catch (err) {
            console.error(err)
            handleErrorToast(err, { message: 'Error rejecting activity' })
        } finally {
            this.isDeleting = false
        }
    }

    private async handleApprove() {
        if (this.coordinationUrl) {
            this.continueToCoordinator()
            return
        }
        if (!this.canSubmit) {
            showToast(
                'Read-only wallet',
                'This wallet can read but cannot submit transactions. Switch to a wallet with CanActAs or CanExecuteAs.',
                'error'
            )
            return
        }
        this.isApproving = true

        try {
            const currentOrigin = await detectCurrentOrigin()
            const userClient = await createUserClient(
                await stateManager.accessToken.get(currentOrigin)
            )
            const result: SignResult = await userClient.request({
                method: 'sign',
                params: {
                    transactionId: this.transactionId,
                    partyId: this.partyId,
                },
            })

            if (result.status === 'pending') {
                showToast(
                    'Activity pending',
                    'Complete signing in your external provider, then click Approve to finish.',
                    'info'
                )
                await this.updateState()
                return
            }

            if (result.status === 'signed') {
                await userClient.request({
                    method: 'execute',
                    params: {
                        signature: result.signature,
                        signedBy: result.signedBy,
                        transactionId: this.transactionId,
                        partyId: this.partyId,
                    },
                })

                showToast('', 'Activity executed successfully', 'success')
                this.closeOrGoToList()
                return
            }

            const message =
                result.status === 'rejected'
                    ? 'Activity was rejected'
                    : 'Activity failed'
            showToast('', message, 'error')
            await this.updateState()
        } catch (err) {
            console.error(err)
            handleErrorToast(err, { message: 'Error executing activity' })
        } finally {
            this.isApproving = false
        }
    }

    protected render() {
        return html`
            ${
                this.walletCapabilityMessage
                    ? html`<div class="alert alert-warning" role="alert">
                          ${this.walletCapabilityMessage}
                      </div>`
                    : ''
            }
            <wg-transaction-detail
                .commandId=${this.commandId}
                .status=${this.status}
                .txHash=${this.txHash}
                .tx=${this.tx}
                .parsed=${this.txParsed}
                .createdAt=${this.createdAt}
                .signedAt=${this.signedAt}
                .origin=${this.origin}
                .backHref=${toRelHref(ACTIVITIES_PAGE_REDIRECT)}
                .isApproving=${this.isApproving}
                .isDeleting=${this.isDeleting}
                .disabled=${this.disabled}
                .approveLabel=${
                    this.coordinationUrl
                        ? 'Continue in Party Manager'
                        : 'Approve'
                }
                @transaction-approve=${this.handleApprove}
                @transaction-delete=${this.handleReject}
            ></wg-transaction-detail>
        `
    }
}

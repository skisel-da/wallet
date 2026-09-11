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
import { showToast } from '../utils.js'
import '../index'
import { ACTIVITIES_PAGE_REDIRECT } from '../constants'
import { detectCurrentOrigin } from '../listeners.js'

// One owner's signature towards a Gnosis-Safe-like decentralized party's
// threshold (see decentralizer-poc's docs/safe-execution-plan.md) --
// deliberately reuses the same wg-transaction-detail component the ordinary
// `approve` page already uses for clear-signing a ledger transaction, since
// the display need is identical: decode/show a prepared transaction before
// the caller's own key signs it. The only difference is which RPC methods
// this page calls (signPreparedTransaction/deletePreparedTransactionToSign
// against a standalone pending request, not sign/execute against a
// wallet-gateway Transaction record acting as the decentralized party
// itself -- see the redirect in dapp-api's prepareExecute for why those
// can't be the same thing here).
@customElement('user-ui-sign-prepared-transaction')
export class UserUiSignPreparedTransaction extends BaseElement {
    @state() accessor requestId = ''
    @state() accessor status = ''
    @state() accessor preparedTransaction = ''
    @state() accessor preparedTransactionHash = ''
    @state() accessor txParsed: ParsedTransactionInfo | null = null
    @state() accessor createdAt: string | null = null
    @state() accessor signedAt: string | null = null
    @state() accessor origin: string | null = null
    @state() accessor isApproving = false
    @state() accessor isDeleting = false
    @state() accessor disabled = false
    @state() accessor loadError: string | null = null
    @state() accessor isLoading = true

    connectedCallback(): void {
        super.connectedCallback()
        const url = new URL(window.location.href)
        this.requestId = url.searchParams.get('requestId') || ''
        void this.updateState()
    }

    private closeOrGoToActivities() {
        this.disabled = true
        const params = new URLSearchParams(window.location.search)
        const shouldClose = params.has('closeafteraction')
        setTimeout(() => {
            if (shouldClose && window.opener) {
                window.close()
            } else {
                setLocationHref(toRelHref(ACTIVITIES_PAGE_REDIRECT))
            }
        }, 500)
    }

    private async updateState() {
        this.isLoading = true
        this.loadError = null
        try {
            if (!this.requestId) {
                this.loadError =
                    'Prepared-transaction signing request not found.'
                return
            }
            const currentOrigin = await detectCurrentOrigin()
            const userClient = await createUserClient(
                await stateManager.accessToken.get(currentOrigin)
            )
            const result = await userClient.request({
                method: 'getPreparedTransactionToSign',
                params: { requestId: this.requestId },
            })
            this.status = result.record.status
            this.preparedTransaction = result.record.preparedTransaction
            this.createdAt = result.record.createdAt ?? null
            this.signedAt = result.record.signedAt ?? null
            this.origin = result.record.origin ?? null

            try {
                this.txParsed = parsePreparedTransaction(
                    this.preparedTransaction
                )
                // Derived from the same bytes shown above, and the same
                // derivation the gateway signs -- not a string echoed back
                // from whoever created the request.
                this.preparedTransactionHash = await hashPreparedTransaction(
                    this.preparedTransaction
                )
            } catch (error) {
                console.error('Error parsing prepared transaction:', error)
                this.txParsed = null
            }
        } catch (err) {
            console.error(err)
            // Most common case: requestId doesn't exist anymore / was deleted
            this.loadError = 'Prepared-transaction signing request not found.'
        } finally {
            this.isLoading = false
        }
    }

    private async handleReject() {
        this.isDeleting = true
        try {
            const currentOrigin = await detectCurrentOrigin()
            const userClient = await createUserClient(
                await stateManager.accessToken.get(currentOrigin)
            )
            await userClient.request({
                method: 'deletePreparedTransactionToSign',
                params: { requestId: this.requestId },
            })
            showToast('', 'Signing request rejected', 'success')
            this.closeOrGoToActivities()
        } catch (err) {
            console.error(err)
            handleErrorToast(err, {
                message: 'Error rejecting signing request',
            })
        } finally {
            this.isDeleting = false
        }
    }

    private async handleApprove() {
        this.isApproving = true
        try {
            const currentOrigin = await detectCurrentOrigin()
            const userClient = await createUserClient(
                await stateManager.accessToken.get(currentOrigin)
            )
            await userClient.request({
                method: 'signPreparedTransaction',
                params: { requestId: this.requestId },
            })
            showToast('', 'Prepared transaction signed', 'success')
            this.closeOrGoToActivities()
        } catch (err) {
            console.error(err)
            handleErrorToast(err, {
                message: 'Error signing prepared transaction',
            })
        } finally {
            this.isApproving = false
        }
    }

    protected render() {
        if (this.isLoading) {
            return html`
                <div>
                    <h1 class="h5 fw-semibold mb-2 text-body">
                        Sign prepared transaction
                    </h1>
                    <p class="mb-0 text-body-secondary">Loading...</p>
                </div>
            `
        }

        if (this.loadError) {
            return html`
                <div>
                    <h1 class="h5 fw-semibold mb-2 text-body">
                        Sign prepared transaction
                    </h1>
                    <div class="alert alert-warning" role="alert">
                        ${this.loadError}
                    </div>
                    <a
                        class="btn btn-outline-secondary"
                        href=${toRelHref(ACTIVITIES_PAGE_REDIRECT)}
                        >Back to activities</a
                    >
                </div>
            `
        }

        return html`
            <wg-transaction-detail
                .status=${this.status}
                .txHash=${this.preparedTransactionHash}
                .tx=${this.preparedTransaction}
                .parsed=${this.txParsed}
                .createdAt=${this.createdAt}
                .signedAt=${this.signedAt}
                .origin=${this.origin}
                .backHref=${toRelHref(ACTIVITIES_PAGE_REDIRECT)}
                .isApproving=${this.isApproving}
                .isDeleting=${this.isDeleting}
                .disabled=${this.disabled}
                @transaction-approve=${this.handleApprove}
                @transaction-delete=${this.handleReject}
            ></wg-transaction-detail>
        `
    }
}

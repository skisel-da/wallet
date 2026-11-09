// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { css, html, nothing, type TemplateResult } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import {
    BaseElement,
    handleErrorToast,
    toRelHref,
} from '@canton-network/core-wallet-ui-components'
import {
    computeTopologyMultiHash,
    decodeVersionedTopologyTransaction,
    parsePreparedTransaction,
    summarizeTopologyTransaction,
    type ParsedTransactionInfo,
    type TopologyTransactionSummary,
} from '@canton-network/core-tx-visualizer'
import { createUserClient } from '../rpc-client'
import { setLocationHref } from '../navigation.js'
import { stateManager } from '../state-manager'
import '../index'
import { ACTIVITIES_PAGE_REDIRECT } from '../constants'
import { showToast } from '../utils'
import type {
    GetSignMessageStatusResult,
    MessageType,
} from '@canton-network/core-wallet-user-rpc-client'
import { detectCurrentOrigin } from '../listeners.js'

const POLL_INTERVAL_MS = 3000

// One page for every kind of message a dApp can ask the wallet to sign:
// UTF-8 text, or -- with a messageType -- Canton bytes the wallet decodes
// and shows before signing their hash. Nothing is submitted either way.
@customElement('user-ui-sign-message')
export class UserUiSignMessage extends BaseElement {
    @state() accessor messageId = ''
    @state() accessor message = ''
    @state() accessor messageType: MessageType | null = null
    /** The decoded prepared transaction, for `canton-prepared-transaction`. */
    @state() accessor txParsed: ParsedTransactionInfo | null = null
    /** One summary per transaction, for `canton-topology-transactions`. */
    @state() accessor topologySummaries: TopologyTransactionSummary[] = []
    /** The combined hash the signature will be over, recomputed here for display. */
    @state() accessor topologyMultiHash = ''
    @state() accessor createdAt: string | null = null
    @state() accessor origin: string | null = null
    @state() accessor status = ''
    @state() accessor externalTxId: string | null = null
    @state() accessor failureReason: string | null = null
    @state() accessor isApproving = false
    @state() accessor isDeleting = false
    @state() accessor disabled = false
    @state() accessor isSigning = false
    @state() accessor loadError: string | null = null
    @state() accessor isLoading = true
    private pollTimer: ReturnType<typeof setTimeout> | null = null
    private pollDelay = POLL_INTERVAL_MS
    private polling = false

    static styles = [
        BaseElement.styles,
        css`
            .tx-summary {
                border: 1px solid var(--wg-border);
                border-radius: var(--wg-radius-lg);
                padding: var(--wg-space-3);
                margin-bottom: var(--wg-space-3);
                text-align: left;
            }
            .tx-summary-title {
                font-weight: var(--wg-font-weight-semibold);
                margin-bottom: var(--wg-space-1);
            }
            .tx-summary-detail {
                font-size: var(--wg-font-size-sm);
                word-break: break-all;
            }
            .tx-summary ul {
                margin: var(--wg-space-1) 0 0 0;
                padding-left: 20px;
            }
            .actions {
                margin-top: var(--wg-space-4);
                display: flex;
                gap: var(--wg-space-3);
            }
        `,
    ]

    connectedCallback(): void {
        super.connectedCallback()
        const url = new URL(window.location.href)
        this.messageId = url.searchParams.get('messageId') || ''
        this.pollDelay = POLL_INTERVAL_MS
        document.addEventListener('visibilitychange', this.onVisibilityChange)
        void this.load()
    }

    disconnectedCallback(): void {
        super.disconnectedCallback()
        this.stopPolling()
        document.removeEventListener(
            'visibilitychange',
            this.onVisibilityChange
        )
    }

    private closeOrGoToList() {
        this.disabled = true
        const params = new URLSearchParams(window.location.search)
        const shouldClose = params.has('closeafteraction')
        setTimeout(() => {
            if (shouldClose && window.opener) {
                window.close()
            } else {
                // TODO consider adding messages list page
                setLocationHref(toRelHref(ACTIVITIES_PAGE_REDIRECT))
            }
        }, 2000)
    }

    // TODO polling logic very similar to tx approve. consider extracting to a common module, or maybe create an issue to also add such polling for parties and than extract what is common for all

    private async load() {
        this.isLoading = true
        this.loadError = null
        try {
            if (!this.messageId) {
                this.loadError = 'Message not found.'
                return
            }
            await this.updateState()
        } finally {
            this.isLoading = false
        }
    }

    private async updateState() {
        try {
            const currentOrigin = await detectCurrentOrigin()
            const userClient = await createUserClient(
                await stateManager.accessToken.get(currentOrigin)
            )
            const result = await userClient.request({
                method: 'getMessageToSign',
                params: { messageId: this.messageId },
            })
            this.messageType = result.message.messageType ?? null
            this.createdAt = result.message.createdAt ?? null
            this.origin = result.message.origin ?? null
            this.status = result.message.status
            this.externalTxId = result.message.externalTxId ?? null
            this.failureReason = result.message.failureReason ?? null
            try {
                await this.decodeMessage(result.message.message)
            } catch (err) {
                console.error(err)
                this.loadError = `This message does not decode as ${this.messageType ?? 'text'} and cannot be signed.`
                return
            }
        } catch (err) {
            console.error(err)
            // Most common case: messageId doesn't exist anymore / was deleted
            this.loadError = 'Message not found.'
        }

        this.syncPolling()
    }

    // Decodes the message for display from the same bytes the gateway will
    // hash at sign time; a message that does not decode is shown as such
    // and cannot be approved.
    private async decodeMessage(message: string | string[]) {
        switch (this.messageType) {
            case 'canton-prepared-transaction': {
                if (typeof message !== 'string') {
                    throw new Error('Expected one prepared transaction')
                }
                this.message = message
                this.txParsed = parsePreparedTransaction(message)
                return
            }
            case 'canton-topology-transactions': {
                if (!Array.isArray(message)) {
                    throw new Error('Expected a set of topology transactions')
                }
                this.topologySummaries = message.map((transaction) =>
                    summarizeTopologyTransaction(
                        decodeVersionedTopologyTransaction(transaction)
                    )
                )
                this.topologyMultiHash = await computeTopologyMultiHash(message)
                return
            }
            default:
                if (typeof message !== 'string') {
                    throw new Error('Expected a text message')
                }
                this.message = message
        }
    }

    private onVisibilityChange = () => {
        if (document.hidden) {
            this.stopPolling()
        } else {
            this.pollDelay = POLL_INTERVAL_MS
            this.syncPolling()
        }
    }

    private syncPolling() {
        if (
            this.isConnected &&
            this.status === 'awaiting-signature' &&
            !document.hidden
        ) {
            this.startPolling()
        } else {
            this.stopPolling()
        }
    }

    private startPolling() {
        if (this.pollTimer) return
        this.pollTimer = setTimeout(() => void this.poll(), this.pollDelay)
    }

    private stopPolling() {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer)
            this.pollTimer = null
        }
    }

    private async poll() {
        this.pollTimer = null
        if (this.polling) return
        this.polling = true

        try {
            const currentOrigin = await detectCurrentOrigin()
            const userClient = await createUserClient(
                await stateManager.accessToken.get(currentOrigin)
            )
            const res: GetSignMessageStatusResult = await userClient.request({
                method: 'getSignMessageStatus',
                params: { messageId: this.messageId },
            })

            if (res.status !== this.status) {
                this.pollDelay = POLL_INTERVAL_MS
                await this.updateState()
                if (res.status === 'signed') {
                    showToast('', 'Message signed successfully', 'success')
                    this.closeOrGoToList()
                }
                return
            }

            this.pollDelay = Math.min(
                this.pollDelay * 1.5,
                POLL_INTERVAL_MS * 5
            )
        } catch (err) {
            console.error(err)
            this.pollDelay = Math.min(this.pollDelay * 2, POLL_INTERVAL_MS * 10)
        } finally {
            this.polling = false
            this.syncPolling()
        }
    }

    private async handleApproveAction() {
        if (this.isSigning || this.isApproving) return

        if (this.status === 'awaiting-signature') {
            showToast(
                'Awaiting external signature',
                'Approve the request with your signing provider. This page will update automatically.',
                'info'
            )
            return
        }

        if (this.status !== 'pending') {
            return
        }

        return this.handleSign()
    }

    private async handleSign() {
        this.isSigning = true

        try {
            const currentOrigin = await detectCurrentOrigin()
            const userClient = await createUserClient(
                await stateManager.accessToken.get(currentOrigin)
            )
            const result = await userClient.request({
                method: 'signMessage',
                params: { messageId: this.messageId },
            })

            if (result.status === 'signed') {
                showToast('', 'Message signed successfully', 'success')
                this.closeOrGoToList()
                return
            }
            await this.updateState()
        } catch (err) {
            console.error(err)
            handleErrorToast(err, { message: 'Error signing message' })
            await this.updateState()
        } finally {
            this.isSigning = false
        }
    }

    private async handleReject() {
        if (!confirm('Reject pending message?')) {
            return
        }

        this.isDeleting = true

        try {
            const currentOrigin = await detectCurrentOrigin()
            const userClient = await createUserClient(
                await stateManager.accessToken.get(currentOrigin)
            )
            await userClient.request({
                method: 'deleteMessageToSign',
                params: { messageId: this.messageId },
            })

            showToast('', 'Message rejected successfully', 'success')
            this.closeOrGoToList()
        } catch (err) {
            console.error(err)
            handleErrorToast(err, { message: 'Error rejecting message' })
        } finally {
            this.isDeleting = false
        }
    }

    protected render() {
        if (this.isLoading) {
            return html` <p class="mb-0 text-body-secondary">Loading...</p> `
        }

        if (this.loadError) {
            return html`
                <div class="alert alert-warning" role="alert">
                    ${this.loadError}
                </div>
            `
        }

        const failure = this.failureReason
            ? html`<div class="alert alert-warning" role="alert">
                  ${this.failureReason}
              </div>`
            : nothing

        switch (this.messageType) {
            case 'canton-prepared-transaction':
                return html`${failure}${this.renderPreparedTransaction()}`
            case 'canton-topology-transactions':
                return html`${failure}${this.renderTopologyTransactions()}`
            default:
                return html`${failure}${this.renderText()}`
        }
    }

    private renderText() {
        return html`
            <wg-message-detail
                .messageId=${this.messageId}
                .message=${this.message}
                .status=${this.status}
                .origin=${this.origin}
                .externalTxId=${this.externalTxId}
                .backHref=${toRelHref(ACTIVITIES_PAGE_REDIRECT)}
                .isApproving=${this.isApproving}
                .isDeleting=${this.isDeleting}
                .isSigning=${this.isSigning}
                .disabled=${this.disabled}
                @message-approve=${this.handleApproveAction}
                @message-delete=${this.handleReject}
            ></wg-message-detail>
        `
    }

    private renderPreparedTransaction() {
        return html`
            <div class="alert alert-info" role="alert">
                You are signing this prepared transaction as one of the owners
                of
                <strong
                    >${this.txParsed?.actAs?.join(', ') ?? 'the acting party'}</strong
                >. Only your signature is produced; the transaction is submitted
                by whoever collects the owners' signatures, not by this wallet.
            </div>
            <wg-transaction-detail
                .status=${this.status}
                .tx=${this.message}
                .parsed=${this.txParsed}
                .createdAt=${this.createdAt}
                .origin=${this.origin}
                .externalTxId=${this.externalTxId}
                .backHref=${toRelHref(ACTIVITIES_PAGE_REDIRECT)}
                .isApproving=${this.isApproving}
                .isDeleting=${this.isDeleting}
                .isSigning=${this.isSigning}
                .disabled=${this.disabled}
                @transaction-approve=${this.handleApproveAction}
                @transaction-delete=${this.handleReject}
            ></wg-transaction-detail>
        `
    }

    private renderTopologyTransactions() {
        return html`
            <h1 class="h5 fw-semibold mb-2 text-body">
                Sign topology transactions
            </h1>
            ${
                this.origin
                    ? html`<p class="mb-2 text-body-secondary">
                          Requested by: <strong>${this.origin}</strong>
                      </p>`
                    : nothing
            }
            <p class="mb-2 text-body-secondary">
                Review the decoded topology transactions below. Signing produces
                one signature over all of them, computed by this wallet from
                their bytes. Nothing is submitted.
            </p>
            ${this.topologySummaries.map((summary, index) =>
                this.renderTopologySummary(summary, index)
            )}
            <p class="mb-2 text-body-secondary small">
                Combined hash: <code>${this.topologyMultiHash}</code>
            </p>
            ${
                this.status === 'pending'
                    ? html`
                          <div class="actions">
                              <button
                                  class="btn btn-outline-danger rounded-pill"
                                  ?disabled=${this.disabled || this.isDeleting}
                                  @click=${this.handleReject}
                              >
                                  Reject
                              </button>
                              <button
                                  class="btn btn-primary rounded-pill"
                                  ?disabled=${this.disabled || this.isSigning}
                                  @click=${this.handleApproveAction}
                              >
                                  ${this.isSigning ? 'Signing…' : 'Approve'}
                              </button>
                          </div>
                      `
                    : nothing
            }
        `
    }

    private renderTopologySummary(
        summary: TopologyTransactionSummary,
        index: number
    ): TemplateResult {
        const title = (label: string) =>
            html`<div class="tx-summary-title">#${index + 1}: ${label}</div>`

        switch (summary.kind) {
            case 'namespaceDelegation':
                return html`
                    <div class="tx-summary">
                        ${title(
                            summary.isRootDelegation
                                ? 'Namespace delegation (root)'
                                : 'Namespace delegation'
                        )}
                        <div class="tx-summary-detail">
                            Namespace: <code>${summary.namespace}</code>
                        </div>
                    </div>
                `
            case 'decentralizedNamespaceDefinition':
                return html`
                    <div class="tx-summary">
                        ${title('Decentralized namespace definition')}
                        <div class="tx-summary-detail">
                            Namespace:
                            <code>${summary.decentralizedNamespace}</code>
                        </div>
                        <div class="tx-summary-detail">
                            Threshold: ${summary.threshold} of
                            ${summary.owners.length} owners
                        </div>
                        <div class="tx-summary-detail">
                            Owners: ${summary.owners.join(', ')}
                        </div>
                    </div>
                `
            case 'partyToParticipant':
                return html`
                    <div class="tx-summary">
                        ${title('Party-to-participant mapping')}
                        <div class="tx-summary-detail">
                            Party: <code>${summary.party}</code>
                        </div>
                        <div class="tx-summary-detail">
                            Threshold: ${summary.threshold}
                        </div>
                        ${
                            summary.partySigningKeys
                                ? html`<div class="tx-summary-detail">
                                      Party signing keys:
                                      ${summary.partySigningKeys.threshold} of
                                      ${
                                          summary.partySigningKeys
                                              .signingKeyCount
                                      }
                                  </div>`
                                : nothing
                        }
                        <div class="tx-summary-detail">
                            Hosting participants:
                        </div>
                        <ul>
                            ${summary.participants.map(
                                (p) =>
                                    html`<li>
                                        ${p.participantUid} (permission
                                        ${p.permission})
                                    </li>`
                            )}
                        </ul>
                    </div>
                `
            case 'partyToKeyMapping':
                return html`
                    <div class="tx-summary">
                        ${title('Party-to-key mapping')}
                        <div class="tx-summary-detail">
                            Party: <code>${summary.party}</code>
                        </div>
                        <div class="tx-summary-detail">
                            Threshold: ${summary.threshold} of
                            ${summary.signingKeyCount} signing keys
                        </div>
                    </div>
                `
            default:
                return html`
                    <div class="tx-summary">
                        ${title('Unknown mapping')}
                        <div class="tx-summary-detail">
                            Type: ${summary.mappingKind}
                        </div>
                    </div>
                `
        }
    }
}

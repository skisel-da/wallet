// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { css, html, TemplateResult } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import {
    BaseElement,
    handleErrorToast,
    toRelHref,
} from '@canton-network/core-wallet-ui-components'
import { TopologyTransactionSummary } from '@canton-network/core-wallet-user-rpc-client'
import { createUserClient } from '../rpc-client'
import { setLocationHref } from '../navigation.js'
import { stateManager } from '../state-manager'
import '../index'
import { detectCurrentOrigin } from '../listeners.js'

@customElement('user-ui-sign-topology')
export class UserUiSignTopology extends BaseElement {
    @state() accessor requestId = ''
    @state() accessor summaries: TopologyTransactionSummary[] = []
    @state() accessor synchronizerId: string | null = null
    @state() accessor origin: string | null = null
    @state() accessor status = ''
    @state() accessor isApproving = false
    @state() accessor isDeleting = false
    @state() accessor disabled = false
    @state() accessor loadError: string | null = null
    @state() accessor isLoading = true

    private extractRpcErrorMessage(e: unknown): string | null {
        // HttpTransport throws { error: { code, message, data } } on non-2xx.
        // For JSON-RPC handlers, error.data often contains the JSON-RPC error response as a string.
        try {
            if (typeof e !== 'object' || e === null) return null
            if (!('error' in e)) return null
            const errObj = (e as { error?: unknown }).error
            if (typeof errObj !== 'object' || errObj === null) return null
            const data = (errObj as { data?: unknown }).data
            if (typeof data !== 'string') return null
            const parsed = JSON.parse(data) as unknown
            if (
                typeof parsed === 'object' &&
                parsed !== null &&
                'error' in parsed &&
                typeof (parsed as unknown as { error?: { message?: string } })
                    .error?.message === 'string'
            ) {
                return (parsed as unknown as { error?: { message?: string } })
                    .error?.message as string
            }
            return null
        } catch {
            return null
        }
    }

    private toastRpcError(e: unknown, fallbackMessage: string) {
        const extracted = this.extractRpcErrorMessage(e)
        if (extracted) {
            handleErrorToast(new Error(extracted), { message: extracted })
            return
        }
        handleErrorToast(e, { message: fallbackMessage })
    }

    static styles = [
        BaseElement.styles,
        css`
            :host {
                display: block;
                max-width: 900px;
                margin: 0 auto;
            }
            .card {
                border: 1px solid var(--wg-border-color, #e5e7eb);
                border-radius: 12px;
                padding: 16px;
                background: var(--wg-bg-color, #fff);
            }
            .tx-summary {
                font-family:
                    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
                    'Liberation Mono', 'Courier New', monospace;
                font-size: 13px;
                line-height: 1.5;
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 12px;
                margin-top: 8px;
                word-break: break-word;
            }
            .tx-summary-title {
                font-weight: 600;
                margin-bottom: 4px;
            }
            .tx-summary-detail {
                margin: 2px 0;
            }
            .tx-summary ul {
                margin: 4px 0 0 0;
                padding-left: 20px;
            }
            .actions {
                margin-top: 16px;
                display: flex;
                gap: 12px;
            }
        `,
    ]

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
                setLocationHref(toRelHref('/activities'))
            }
        }, 500)
    }

    private async updateState() {
        this.isLoading = true
        this.loadError = null
        try {
            if (!this.requestId) {
                this.loadError = 'Topology-transactions request not found.'
                return
            }
            const currentOrigin = await detectCurrentOrigin()
            const userClient = await createUserClient(
                await stateManager.accessToken.get(currentOrigin)
            )
            const result = await userClient.request({
                method: 'getTopologyBundleToSign',
                params: { requestId: this.requestId },
            })
            this.summaries = result.bundle.summaries
            this.synchronizerId = result.bundle.synchronizerId ?? null
            this.origin = result.bundle.origin ?? null
            this.status = result.bundle.status
        } catch (err) {
            console.error(err)
            // Most common case: requestId doesn't exist anymore / was deleted
            this.loadError = 'Topology-transactions request not found.'
        } finally {
            this.isLoading = false
        }
    }

    private async handleReject() {
        if (!confirm('Reject topology-transactions signing request?')) return
        this.isDeleting = true
        try {
            const currentOrigin = await detectCurrentOrigin()
            const userClient = await createUserClient(
                await stateManager.accessToken.get(currentOrigin)
            )
            await userClient.request({
                method: 'deleteTopologyBundleToSign',
                params: { requestId: this.requestId },
            })
            this.closeOrGoToActivities()
        } catch (err) {
            console.error(err)
            this.toastRpcError(err, 'Error rejecting topology transactions')
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
                method: 'signTopologyTransactions',
                params: { requestId: this.requestId },
            })
            this.closeOrGoToActivities()
        } catch (err) {
            console.error(err)
            this.toastRpcError(err, 'Error signing topology transactions')
        } finally {
            this.isApproving = false
        }
    }

    private renderSummary(
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
                            ${summary.owners?.length ?? 0} owners
                        </div>
                        <div class="tx-summary-detail">
                            Owners: ${(summary.owners ?? []).join(', ')}
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
                        <div class="tx-summary-detail">
                            Hosting participants:
                        </div>
                        <ul>
                            ${(summary.participants ?? []).map(
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
                            ${summary.signingKeyCount ?? 0} signing keys
                        </div>
                    </div>
                `
            default:
                return html`
                    <div class="tx-summary">
                        ${title('Unknown mapping')}
                        <div class="tx-summary-detail">
                            Type: ${summary.mappingKind ?? 'unknown'}
                        </div>
                    </div>
                `
        }
    }

    protected render() {
        if (this.isLoading) {
            return html`
                <div class="card">
                    <h1 class="h5 fw-semibold mb-2 text-body">
                        Sign topology transactions
                    </h1>
                    <p class="mb-0 text-body-secondary">Loading...</p>
                </div>
            `
        }

        if (this.loadError) {
            return html`
                <div class="card">
                    <h1 class="h5 fw-semibold mb-2 text-body">
                        Sign topology transactions
                    </h1>
                    <div class="alert alert-warning" role="alert">
                        ${this.loadError}
                    </div>
                    <a
                        class="btn btn-outline-secondary"
                        href=${toRelHref('/activities')}
                        >Back to activities</a
                    >
                </div>
            `
        }

        return html`
            <div class="card">
                <h1 class="h5 fw-semibold mb-2 text-body">
                    Sign topology transactions
                </h1>
                ${
                    this.origin
                        ? html`<p class="mb-2 text-body-secondary">
                              Requested by: <strong>${this.origin}</strong>
                          </p>`
                        : ''
                }
                ${
                    this.synchronizerId
                        ? html`<p class="mb-2 text-body-secondary">
                              Synchronizer:
                              <strong>${this.synchronizerId}</strong>
                          </p>`
                        : ''
                }

                <p class="mb-2 text-body-secondary">
                    Please review the decoded topology transactions below.
                    Signing will produce a single combined signature over all of
                    them, computed fresh by your wallet from the underlying
                    bytes.
                </p>

                ${this.summaries.map((summary, index) =>
                    this.renderSummary(summary, index)
                )}

                <div class="actions">
                    <button
                        class="btn btn-outline-danger"
                        ?disabled=${this.disabled || this.isDeleting}
                        @click=${this.handleReject}
                    >
                        ${this.isDeleting ? 'Rejecting…' : 'Reject'}
                    </button>
                    <button
                        class="btn btn-primary"
                        ?disabled=${this.disabled || this.isApproving}
                        @click=${this.handleApprove}
                    >
                        ${this.isApproving ? 'Signing…' : 'Sign'}
                    </button>
                </div>
            </div>
        `
    }
}

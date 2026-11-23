// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type {
    ParsedTransactionInfo,
    TopologyTransactionSummary,
} from '@canton-network/core-tx-visualizer'
import { html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import './back-link.ts'
import './copy-button.ts'
import { renderCopyableValue } from '../internal/activity-render.ts'
import {
    getActivityStatusBadgeClass,
    getActivityStatusLabel,
    getActivityType,
} from '../internal/activity-utils.ts'
import { BaseElement } from '../internal/base-element.ts'

const topologyKindLabels = {
    namespaceDelegation: 'Namespace delegation',
    decentralizedNamespaceDefinition: 'Decentralized namespace definition',
    partyToParticipant: 'Party to participant',
    partyToKeyMapping: 'Party to key mapping',
    unknown: 'Unknown mapping',
} satisfies Record<TopologyTransactionSummary['kind'], string>

/** Emitted when the user clicks the "Approve" button */
export class MessageApproveEvent extends Event {
    constructor(public messageId: string) {
        super('message-approve', { bubbles: true, composed: true })
    }
}

/** Emitted when the user clicks the "Reject" button */
export class MessageDeleteEvent extends Event {
    constructor(public messageId: string) {
        super('message-delete', { bubbles: true, composed: true })
    }
}

export
@customElement('wg-message-detail')
class WgMessageDetail extends BaseElement {
    @property() accessor messageId = ''

    @property() accessor message = ''

    @property() accessor messageType: string | null = null

    @property({ type: Object }) accessor parsed: ParsedTransactionInfo | null =
        null

    @property({ type: Array })
    accessor topologySummaries: TopologyTransactionSummary[] = []

    @property() accessor status = ''

    @property() accessor externalTxId: string | null = null

    @property() accessor origin: string | null = null

    @property() accessor backHref = ''

    @property({ type: Boolean }) accessor isApproving = false

    @property({ type: Boolean }) accessor isDeleting = false

    @property({ type: Boolean }) accessor isSigning = false

    // Disables action buttons regardless of status
    @property({ type: Boolean }) accessor disabled = false

    static styles = [
        BaseElement.styles,
        css`
            :host {
                display: block;
                max-width: 900px;
                margin: 0 auto;
            }

            .page-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--wg-space-3);
                margin-bottom: var(--wg-space-4);
            }

            .page-title {
                color: var(--wg-text);
            }

            .detail-grid {
                display: flex;
                flex-direction: column;
                gap: var(--wg-space-4);
            }

            .field {
                display: flex;
                flex-direction: column;
                gap: var(--wg-space-1);
                min-width: 0;
            }

            .field--stacked {
                gap: var(--wg-space-2);
            }

            .detail-row {
                display: grid;
                grid-template-columns: minmax(0, 8.5rem) minmax(0, 1fr);
                align-items: center;
                gap: var(--wg-space-3);
                min-width: 0;
            }

            .label {
                margin: 0;
                color: var(--wg-text-secondary);
                font-size: var(--wg-font-size-xs);
                font-weight: var(--wg-font-weight-semibold);
                line-height: 1.4;
            }

            .value {
                margin: 0;
                color: var(--wg-text);
                font-size: var(--wg-font-size-sm);
                line-height: 1.5;
                min-width: 0;
                word-break: break-word;
                text-align: right;
            }

            .detail-value {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: var(--wg-space-2);
                min-width: 0;
            }

            .detail-value .value,
            .detail-value wg-copy-button {
                flex: 0 0 auto;
            }

            .detail-value .value {
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                word-break: normal;
            }

            .message-box {
                margin: 0;
                padding: var(--wg-space-4);
                border: 1px solid var(--wg-border);
                border-radius: var(--wg-radius-lg);
                background: var(--wg-input-bg);
                color: var(--wg-text);
                font-family: var(--bs-font-monospace);
                white-space: pre-wrap;
                word-break: break-word;
                max-height: 20rem;
                overflow: auto;
                text-align: left;
            }

            .mapping {
                display: flex;
                flex-direction: column;
                gap: var(--wg-space-3);
                padding: var(--wg-space-4);
                border: 1px solid var(--wg-border);
                border-radius: var(--wg-radius-lg);
            }

            .mapping-title {
                margin: 0;
                color: var(--wg-text);
            }

            .actions {
                margin-top: var(--wg-space-6);
                display: flex;
                gap: var(--wg-space-3);
                justify-content: flex-start;
                flex-wrap: nowrap;
            }

            .actions .btn {
                flex: 1 1 0;
                min-width: 0;
                white-space: nowrap;
            }

            .actions .btn:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
        `,
    ]

    private get isApproveDisabled() {
        return (
            this.disabled ||
            this.isApproving ||
            this.isDeleting ||
            this.isSigning
        )
    }

    private get isDeleteDisabled() {
        return this.disabled || this.isApproving || this.isDeleting
    }

    private renderInlineField(label: string, value: unknown) {
        return html`
            <section class="field">
                <div class="detail-row">
                    <h2
                        class="label small fw-semibold text-body-secondary mb-0"
                    >
                        ${label}
                    </h2>
                    <div class="detail-value">
                        <p class="value mb-0 text-body">${value}</p>
                    </div>
                </div>
            </section>
        `
    }

    private renderTopologySummary(summary: TopologyTransactionSummary) {
        switch (summary.kind) {
            case 'namespaceDelegation':
                return html`
                    ${renderCopyableValue(
                        'Namespace',
                        summary.namespace,
                        'Copy namespace'
                    )}
                    ${this.renderInlineField(
                        'Root delegation',
                        summary.isRootDelegation ? 'Yes' : 'No'
                    )}
                `
            case 'decentralizedNamespaceDefinition':
                return html`
                    ${renderCopyableValue(
                        'Decentralized namespace',
                        summary.decentralizedNamespace,
                        'Copy decentralized namespace'
                    )}
                    ${this.renderInlineField(
                        'Threshold',
                        `${summary.threshold} of ${summary.owners.length}`
                    )}
                    ${summary.owners.map((owner) =>
                        renderCopyableValue('Owner', owner, 'Copy owner')
                    )}
                `
            case 'partyToParticipant':
                return html`
                    ${renderCopyableValue('Party', summary.party, 'Copy party')}
                    ${this.renderInlineField(
                        'Confirmation threshold',
                        summary.threshold
                    )}
                    ${summary.participants.map((participant) =>
                        renderCopyableValue(
                            `Hosted by (${participant.permission}, ${participant.state})`,
                            participant.participantUid,
                            'Copy participant'
                        )
                    )}
                    ${
                        summary.partySigningKeys
                            ? this.renderInlineField(
                                  'Party signing keys',
                                  `${summary.partySigningKeys.threshold} of ${summary.partySigningKeys.keyCount}`
                              )
                            : nothing
                    }
                `
            case 'partyToKeyMapping':
                return html`
                    ${renderCopyableValue('Party', summary.party, 'Copy party')}
                    ${this.renderInlineField(
                        'Signing keys',
                        `${summary.threshold} of ${summary.signingKeyCount}`
                    )}
                `
            case 'unknown':
                return this.renderInlineField('Mapping', summary.mappingKind)
        }
    }

    private renderTopologyTransactions() {
        return html`
            <div class="alert alert-info mb-0" role="alert">
                You sign these topology transactions together with your own key.
                Nothing is submitted by this wallet.
            </div>
            ${this.topologySummaries.map(
                (summary, index) => html`
                    <section class="mapping">
                        <h2 class="mapping-title h6 fw-semibold mb-0">
                            ${index + 1}. ${topologyKindLabels[summary.kind]}
                            (${summary.operation})
                        </h2>
                        ${this.renderTopologySummary(summary)}
                    </section>
                `
            )}
        `
    }

    private renderPreparedTransaction() {
        return html`
            <div class="alert alert-info mb-0" role="alert">
                You sign as an owner of the acting party. Nothing is submitted
                by this wallet.
            </div>
            ${this.renderInlineField('Action type', getActivityType(this.parsed))}
            ${(this.parsed?.signatories ?? []).map((signatory) =>
                renderCopyableValue('Signatory', signatory, 'Copy signatory')
            )}
            ${renderCopyableValue(
                'Template',
                this.parsed?.templateId,
                'Copy template'
            )}
            <section class="field field--stacked">
                <h2 class="label small fw-semibold text-body-secondary mb-0">
                    Transaction JSON Object
                </h2>
                <pre class="message-box small">
${this.parsed?.jsonString || 'N/A'}</pre>
            </section>
        `
    }

    private renderMessage() {
        switch (this.messageType) {
            case 'canton-topology-transactions':
                return this.renderTopologyTransactions()
            case 'canton-prepared-transaction':
                return this.renderPreparedTransaction()
            default:
                return html`
                    <section class="field field--stacked">
                        <h2
                            class="label small fw-semibold text-body-secondary mb-0"
                        >
                            Message
                        </h2>
                        <pre class="message-box small">${this.message}</pre>
                    </section>
                `
        }
    }

    protected render() {
        return html`
            <div class="page-header">
                <h1 class="page-title h4 fw-semibold mb-0">Message Details</h1>
                ${
                    this.backHref
                        ? html`<wg-back-link
                              href=${this.backHref}
                          ></wg-back-link>`
                        : nothing
                }
            </div>

            <div class="detail-grid">
                ${this.renderInlineField(
                    'Status',
                    html`<span
                        class="badge rounded-pill small ${getActivityStatusBadgeClass(
                            this.status
                        )}"
                    >
                        ${getActivityStatusLabel(this.status)}
                    </span>`
                )}
                ${
                    this.origin
                        ? this.renderInlineField('Requested by', this.origin)
                        : nothing
                }
                ${
                    this.externalTxId
                        ? renderCopyableValue(
                              'External transaction ID',
                              this.externalTxId,
                              'Copy external transaction ID'
                          )
                        : nothing
                }
                ${this.renderMessage()}
            </div>

            ${this.renderActionButtons()}
        `
    }

    private renderActionButtons() {
        if (this.status !== 'pending') {
            return nothing
        }

        return html`
            <div class="actions">
                <button
                    class="btn btn-outline-danger rounded-pill d-inline-flex align-items-center justify-content-center gap-2"
                    ?disabled=${this.isDeleteDisabled}
                    @click=${() =>
                        this.dispatchEvent(
                            new MessageDeleteEvent(this.messageId)
                        )}
                >
                    ${
                        this.isDeleting
                            ? html`<div
                                  class="spinner-border spinner-border-sm"
                              ></div>`
                            : nothing
                    }
                    Reject
                </button>

                <button
                    class="btn btn-primary rounded-pill d-inline-flex align-items-center justify-content-center gap-2"
                    ?disabled=${this.isApproveDisabled}
                    @click=${() =>
                        this.dispatchEvent(
                            new MessageApproveEvent(this.messageId)
                        )}
                >
                    ${
                        this.isApproving || this.isSigning
                            ? html`<div
                                  class="spinner-border spinner-border-sm"
                              ></div>`
                            : nothing
                    }
                    Approve
                </button>
            </div>
        `
    }
}

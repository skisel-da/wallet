// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { css, html } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import {
    BaseElement,
    chevronLeftIcon,
    handleErrorToast,
    toRelHref,
    toRelPath,
} from '@canton-network/core-wallet-ui-components'
import { createUserClient } from '../../rpc-client'
import { setLocationHref } from '../../navigation.js'
import { stateManager } from '../../state-manager'
import { showToast } from '../../utils.js'
import '../../index'
import { detectCurrentOrigin } from '../../listeners.js'

@customElement('user-ui-import-party')
export class UserUiImportParty extends BaseElement {
    @state() accessor submitting = false

    @query('#party-id') accessor partyIdInput: HTMLInputElement | null = null

    static styles = [
        BaseElement.styles,
        css`
            :host {
                display: block;
            }

            .page-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: var(--wg-space-4);
                gap: var(--wg-space-3);
            }

            .form-wrap {
                width: 100%;
            }

            .field-group {
                gap: var(--wg-space-2);
                margin-bottom: var(--wg-space-4);
            }

            .field-label {
                font-size: var(--wg-font-size-sm);
                font-weight: var(--wg-font-weight-medium);
                color: var(--wg-text-secondary);
                line-height: var(--wg-line-height-tight);
            }

            .required {
                color: var(--wg-label-required-color);
            }

            .field-control {
                width: 100%;
                border: 1px solid var(--wg-input-border);
                border-radius: 4px;
                background: var(--wg-input-bg);
                color: var(--wg-input-text);
                padding: 12px 14px;
            }

            .field-control:focus {
                border-color: var(--wg-input-border-focus);
                box-shadow: 0 0 0 3px rgba(var(--wg-accent-rgb), 0.12);
            }

            .field-hint {
                margin-top: var(--wg-space-2);
                color: var(--wg-text-secondary);
                font-size: var(--wg-font-size-sm);
            }

            .submit-button {
                min-height: 44px;
            }
        `,
    ]

    private navigateBack() {
        setLocationHref(toRelHref('/parties'))
    }

    private async onSubmit(event: Event) {
        event.preventDefault()

        if (this.submitting) {
            return
        }

        const partyId = this.partyIdInput?.value.trim() || ''
        if (!partyId) {
            return
        }

        this.submitting = true

        try {
            const currentOrigin = await detectCurrentOrigin()
            const userClient = await createUserClient(
                await stateManager.accessToken.get(currentOrigin)
            )
            const result = await userClient.request({
                method: 'importParty',
                params: { partyId },
            })

            if (result?.wallet?.disabled) {
                showToast(
                    'Party imported',
                    "The party was imported, but no signing provider matches its namespace -- it's shown but disabled.",
                    'info'
                )
            } else {
                showToast(
                    'Party imported',
                    'The party has been imported into this wallet.',
                    'success'
                )
            }

            setLocationHref(toRelPath('/parties/'))
        } catch (error) {
            this.submitting = false
            handleErrorToast(error)
        }
    }

    protected render() {
        return html`
            <div class="page-header">
                <h1 class="h4 fw-semibold mb-0">Import an existing party</h1>
                <button
                    class="btn btn-link btn-sm text-body text-decoration-none p-0 d-inline-flex align-items-center gap-1"
                    type="button"
                    @click=${this.navigateBack}
                >
                    ${chevronLeftIcon}
                    <span>Back</span>
                </button>
            </div>

            <div class="form-wrap">
                <form class="d-flex flex-column" @submit=${this.onSubmit}>
                    <div class="field-group d-flex flex-column">
                        <label
                            for="party-id"
                            class="form-label field-label mb-0"
                        >
                            Party ID <span class="required">*</span>
                        </label>
                        <input
                            ?disabled=${this.submitting}
                            class="form-control field-control"
                            id="party-id"
                            type="text"
                            placeholder="alice::12200a1b2c3d..."
                            required
                        />
                        <p class="field-hint mb-0">
                            The party must already exist on this participant --
                            this grants the current session rights to act as it,
                            it does not create anything on the ledger.
                        </p>
                    </div>

                    <button
                        class="submit-button btn btn-primary rounded-pill w-100 d-inline-flex align-items-center justify-content-center gap-2"
                        ?disabled=${this.submitting}
                        type="submit"
                    >
                        ${this.submitting ? 'Importing...' : 'Import'}
                    </button>
                </form>
            </div>
        `
    }
}

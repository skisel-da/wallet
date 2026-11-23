// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type {
    ParsedTransactionInfo,
    TopologyTransactionSummary,
} from '@canton-network/core-tx-visualizer'
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
    findAllByShadowRole,
    findAllByShadowText,
    findByShadowRole,
    findByShadowText,
    queryByShadowRole,
    queryByShadowText,
} from 'shadow-dom-testing-library'
import { expect, fn } from 'storybook/test'

import { MessageDetail } from './MessageDetail.tsx'

const message = 'Sign in to Example dApp\nNonce: 12345'

const parsed: ParsedTransactionInfo = {
    isCreate: false,
    isExercise: true,
    choiceId: 'TransferPreapproval_Send',
    templateId: 'pkg:Module:Entity',
    signatories: ['alice::1220aa', 'bob::1220bb'],
    jsonString: '{"a":1}',
}

const topologySummaries: TopologyTransactionSummary[] = [
    {
        operation: 'ADD_REPLACE',
        serial: 1,
        kind: 'decentralizedNamespaceDefinition',
        decentralizedNamespace: '1220dd',
        threshold: 2,
        owners: ['1220aa', '1220bb'],
    },
    {
        operation: 'ADD_REPLACE',
        serial: 1,
        kind: 'partyToParticipant',
        party: 'joint::1220dd',
        threshold: 1,
        participants: [
            {
                participantUid: 'participant1::1220ee',
                permission: 'CONFIRMATION',
                state: 'ACTIVE',
            },
        ],
        partySigningKeys: { threshold: 2, keyCount: 2 },
    },
]

const meta = {
    title: 'MessageDetail',
    component: MessageDetail,
    args: {
        messageId: 'msg-1',
        message,
        status: 'pending',
        onMessageApprove: fn(),
        onMessageDelete: fn(),
    },
} satisfies Meta<typeof MessageDetail>

export default meta

type Story = StoryObj<typeof meta>

export const Pending: Story = {
    args: {
        origin: 'https://dapp.example',
        externalTxId: 'ext-1',
        backHref: '/activities/',
    },
    play: async ({ args, canvasElement, userEvent }) => {
        await expect(
            await findByShadowRole(canvasElement, 'heading', {
                name: 'Message Details',
            })
        ).toBeInTheDocument()
        await expect(
            await findByShadowText(canvasElement, 'pending')
        ).toBeInTheDocument()
        await expect(
            await findByShadowText(canvasElement, 'https://dapp.example')
        ).toBeInTheDocument()
        await expect(
            await findByShadowText(canvasElement, 'ext-1')
        ).toBeInTheDocument()
        await expect(
            await findByShadowRole(canvasElement, 'button', {
                name: 'Copy external transaction ID',
            })
        ).toBeInTheDocument()
        await expect(
            await findByShadowRole(canvasElement, 'link', { name: 'Back' })
        ).toHaveAttribute('href', '/activities/')

        // The message is shown as is, line breaks included
        await expect(
            await findByShadowText(
                canvasElement,
                (_, el) => el?.tagName === 'PRE' && el.textContent === message
            )
        ).toBeInTheDocument()

        await userEvent.click(
            await findByShadowRole(canvasElement, 'button', {
                name: 'Approve',
            })
        )
        await expect(args.onMessageApprove).toHaveBeenCalledOnce()
        await expect(args.onMessageApprove).toHaveBeenCalledWith(
            expect.objectContaining({ messageId: 'msg-1' })
        )
        await expect(args.onMessageDelete).not.toHaveBeenCalled()

        await userEvent.click(
            await findByShadowRole(canvasElement, 'button', { name: 'Reject' })
        )
        await expect(args.onMessageDelete).toHaveBeenCalledOnce()
        await expect(args.onMessageDelete).toHaveBeenCalledWith(
            expect.objectContaining({ messageId: 'msg-1' })
        )
    },
}

export const Minimal: Story = {
    play: async ({ canvasElement }) => {
        await findByShadowRole(canvasElement, 'heading', {
            name: 'Message Details',
        })
        // The optional rows and the back link are only shown when set
        await expect(
            queryByShadowText(canvasElement, 'Requested by')
        ).not.toBeInTheDocument()
        await expect(
            queryByShadowText(canvasElement, 'External transaction ID')
        ).not.toBeInTheDocument()
        await expect(
            queryByShadowRole(canvasElement, 'button', { name: /^Copy/ })
        ).not.toBeInTheDocument()
        await expect(
            queryByShadowRole(canvasElement, 'link', { name: 'Back' })
        ).not.toBeInTheDocument()
    },
}

export const AwaitingSignature: Story = {
    args: {
        status: 'awaiting-signature',
        origin: 'https://dapp.example',
        externalTxId: 'ext-1',
    },
    play: async ({ canvasElement }) => {
        await expect(
            await findByShadowText(canvasElement, 'awaiting-signature')
        ).toBeInTheDocument()
        await expect(
            await findByShadowText(canvasElement, 'Requested by')
        ).toBeInTheDocument()
        await expect(
            await findByShadowText(canvasElement, 'External transaction ID')
        ).toBeInTheDocument()
        await expect(
            await findByShadowText(canvasElement, 'ext-1')
        ).toBeInTheDocument()
        await expect(
            await findByShadowRole(canvasElement, 'button', {
                name: 'Copy external transaction ID',
            })
        ).toBeInTheDocument()

        // Only pending messages have actions
        await expect(
            queryByShadowRole(canvasElement, 'button', { name: 'Approve' })
        ).not.toBeInTheDocument()
        await expect(
            queryByShadowRole(canvasElement, 'button', { name: 'Reject' })
        ).not.toBeInTheDocument()
    },
}

export const WithoutActions: Story = {
    render: (args) => (
        <>
            {['signed', 'failed', ''].map((status) => (
                <MessageDetail key={status} {...args} status={status} />
            ))}
        </>
    ),
    play: async ({ canvasElement }) => {
        // Each status is shown, with a fallback label
        for (const label of ['signed', 'failed', 'Unknown']) {
            await expect(
                await findByShadowText(canvasElement, label)
            ).toBeInTheDocument()
        }

        // Only pending messages have actions
        await expect(
            queryByShadowRole(canvasElement, 'button', { name: 'Approve' })
        ).not.toBeInTheDocument()
        await expect(
            queryByShadowRole(canvasElement, 'button', { name: 'Reject' })
        ).not.toBeInTheDocument()
    },
}

export const Signing: Story = {
    args: { isSigning: true },
    play: async ({ args, canvasElement, userEvent }) => {
        const approve = await findByShadowRole(canvasElement, 'button', {
            name: 'Approve',
        })
        await expect(approve).toBeDisabled()
        // The message can still be rejected while it is being signed
        const reject = await findByShadowRole(canvasElement, 'button', {
            name: 'Reject',
        })
        await expect(reject).toBeEnabled()

        await userEvent.click(reject)
        await expect(args.onMessageDelete).toHaveBeenCalledOnce()
    },
}

export const Approving: Story = {
    args: { isApproving: true },
    play: async ({ canvasElement }) => {
        await expect(
            await findByShadowRole(canvasElement, 'button', {
                name: 'Approve',
            })
        ).toBeDisabled()
        await expect(
            await findByShadowRole(canvasElement, 'button', { name: 'Reject' })
        ).toBeDisabled()
    },
}

export const Deleting: Story = {
    args: { isDeleting: true },
    play: async ({ canvasElement }) => {
        await expect(
            await findByShadowRole(canvasElement, 'button', {
                name: 'Approve',
            })
        ).toBeDisabled()
        await expect(
            await findByShadowRole(canvasElement, 'button', { name: 'Reject' })
        ).toBeDisabled()
    },
}

export const Disabled: Story = {
    args: { disabled: true },
    play: async ({ canvasElement }) => {
        const approve = await findByShadowRole(canvasElement, 'button', {
            name: 'Approve',
        })
        const reject = await findByShadowRole(canvasElement, 'button', {
            name: 'Reject',
        })
        await expect(approve).toBeDisabled()
        await expect(reject).toBeDisabled()
    },
}

export const PreparedTransaction: Story = {
    args: {
        messageType: 'canton-prepared-transaction',
        parsed,
    },
    play: async ({ args, canvasElement, userEvent }) => {
        await expect(
            await findByShadowText(canvasElement, (content) =>
                content.includes('You sign as an owner')
            )
        ).toBeInTheDocument()
        for (const text of [
            'TransferPreapproval_Send',
            'alice::1220aa',
            'bob::1220bb',
            'pkg:Module:Entity',
            'Transaction JSON Object',
        ]) {
            await expect(
                await findByShadowText(canvasElement, text)
            ).toBeInTheDocument()
        }
        await expect(
            await findByShadowText(
                canvasElement,
                (_, el) => el?.tagName === 'PRE' && el.textContent === '{"a":1}'
            )
        ).toBeInTheDocument()
        await expect(
            queryByShadowText(canvasElement, 'Message')
        ).not.toBeInTheDocument()

        await userEvent.click(
            await findByShadowRole(canvasElement, 'button', {
                name: 'Approve',
            })
        )
        await expect(args.onMessageApprove).toHaveBeenCalledOnce()
    },
}

export const TopologyTransactions: Story = {
    args: {
        messageType: 'canton-topology-transactions',
        topologySummaries,
    },
    play: async ({ canvasElement }) => {
        await expect(
            await findByShadowText(canvasElement, (content) =>
                content.includes('together with your own key')
            )
        ).toBeInTheDocument()
        for (const text of [
            '1. Decentralized namespace definition (ADD_REPLACE)',
            '2. Party to participant (ADD_REPLACE)',
            '2 of 2',
            'joint::1220dd',
            'participant1::1220ee',
            'Hosted by (CONFIRMATION, ACTIVE)',
        ]) {
            await expect(
                (await findAllByShadowText(canvasElement, text)).length
            ).toBeGreaterThan(0)
        }
        for (const owner of ['1220aa', '1220bb']) {
            await expect(
                await findByShadowText(canvasElement, owner)
            ).toBeInTheDocument()
        }
        await expect(
            await findAllByShadowRole(canvasElement, 'button', {
                name: 'Copy owner',
            })
        ).toHaveLength(2)
    },
}

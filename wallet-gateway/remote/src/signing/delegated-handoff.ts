// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { isRpcError, SigningProvider } from '@canton-network/core-signing-lib'
import {
    DecentralizedSigningDriver,
    type DelegatedHandoff,
    type DelegatedSignTransactionParams,
} from '@canton-network/core-signing-decentralized'
import { Wallet } from '@canton-network/core-wallet-store'
import type { SigningDrivers } from './signing-drivers.js'

/**
 * Asks the decentralized signing driver where a party's owners should go to
 * coordinate a signature.
 *
 * Deliberately not routed through `TransactionService.sign`: that loads the
 * transaction back out of the store, and the whole point of this path is that
 * the gateway records nothing it will not complete.
 */
export async function buildDelegatedHandoff(
    drivers: SigningDrivers,
    userId: string,
    wallet: Wallet,
    request: {
        requestId: string
        preparedTransaction: string
        preparedTransactionHash: string
        commandId: string
    }
): Promise<DelegatedHandoff> {
    const driver = drivers[SigningProvider.DECENTRALIZED]
    if (!(driver instanceof DecentralizedSigningDriver)) {
        throw new Error(
            'Decentralized signing driver is not configured on this gateway'
        )
    }
    if (!wallet.delegatedSigningUrl) {
        throw new Error(
            `Party ${wallet.partyId} is configured for delegated signing but has no delegatedSigningUrl. Set one before transacting as this party.`
        )
    }

    const params: DelegatedSignTransactionParams = {
        tx: request.preparedTransaction,
        // The coordinator and every co-signing wallet work from the base64
        // Canton hash, so unlike the custody drivers this is passed through
        // as-is rather than hex-encoded.
        txHash: request.preparedTransactionHash,
        keyIdentifier: { publicKey: wallet.publicKey },
        internalTxId: request.requestId,
        delegatedSigningUrl: wallet.delegatedSigningUrl,
        partyId: wallet.partyId,
        commandId: request.commandId,
    }

    const result = await driver.controller(userId).signTransaction(params)
    if (isRpcError(result)) {
        throw new Error(
            `Delegated signing for party ${wallet.partyId} failed: ${result.error_description}`
        )
    }

    const handoff = result.metadata as DelegatedHandoff | undefined
    if (!handoff?.userUrl) {
        throw new Error(
            `Delegated signing for party ${wallet.partyId} did not yield a coordination URL`
        )
    }
    return handoff
}

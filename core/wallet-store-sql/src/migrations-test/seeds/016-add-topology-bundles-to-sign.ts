// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { Kysely, sql } from 'kysely'
import { DB } from '../../schema.js'

export async function insertTopologyBundleRaw(
    db: Kysely<DB>,
    row: {
        id: string
        status: string
        partyId: string
        publicKey: string
        transactions: string
        summaries: string
        userId: string
        networkId: string
        createdAt: string
        synchronizerId?: string | null
        origin?: string | null
        signedAt?: string | null
        signature?: string | null
        multiHash?: string | null
    }
): Promise<void> {
    await sql`
        INSERT INTO topology_bundles_raw (
            id, status, party_id, public_key, transactions, summaries,
            synchronizer_id, origin, user_id, network_id, created_at,
            signed_at, signature, multi_hash
        )
        VALUES (
            ${row.id},
            ${row.status},
            ${row.partyId},
            ${row.publicKey},
            ${row.transactions},
            ${row.summaries},
            ${row.synchronizerId ?? null},
            ${row.origin ?? null},
            ${row.userId},
            ${row.networkId},
            ${row.createdAt},
            ${row.signedAt ?? null},
            ${row.signature ?? null},
            ${row.multiHash ?? null}
        )
    `.execute(db)
}

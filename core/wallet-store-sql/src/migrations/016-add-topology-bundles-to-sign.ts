// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { Kysely } from 'kysely'
import { DB } from '../schema.js'

export async function up(db: Kysely<DB>): Promise<void> {
    await db.schema
        .createTable('topologyBundlesRaw')
        .addColumn('id', 'text', (col) => col.notNull().primaryKey())
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('partyId', 'text', (col) => col.notNull())
        .addColumn('publicKey', 'text', (col) => col.notNull())
        .addColumn('transactions', 'text', (col) => col.notNull())
        .addColumn('summaries', 'text', (col) => col.notNull())
        .addColumn('synchronizerId', 'text')
        .addColumn('origin', 'text')
        .addColumn('userId', 'text', (col) => col.notNull())
        .addColumn('networkId', 'text', (col) => col.notNull())
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .addColumn('signedAt', 'text')
        .addColumn('signature', 'text')
        .addColumn('multiHash', 'text')
        .execute()

    await db.schema
        .createIndex('idx_topologyBundlesRaw_user_network')
        .on('topologyBundlesRaw')
        .columns(['userId', 'networkId'])
        .execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
    await db.schema.dropIndex('idx_topologyBundlesRaw_user_network').execute()
    await db.schema.dropTable('topologyBundlesRaw').execute()
}

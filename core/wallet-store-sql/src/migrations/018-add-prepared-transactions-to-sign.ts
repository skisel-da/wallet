// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { Kysely } from 'kysely'
import { DB } from '../schema.js'

export async function up(db: Kysely<DB>): Promise<void> {
    await db.schema
        .createTable('preparedTransactionsToSign')
        .addColumn('id', 'text', (col) => col.notNull().primaryKey())
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('partyId', 'text', (col) => col.notNull())
        .addColumn('publicKey', 'text', (col) => col.notNull())
        .addColumn('preparedTransaction', 'text', (col) => col.notNull())
        .addColumn('preparedTransactionHash', 'text', (col) => col.notNull())
        .addColumn('origin', 'text')
        .addColumn('userId', 'text', (col) => col.notNull())
        .addColumn('networkId', 'text', (col) => col.notNull())
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .addColumn('signedAt', 'text')
        .addColumn('signature', 'text')
        .execute()

    await db.schema
        .createIndex('idx_preparedTransactionsToSign_user_network')
        .on('preparedTransactionsToSign')
        .columns(['userId', 'networkId'])
        .execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
    await db.schema
        .dropIndex('idx_preparedTransactionsToSign_user_network')
        .execute()
    await db.schema.dropTable('preparedTransactionsToSign').execute()
}

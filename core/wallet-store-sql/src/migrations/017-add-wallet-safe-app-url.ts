// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { Kysely } from 'kysely'
import { DB } from '../schema.js'

export async function up(db: Kysely<DB>): Promise<void> {
    // Column is snake_case in the DB (like existing multi-word columns, e.g.
    // externalTxId -> external_tx_id) -- CamelCasePlugin only translates at
    // the query-building layer, not in raw migration DDL.
    await db.schema
        .alterTable('wallets')
        .addColumn('safe_app_url', 'text')
        .execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
    await db.schema.alterTable('wallets').dropColumn('safe_app_url').execute()
}

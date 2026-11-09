// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import type { DB } from '../schema.js'

// `messageType` says what `message` carries when it is not UTF-8 text (a
// prepared transaction, or a JSON array of topology transactions); null for
// every message so far.
export async function up(db: Kysely<DB>): Promise<void> {
    await db.schema
        .alterTable('messagesRaw')
        .addColumn('messageType', 'text')
        .execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
    await db.schema
        .alterTable('messagesRaw')
        .dropColumn('messageType')
        .execute()
}

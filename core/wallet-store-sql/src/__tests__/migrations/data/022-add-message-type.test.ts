// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from 'vitest'
import { sql } from 'kysely'

import {
    forEachDialect,
    migrateDownThrough,
    migrateUpThrough,
    migrateUpToBefore,
    hasColumn,
    listColumns,
} from '../helpers'
import { insertMessageRaw as insertMessageRaw021 } from '../seeds/021-add-message-kind'
import { insertMessageRaw as insertMessageRaw022 } from '../seeds/022-add-message-type'

const TARGET = 22
const TABLE = 'messages_raw'

forEachDialect('migration 022 - message type', ({ getDb }) => {
    test('adds nullable message_type and preserves existing rows', async () => {
        const db = getDb()
        await migrateUpToBefore(db, TARGET)

        await insertMessageRaw021(db, {
            id: 'msg-1',
            kind: 'regular',
            status: 'pending',
            partyId: 'party::1',
            publicKey: 'pk-1',
            message: 'hello',
            userId: 'user1',
            networkId: 'net1',
            createdAt: '2026-05-08T13:00:00.000Z',
        })

        await migrateUpThrough(db, TARGET)

        const cols = await listColumns(db, TABLE)
        const byName = new Map(cols.map((c) => [c.name, c]))
        expect(byName.get('message_type')?.nullable).toBe(true)

        const rows = await sql`
            SELECT id, message, message_type FROM messages_raw
        `.execute(db)
        expect(rows.rows).toHaveLength(1)
        expect(rows.rows[0]).toMatchObject({
            id: 'msg-1',
            message: 'hello',
            messageType: null,
        })
    })

    test('down removes message_type and preserves existing rows', async () => {
        const db = getDb()
        await migrateUpThrough(db, TARGET)

        await insertMessageRaw022(db, {
            id: 'msg-2',
            kind: 'regular',
            status: 'pending',
            partyId: 'party::2',
            publicKey: 'pk-2',
            message: '["dHgw","dHgx"]',
            messageType: 'canton-topology-transactions',
            userId: 'user1',
            networkId: 'net1',
            createdAt: '2026-05-08T13:00:00.000Z',
        })

        await migrateDownThrough(db, TARGET)

        expect(await hasColumn(db, TABLE, 'message_type')).toBe(false)

        const rows = await sql`
            SELECT * FROM messages_raw
        `.execute(db)
        expect(rows.rows).toHaveLength(1)
        expect(rows.rows[0]).toMatchObject({
            id: 'msg-2',
            message: '["dHgw","dHgx"]',
        })
        expect(rows.rows[0]).not.toHaveProperty('messageType')
    })
})

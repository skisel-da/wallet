import type { BinaryWriteOptions } from '@protobuf-ts/runtime'
import type { IBinaryWriter } from '@protobuf-ts/runtime'
import type { BinaryReadOptions } from '@protobuf-ts/runtime'
import type { IBinaryReader } from '@protobuf-ts/runtime'
import type { PartialMessage } from '@protobuf-ts/runtime'
import { MessageType } from '@protobuf-ts/runtime'
import { Timestamp } from '../../../../../../google/protobuf/timestamp.js'
/**
 * * Topology transaction collection used during bootstrapping of synchronizer nodes and on the admin API
 *
 * Please note that this message should not be in the protocol package, as it is not used on the protocol
 * itself but on the admin apis. But as we can't rename the package name due to backwards compatibility
 * guarantees, we've moved the file out of the protocol.proto file, but kept the package name.
 *
 * @generated from protobuf message com.digitalasset.canton.topology.admin.v30.TopologyTransactions
 */
export interface TopologyTransactions {
    /**
     * @generated from protobuf field: repeated com.digitalasset.canton.topology.admin.v30.TopologyTransactions.Item items = 1
     */
    items: TopologyTransactions_Item[]
}
/**
 * @generated from protobuf message com.digitalasset.canton.topology.admin.v30.TopologyTransactions.Item
 */
export interface TopologyTransactions_Item {
    /**
     * @generated from protobuf field: google.protobuf.Timestamp sequenced = 4
     */
    sequenced?: Timestamp
    /**
     * @generated from protobuf field: google.protobuf.Timestamp valid_from = 1
     */
    validFrom?: Timestamp
    /**
     * @generated from protobuf field: google.protobuf.Timestamp valid_until = 2
     */
    validUntil?: Timestamp
    /**
     * * Versioned signed topology transactions serialized as byte-strings. Note that we use here the serialized
     * version that contains the version number. Using the "Versioned" version directly here would create a circular
     * dependency between the proto files. The only proper solution would be to move this into a third separate file
     * with "cross version data files", which we might do at some point.
     *
     * @generated from protobuf field: bytes transaction = 3
     */
    transaction: Uint8Array
    /**
     * @generated from protobuf field: optional string rejection_reason = 5
     */
    rejectionReason?: string
}
/**
 * @generated from protobuf message com.digitalasset.canton.topology.admin.v30.Synchronizer
 */
export interface Synchronizer {
    /**
     * @generated from protobuf oneof: kind
     */
    kind:
        | {
              oneofKind: 'id'
              /**
               * @generated from protobuf field: string id = 1
               */
              id: string
          }
        | {
              oneofKind: 'physicalId'
              /**
               * @generated from protobuf field: string physical_id = 2
               */
              physicalId: string
          }
        | {
              oneofKind: undefined
          }
}
/**
 * @generated from protobuf message com.digitalasset.canton.topology.admin.v30.StoreId
 */
export interface StoreId {
    /**
     * @generated from protobuf oneof: store
     */
    store:
        | {
              oneofKind: 'authorized'
              /**
               * @generated from protobuf field: com.digitalasset.canton.topology.admin.v30.StoreId.Authorized authorized = 1
               */
              authorized: StoreId_Authorized
          }
        | {
              oneofKind: 'synchronizer'
              /**
               * @generated from protobuf field: com.digitalasset.canton.topology.admin.v30.Synchronizer synchronizer = 2
               */
              synchronizer: Synchronizer
          }
        | {
              oneofKind: 'temporary'
              /**
               * @generated from protobuf field: com.digitalasset.canton.topology.admin.v30.StoreId.Temporary temporary = 3
               */
              temporary: StoreId_Temporary
          }
        | {
              oneofKind: undefined
          }
}
/**
 * @generated from protobuf message com.digitalasset.canton.topology.admin.v30.StoreId.Authorized
 */
export interface StoreId_Authorized {}
/**
 * @generated from protobuf message com.digitalasset.canton.topology.admin.v30.StoreId.Temporary
 */
export interface StoreId_Temporary {
    /**
     * @generated from protobuf field: string name = 1
     */
    name: string
}
/**
 * @generated from protobuf message com.digitalasset.canton.topology.admin.v30.SynchronizerPredecessor
 */
export interface SynchronizerPredecessor {
    /**
     * Id of the predecessor.
     *
     * @generated from protobuf field: string predecessor_physical_id = 1
     */
    predecessorPhysicalId: string
    /**
     * When the upgrade happened/is supposed to happen.
     *
     * @generated from protobuf field: google.protobuf.Timestamp upgrade_time = 2
     */
    upgradeTime?: Timestamp
    /**
     * Whether the participant is performing a late synchronizer upgrade.
     * default: false
     *
     * @generated from protobuf field: bool is_late_upgrade = 3
     */
    isLateUpgrade: boolean
}
declare class TopologyTransactions$Type extends MessageType<TopologyTransactions> {
    constructor()
    create(value?: PartialMessage<TopologyTransactions>): TopologyTransactions
    internalBinaryRead(
        reader: IBinaryReader,
        length: number,
        options: BinaryReadOptions,
        target?: TopologyTransactions
    ): TopologyTransactions
    internalBinaryWrite(
        message: TopologyTransactions,
        writer: IBinaryWriter,
        options: BinaryWriteOptions
    ): IBinaryWriter
}
/**
 * @generated MessageType for protobuf message com.digitalasset.canton.topology.admin.v30.TopologyTransactions
 */
export declare const TopologyTransactions: TopologyTransactions$Type
declare class TopologyTransactions_Item$Type extends MessageType<TopologyTransactions_Item> {
    constructor()
    create(
        value?: PartialMessage<TopologyTransactions_Item>
    ): TopologyTransactions_Item
    internalBinaryRead(
        reader: IBinaryReader,
        length: number,
        options: BinaryReadOptions,
        target?: TopologyTransactions_Item
    ): TopologyTransactions_Item
    internalBinaryWrite(
        message: TopologyTransactions_Item,
        writer: IBinaryWriter,
        options: BinaryWriteOptions
    ): IBinaryWriter
}
/**
 * @generated MessageType for protobuf message com.digitalasset.canton.topology.admin.v30.TopologyTransactions.Item
 */
export declare const TopologyTransactions_Item: TopologyTransactions_Item$Type
declare class Synchronizer$Type extends MessageType<Synchronizer> {
    constructor()
    create(value?: PartialMessage<Synchronizer>): Synchronizer
    internalBinaryRead(
        reader: IBinaryReader,
        length: number,
        options: BinaryReadOptions,
        target?: Synchronizer
    ): Synchronizer
    internalBinaryWrite(
        message: Synchronizer,
        writer: IBinaryWriter,
        options: BinaryWriteOptions
    ): IBinaryWriter
}
/**
 * @generated MessageType for protobuf message com.digitalasset.canton.topology.admin.v30.Synchronizer
 */
export declare const Synchronizer: Synchronizer$Type
declare class StoreId$Type extends MessageType<StoreId> {
    constructor()
    create(value?: PartialMessage<StoreId>): StoreId
    internalBinaryRead(
        reader: IBinaryReader,
        length: number,
        options: BinaryReadOptions,
        target?: StoreId
    ): StoreId
    internalBinaryWrite(
        message: StoreId,
        writer: IBinaryWriter,
        options: BinaryWriteOptions
    ): IBinaryWriter
}
/**
 * @generated MessageType for protobuf message com.digitalasset.canton.topology.admin.v30.StoreId
 */
export declare const StoreId: StoreId$Type
declare class StoreId_Authorized$Type extends MessageType<StoreId_Authorized> {
    constructor()
    create(value?: PartialMessage<StoreId_Authorized>): StoreId_Authorized
    internalBinaryRead(
        reader: IBinaryReader,
        length: number,
        options: BinaryReadOptions,
        target?: StoreId_Authorized
    ): StoreId_Authorized
    internalBinaryWrite(
        message: StoreId_Authorized,
        writer: IBinaryWriter,
        options: BinaryWriteOptions
    ): IBinaryWriter
}
/**
 * @generated MessageType for protobuf message com.digitalasset.canton.topology.admin.v30.StoreId.Authorized
 */
export declare const StoreId_Authorized: StoreId_Authorized$Type
declare class StoreId_Temporary$Type extends MessageType<StoreId_Temporary> {
    constructor()
    create(value?: PartialMessage<StoreId_Temporary>): StoreId_Temporary
    internalBinaryRead(
        reader: IBinaryReader,
        length: number,
        options: BinaryReadOptions,
        target?: StoreId_Temporary
    ): StoreId_Temporary
    internalBinaryWrite(
        message: StoreId_Temporary,
        writer: IBinaryWriter,
        options: BinaryWriteOptions
    ): IBinaryWriter
}
/**
 * @generated MessageType for protobuf message com.digitalasset.canton.topology.admin.v30.StoreId.Temporary
 */
export declare const StoreId_Temporary: StoreId_Temporary$Type
declare class SynchronizerPredecessor$Type extends MessageType<SynchronizerPredecessor> {
    constructor()
    create(
        value?: PartialMessage<SynchronizerPredecessor>
    ): SynchronizerPredecessor
    internalBinaryRead(
        reader: IBinaryReader,
        length: number,
        options: BinaryReadOptions,
        target?: SynchronizerPredecessor
    ): SynchronizerPredecessor
    internalBinaryWrite(
        message: SynchronizerPredecessor,
        writer: IBinaryWriter,
        options: BinaryWriteOptions
    ): IBinaryWriter
}
/**
 * @generated MessageType for protobuf message com.digitalasset.canton.topology.admin.v30.SynchronizerPredecessor
 */
export declare const SynchronizerPredecessor: SynchronizerPredecessor$Type
export {}
//# sourceMappingURL=common.d.ts.map

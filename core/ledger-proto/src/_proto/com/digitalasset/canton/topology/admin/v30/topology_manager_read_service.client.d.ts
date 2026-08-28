import type { RpcTransport } from '@protobuf-ts/runtime-rpc'
import type { ServiceInfo } from '@protobuf-ts/runtime-rpc'
import type { SequencerLsuStateResponse } from './topology_manager_read_service.js'
import type { SequencerLsuStateRequest } from './topology_manager_read_service.js'
import type { GenesisStateV2Response } from './topology_manager_read_service.js'
import type { GenesisStateV2Request } from './topology_manager_read_service.js'
import type { GenesisStateResponse } from './topology_manager_read_service.js'
import type { GenesisStateRequest } from './topology_manager_read_service.js'
import type { ExportTopologySnapshotV2Response } from './topology_manager_read_service.js'
import type { ExportTopologySnapshotV2Request } from './topology_manager_read_service.js'
import type { ExportTopologySnapshotResponse } from './topology_manager_read_service.js'
import type { ExportTopologySnapshotRequest } from './topology_manager_read_service.js'
import type { ServerStreamingCall } from '@protobuf-ts/runtime-rpc'
import type { ListAllV2Response } from './topology_manager_read_service.js'
import type { ListAllV2Request } from './topology_manager_read_service.js'
import type { ListAllResponse } from './topology_manager_read_service.js'
import type { ListAllRequest } from './topology_manager_read_service.js'
import type { ListAvailableStoresResponse } from './topology_manager_read_service.js'
import type { ListAvailableStoresRequest } from './topology_manager_read_service.js'
import type { ListLsuSequencerConnectionSuccessorResponse } from './topology_manager_read_service.js'
import type { ListLsuSequencerConnectionSuccessorRequest } from './topology_manager_read_service.js'
import type { ListLsuAnnouncementResponse } from './topology_manager_read_service.js'
import type { ListLsuAnnouncementRequest } from './topology_manager_read_service.js'
import type { ListSequencerSynchronizerStateResponse } from './topology_manager_read_service.js'
import type { ListSequencerSynchronizerStateRequest } from './topology_manager_read_service.js'
import type { ListMediatorSynchronizerStateResponse } from './topology_manager_read_service.js'
import type { ListMediatorSynchronizerStateRequest } from './topology_manager_read_service.js'
import type { ListSequencingParametersStateResponse } from './topology_manager_read_service.js'
import type { ListSequencingParametersStateRequest } from './topology_manager_read_service.js'
import type { ListSynchronizerParametersStateResponse } from './topology_manager_read_service.js'
import type { ListSynchronizerParametersStateRequest } from './topology_manager_read_service.js'
import type { ListPartyToParticipantResponse } from './topology_manager_read_service.js'
import type { ListPartyToParticipantRequest } from './topology_manager_read_service.js'
import type { ListVettedPackagesResponse } from './topology_manager_read_service.js'
import type { ListVettedPackagesRequest } from './topology_manager_read_service.js'
import type { ListPartyHostingLimitsResponse } from './topology_manager_read_service.js'
import type { ListPartyHostingLimitsRequest } from './topology_manager_read_service.js'
import type { ListParticipantSynchronizerPermissionResponse } from './topology_manager_read_service.js'
import type { ListParticipantSynchronizerPermissionRequest } from './topology_manager_read_service.js'
import type { ListSynchronizerTrustCertificateResponse } from './topology_manager_read_service.js'
import type { ListSynchronizerTrustCertificateRequest } from './topology_manager_read_service.js'
import type { ListPartyToKeyMappingResponse } from './topology_manager_read_service.js'
import type { ListPartyToKeyMappingRequest } from './topology_manager_read_service.js'
import type { ListOwnerToKeyMappingResponse } from './topology_manager_read_service.js'
import type { ListOwnerToKeyMappingRequest } from './topology_manager_read_service.js'
import type { ListDecentralizedNamespaceDefinitionResponse } from './topology_manager_read_service.js'
import type { ListDecentralizedNamespaceDefinitionRequest } from './topology_manager_read_service.js'
import type { ListNamespaceDelegationResponse } from './topology_manager_read_service.js'
import type { ListNamespaceDelegationRequest } from './topology_manager_read_service.js'
import type { UnaryCall } from '@protobuf-ts/runtime-rpc'
import type { RpcOptions } from '@protobuf-ts/runtime-rpc'
/**
 * @generated from protobuf service com.digitalasset.canton.topology.admin.v30.TopologyManagerReadService
 */
export interface ITopologyManagerReadServiceClient {
    /**
     * @generated from protobuf rpc: ListNamespaceDelegation
     */
    listNamespaceDelegation(
        input: ListNamespaceDelegationRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListNamespaceDelegationRequest,
        ListNamespaceDelegationResponse
    >
    /**
     * @generated from protobuf rpc: ListDecentralizedNamespaceDefinition
     */
    listDecentralizedNamespaceDefinition(
        input: ListDecentralizedNamespaceDefinitionRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListDecentralizedNamespaceDefinitionRequest,
        ListDecentralizedNamespaceDefinitionResponse
    >
    /**
     * @generated from protobuf rpc: ListOwnerToKeyMapping
     */
    listOwnerToKeyMapping(
        input: ListOwnerToKeyMappingRequest,
        options?: RpcOptions
    ): UnaryCall<ListOwnerToKeyMappingRequest, ListOwnerToKeyMappingResponse>
    /**
     * Note that PartyToKeyMapping is deprecated in favor of PartyToParticipant
     *
     * @generated from protobuf rpc: ListPartyToKeyMapping
     */
    listPartyToKeyMapping(
        input: ListPartyToKeyMappingRequest,
        options?: RpcOptions
    ): UnaryCall<ListPartyToKeyMappingRequest, ListPartyToKeyMappingResponse>
    /**
     * @generated from protobuf rpc: ListSynchronizerTrustCertificate
     */
    listSynchronizerTrustCertificate(
        input: ListSynchronizerTrustCertificateRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListSynchronizerTrustCertificateRequest,
        ListSynchronizerTrustCertificateResponse
    >
    /**
     * @generated from protobuf rpc: ListParticipantSynchronizerPermission
     */
    listParticipantSynchronizerPermission(
        input: ListParticipantSynchronizerPermissionRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListParticipantSynchronizerPermissionRequest,
        ListParticipantSynchronizerPermissionResponse
    >
    /**
     * @generated from protobuf rpc: ListPartyHostingLimits
     */
    listPartyHostingLimits(
        input: ListPartyHostingLimitsRequest,
        options?: RpcOptions
    ): UnaryCall<ListPartyHostingLimitsRequest, ListPartyHostingLimitsResponse>
    /**
     * @generated from protobuf rpc: ListVettedPackages
     */
    listVettedPackages(
        input: ListVettedPackagesRequest,
        options?: RpcOptions
    ): UnaryCall<ListVettedPackagesRequest, ListVettedPackagesResponse>
    /**
     * @generated from protobuf rpc: ListPartyToParticipant
     */
    listPartyToParticipant(
        input: ListPartyToParticipantRequest,
        options?: RpcOptions
    ): UnaryCall<ListPartyToParticipantRequest, ListPartyToParticipantResponse>
    /**
     * @generated from protobuf rpc: ListSynchronizerParametersState
     */
    listSynchronizerParametersState(
        input: ListSynchronizerParametersStateRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListSynchronizerParametersStateRequest,
        ListSynchronizerParametersStateResponse
    >
    /**
     * @generated from protobuf rpc: ListSequencingParametersState
     */
    listSequencingParametersState(
        input: ListSequencingParametersStateRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListSequencingParametersStateRequest,
        ListSequencingParametersStateResponse
    >
    /**
     * @generated from protobuf rpc: ListMediatorSynchronizerState
     */
    listMediatorSynchronizerState(
        input: ListMediatorSynchronizerStateRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListMediatorSynchronizerStateRequest,
        ListMediatorSynchronizerStateResponse
    >
    /**
     * @generated from protobuf rpc: ListSequencerSynchronizerState
     */
    listSequencerSynchronizerState(
        input: ListSequencerSynchronizerStateRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListSequencerSynchronizerStateRequest,
        ListSequencerSynchronizerStateResponse
    >
    /**
     * @generated from protobuf rpc: ListLsuAnnouncement
     */
    listLsuAnnouncement(
        input: ListLsuAnnouncementRequest,
        options?: RpcOptions
    ): UnaryCall<ListLsuAnnouncementRequest, ListLsuAnnouncementResponse>
    /**
     * @generated from protobuf rpc: ListLsuSequencerConnectionSuccessor
     */
    listLsuSequencerConnectionSuccessor(
        input: ListLsuSequencerConnectionSuccessorRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListLsuSequencerConnectionSuccessorRequest,
        ListLsuSequencerConnectionSuccessorResponse
    >
    /**
     * @generated from protobuf rpc: ListAvailableStores
     */
    listAvailableStores(
        input: ListAvailableStoresRequest,
        options?: RpcOptions
    ): UnaryCall<ListAvailableStoresRequest, ListAvailableStoresResponse>
    /**
     * @deprecated
     * @generated from protobuf rpc: ListAll
     */
    listAll(
        input: ListAllRequest,
        options?: RpcOptions
    ): UnaryCall<ListAllRequest, ListAllResponse>
    /**
     * @generated from protobuf rpc: ListAllV2
     */
    listAllV2(
        input: ListAllV2Request,
        options?: RpcOptions
    ): UnaryCall<ListAllV2Request, ListAllV2Response>
    /**
     * Deprecated in favor of ExportTopologySnapshotV2
     *
     * @deprecated
     * @generated from protobuf rpc: ExportTopologySnapshot
     */
    exportTopologySnapshot(
        input: ExportTopologySnapshotRequest,
        options?: RpcOptions
    ): ServerStreamingCall<
        ExportTopologySnapshotRequest,
        ExportTopologySnapshotResponse
    >
    /**
     * @generated from protobuf rpc: ExportTopologySnapshotV2
     */
    exportTopologySnapshotV2(
        input: ExportTopologySnapshotV2Request,
        options?: RpcOptions
    ): ServerStreamingCall<
        ExportTopologySnapshotV2Request,
        ExportTopologySnapshotV2Response
    >
    /**
     * Fetch the genesis topology state.
     * The returned bytestring can be used directly to initialize a sequencer.
     * Deprecated in favor of GenesisStateV2
     *
     * @deprecated
     * @generated from protobuf rpc: GenesisState
     */
    genesisState(
        input: GenesisStateRequest,
        options?: RpcOptions
    ): ServerStreamingCall<GenesisStateRequest, GenesisStateResponse>
    /**
     * @generated from protobuf rpc: GenesisStateV2
     */
    genesisStateV2(
        input: GenesisStateV2Request,
        options?: RpcOptions
    ): ServerStreamingCall<GenesisStateV2Request, GenesisStateV2Response>
    /**
     * Fetch the topology state
     * The returned bytestring can be used directly to initialize a successor sequencer
     *
     * @generated from protobuf rpc: SequencerLsuState
     */
    sequencerLsuState(
        input: SequencerLsuStateRequest,
        options?: RpcOptions
    ): ServerStreamingCall<SequencerLsuStateRequest, SequencerLsuStateResponse>
}
/**
 * @generated from protobuf service com.digitalasset.canton.topology.admin.v30.TopologyManagerReadService
 */
export declare class TopologyManagerReadServiceClient
    implements ITopologyManagerReadServiceClient, ServiceInfo
{
    private readonly _transport
    typeName: string
    methods: import('@protobuf-ts/runtime-rpc').MethodInfo<any, any>[]
    options: {
        [extensionName: string]: import('@protobuf-ts/runtime').JsonValue
    }
    constructor(_transport: RpcTransport)
    /**
     * @generated from protobuf rpc: ListNamespaceDelegation
     */
    listNamespaceDelegation(
        input: ListNamespaceDelegationRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListNamespaceDelegationRequest,
        ListNamespaceDelegationResponse
    >
    /**
     * @generated from protobuf rpc: ListDecentralizedNamespaceDefinition
     */
    listDecentralizedNamespaceDefinition(
        input: ListDecentralizedNamespaceDefinitionRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListDecentralizedNamespaceDefinitionRequest,
        ListDecentralizedNamespaceDefinitionResponse
    >
    /**
     * @generated from protobuf rpc: ListOwnerToKeyMapping
     */
    listOwnerToKeyMapping(
        input: ListOwnerToKeyMappingRequest,
        options?: RpcOptions
    ): UnaryCall<ListOwnerToKeyMappingRequest, ListOwnerToKeyMappingResponse>
    /**
     * Note that PartyToKeyMapping is deprecated in favor of PartyToParticipant
     *
     * @generated from protobuf rpc: ListPartyToKeyMapping
     */
    listPartyToKeyMapping(
        input: ListPartyToKeyMappingRequest,
        options?: RpcOptions
    ): UnaryCall<ListPartyToKeyMappingRequest, ListPartyToKeyMappingResponse>
    /**
     * @generated from protobuf rpc: ListSynchronizerTrustCertificate
     */
    listSynchronizerTrustCertificate(
        input: ListSynchronizerTrustCertificateRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListSynchronizerTrustCertificateRequest,
        ListSynchronizerTrustCertificateResponse
    >
    /**
     * @generated from protobuf rpc: ListParticipantSynchronizerPermission
     */
    listParticipantSynchronizerPermission(
        input: ListParticipantSynchronizerPermissionRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListParticipantSynchronizerPermissionRequest,
        ListParticipantSynchronizerPermissionResponse
    >
    /**
     * @generated from protobuf rpc: ListPartyHostingLimits
     */
    listPartyHostingLimits(
        input: ListPartyHostingLimitsRequest,
        options?: RpcOptions
    ): UnaryCall<ListPartyHostingLimitsRequest, ListPartyHostingLimitsResponse>
    /**
     * @generated from protobuf rpc: ListVettedPackages
     */
    listVettedPackages(
        input: ListVettedPackagesRequest,
        options?: RpcOptions
    ): UnaryCall<ListVettedPackagesRequest, ListVettedPackagesResponse>
    /**
     * @generated from protobuf rpc: ListPartyToParticipant
     */
    listPartyToParticipant(
        input: ListPartyToParticipantRequest,
        options?: RpcOptions
    ): UnaryCall<ListPartyToParticipantRequest, ListPartyToParticipantResponse>
    /**
     * @generated from protobuf rpc: ListSynchronizerParametersState
     */
    listSynchronizerParametersState(
        input: ListSynchronizerParametersStateRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListSynchronizerParametersStateRequest,
        ListSynchronizerParametersStateResponse
    >
    /**
     * @generated from protobuf rpc: ListSequencingParametersState
     */
    listSequencingParametersState(
        input: ListSequencingParametersStateRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListSequencingParametersStateRequest,
        ListSequencingParametersStateResponse
    >
    /**
     * @generated from protobuf rpc: ListMediatorSynchronizerState
     */
    listMediatorSynchronizerState(
        input: ListMediatorSynchronizerStateRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListMediatorSynchronizerStateRequest,
        ListMediatorSynchronizerStateResponse
    >
    /**
     * @generated from protobuf rpc: ListSequencerSynchronizerState
     */
    listSequencerSynchronizerState(
        input: ListSequencerSynchronizerStateRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListSequencerSynchronizerStateRequest,
        ListSequencerSynchronizerStateResponse
    >
    /**
     * @generated from protobuf rpc: ListLsuAnnouncement
     */
    listLsuAnnouncement(
        input: ListLsuAnnouncementRequest,
        options?: RpcOptions
    ): UnaryCall<ListLsuAnnouncementRequest, ListLsuAnnouncementResponse>
    /**
     * @generated from protobuf rpc: ListLsuSequencerConnectionSuccessor
     */
    listLsuSequencerConnectionSuccessor(
        input: ListLsuSequencerConnectionSuccessorRequest,
        options?: RpcOptions
    ): UnaryCall<
        ListLsuSequencerConnectionSuccessorRequest,
        ListLsuSequencerConnectionSuccessorResponse
    >
    /**
     * @generated from protobuf rpc: ListAvailableStores
     */
    listAvailableStores(
        input: ListAvailableStoresRequest,
        options?: RpcOptions
    ): UnaryCall<ListAvailableStoresRequest, ListAvailableStoresResponse>
    /**
     * @deprecated
     * @generated from protobuf rpc: ListAll
     */
    listAll(
        input: ListAllRequest,
        options?: RpcOptions
    ): UnaryCall<ListAllRequest, ListAllResponse>
    /**
     * @generated from protobuf rpc: ListAllV2
     */
    listAllV2(
        input: ListAllV2Request,
        options?: RpcOptions
    ): UnaryCall<ListAllV2Request, ListAllV2Response>
    /**
     * Deprecated in favor of ExportTopologySnapshotV2
     *
     * @deprecated
     * @generated from protobuf rpc: ExportTopologySnapshot
     */
    exportTopologySnapshot(
        input: ExportTopologySnapshotRequest,
        options?: RpcOptions
    ): ServerStreamingCall<
        ExportTopologySnapshotRequest,
        ExportTopologySnapshotResponse
    >
    /**
     * @generated from protobuf rpc: ExportTopologySnapshotV2
     */
    exportTopologySnapshotV2(
        input: ExportTopologySnapshotV2Request,
        options?: RpcOptions
    ): ServerStreamingCall<
        ExportTopologySnapshotV2Request,
        ExportTopologySnapshotV2Response
    >
    /**
     * Fetch the genesis topology state.
     * The returned bytestring can be used directly to initialize a sequencer.
     * Deprecated in favor of GenesisStateV2
     *
     * @deprecated
     * @generated from protobuf rpc: GenesisState
     */
    genesisState(
        input: GenesisStateRequest,
        options?: RpcOptions
    ): ServerStreamingCall<GenesisStateRequest, GenesisStateResponse>
    /**
     * @generated from protobuf rpc: GenesisStateV2
     */
    genesisStateV2(
        input: GenesisStateV2Request,
        options?: RpcOptions
    ): ServerStreamingCall<GenesisStateV2Request, GenesisStateV2Response>
    /**
     * Fetch the topology state
     * The returned bytestring can be used directly to initialize a successor sequencer
     *
     * @generated from protobuf rpc: SequencerLsuState
     */
    sequencerLsuState(
        input: SequencerLsuStateRequest,
        options?: RpcOptions
    ): ServerStreamingCall<SequencerLsuStateRequest, SequencerLsuStateResponse>
}
//# sourceMappingURL=topology_manager_read_service.client.d.ts.map

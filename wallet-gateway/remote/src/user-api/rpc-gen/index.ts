// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { AddNetwork } from './typings.js'
import type { RemoveNetwork } from './typings.js'
import type { ListNetworks } from './typings.js'
import type { GetNetwork } from './typings.js'
import type { SelfSignedAccessToken } from './typings.js'
import type { AddIdp } from './typings.js'
import type { RemoveIdp } from './typings.js'
import type { ListIdps } from './typings.js'
import type { CreateWallet } from './typings.js'
import type { AllocatePartyForWallet } from './typings.js'
import type { ImportParty } from './typings.js'
import type { SetPrimaryWallet } from './typings.js'
import type { RemoveWallet } from './typings.js'
import type { ListWallets } from './typings.js'
import type { SyncWallets } from './typings.js'
import type { IsWalletSyncNeeded } from './typings.js'
import type { Sign } from './typings.js'
import type { SignMessage } from './typings.js'
import type { GetMessageToSign } from './typings.js'
import type { ListMessagesToSign } from './typings.js'
import type { DeleteMessageToSign } from './typings.js'
import type { SignTopologyTransactions } from './typings.js'
import type { SignPreparedTransaction } from './typings.js'
import type { GetTopologyBundleToSign } from './typings.js'
import type { ListTopologyBundlesToSign } from './typings.js'
import type { DeleteTopologyBundleToSign } from './typings.js'
import type { GetPreparedTransactionToSign } from './typings.js'
import type { DeletePreparedTransactionToSign } from './typings.js'
import type { Execute } from './typings.js'
import type { AddSession } from './typings.js'
import type { RemoveSession } from './typings.js'
import type { ListSessions } from './typings.js'
import type { GetTransaction } from './typings.js'
import type { ListTransactions } from './typings.js'
import type { DeleteTransaction } from './typings.js'
import type { GetUser } from './typings.js'
import type { GenerateApiKey } from './typings.js'
import type { ListApiKeys } from './typings.js'
import type { RemoveApiKey } from './typings.js'
import type { ListSigningProviderKeys } from './typings.js'
import type { GetWallet } from './typings.js'
import type { ChangeSigningProvider } from './typings.js'

export type Methods = {
    addNetwork: AddNetwork
    removeNetwork: RemoveNetwork
    listNetworks: ListNetworks
    getNetwork: GetNetwork
    selfSignedAccessToken: SelfSignedAccessToken
    addIdp: AddIdp
    removeIdp: RemoveIdp
    listIdps: ListIdps
    createWallet: CreateWallet
    allocatePartyForWallet: AllocatePartyForWallet
    importParty: ImportParty
    setPrimaryWallet: SetPrimaryWallet
    removeWallet: RemoveWallet
    listWallets: ListWallets
    syncWallets: SyncWallets
    isWalletSyncNeeded: IsWalletSyncNeeded
    sign: Sign
    signMessage: SignMessage
    getMessageToSign: GetMessageToSign
    listMessagesToSign: ListMessagesToSign
    deleteMessageToSign: DeleteMessageToSign
    signTopologyTransactions: SignTopologyTransactions
    signPreparedTransaction: SignPreparedTransaction
    getTopologyBundleToSign: GetTopologyBundleToSign
    listTopologyBundlesToSign: ListTopologyBundlesToSign
    deleteTopologyBundleToSign: DeleteTopologyBundleToSign
    getPreparedTransactionToSign: GetPreparedTransactionToSign
    deletePreparedTransactionToSign: DeletePreparedTransactionToSign
    execute: Execute
    addSession: AddSession
    removeSession: RemoveSession
    listSessions: ListSessions
    getTransaction: GetTransaction
    listTransactions: ListTransactions
    deleteTransaction: DeleteTransaction
    getUser: GetUser
    generateApiKey: GenerateApiKey
    listApiKeys: ListApiKeys
    removeApiKey: RemoveApiKey
    listSigningProviderKeys: ListSigningProviderKeys
    getWallet: GetWallet
    changeSigningProvider: ChangeSigningProvider
}

function buildController(methods: Methods) {
    return {
        addNetwork: methods.addNetwork,
        removeNetwork: methods.removeNetwork,
        listNetworks: methods.listNetworks,
        getNetwork: methods.getNetwork,
        selfSignedAccessToken: methods.selfSignedAccessToken,
        addIdp: methods.addIdp,
        removeIdp: methods.removeIdp,
        listIdps: methods.listIdps,
        createWallet: methods.createWallet,
        allocatePartyForWallet: methods.allocatePartyForWallet,
        importParty: methods.importParty,
        setPrimaryWallet: methods.setPrimaryWallet,
        removeWallet: methods.removeWallet,
        listWallets: methods.listWallets,
        syncWallets: methods.syncWallets,
        isWalletSyncNeeded: methods.isWalletSyncNeeded,
        sign: methods.sign,
        signMessage: methods.signMessage,
        getMessageToSign: methods.getMessageToSign,
        listMessagesToSign: methods.listMessagesToSign,
        deleteMessageToSign: methods.deleteMessageToSign,
        signTopologyTransactions: methods.signTopologyTransactions,
        signPreparedTransaction: methods.signPreparedTransaction,
        getTopologyBundleToSign: methods.getTopologyBundleToSign,
        listTopologyBundlesToSign: methods.listTopologyBundlesToSign,
        deleteTopologyBundleToSign: methods.deleteTopologyBundleToSign,
        getPreparedTransactionToSign: methods.getPreparedTransactionToSign,
        deletePreparedTransactionToSign:
            methods.deletePreparedTransactionToSign,
        execute: methods.execute,
        addSession: methods.addSession,
        removeSession: methods.removeSession,
        listSessions: methods.listSessions,
        getTransaction: methods.getTransaction,
        listTransactions: methods.listTransactions,
        deleteTransaction: methods.deleteTransaction,
        getUser: methods.getUser,
        generateApiKey: methods.generateApiKey,
        listApiKeys: methods.listApiKeys,
        removeApiKey: methods.removeApiKey,
        listSigningProviderKeys: methods.listSigningProviderKeys,
        getWallet: methods.getWallet,
        changeSigningProvider: methods.changeSigningProvider,
    }
}

export default buildController

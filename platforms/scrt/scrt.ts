/*
  Fadroma Platform Package for Secret Network
  Copyright (C) 2022 Hack.bg

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

import * as Fadroma  from '@fadroma/client'
import * as SecretJS from 'secretjs'

export type ScrtGrpcTxResult = SecretJS.Tx

import { randomBytes } from '@hackbg/formati'
import { getFromEnv } from '@hackbg/konfizi'

/** Environment settings for Secret Network API
  * that are common between gRPC and Amino implementations. */
export interface ScrtConfig {
  scrtAgentName:      string|null
  scrtAgentAddress:   string|null
  scrtAgentMnemonic:  string|null
  scrtMainnetChainId: string
  scrtTestnetChainId: string
}

/** Base class for both implementations of Secret Network API (gRPC and Amino) */
export abstract class Scrt extends Fadroma.Chain {

  defaultDenom    = Scrt.defaultDenom
  isSecretNetwork = true

  static defaultMainnetChainId: string = 'secret-4'
  static defaultTestnetChainId: string = 'pulsar-2'
  static defaultDenom:          string = 'uscrt'

  static gas = (amount: Fadroma.Uint128|number) => new Fadroma.Fee(amount, this.defaultDenom)

  static defaultFees  = {
    upload: this.gas(4000000),
    init:   this.gas(1000000),
    exec:   this.gas(1000000),
    send:   this.gas( 500000),
  }

  static Agent: Fadroma.AgentCtor<ScrtAgent>
         Agent: Fadroma.AgentCtor<ScrtAgent> = Scrt.Agent
 
}

/** May contain configuration options that are common betweeen gRPC and Amino implementations. */
export interface ScrtAgentOpts extends Fadroma.AgentOpts {
  legacy:  boolean
  keyPair: unknown
}

/** Base class for both implementations of Secret Network API (gRPC and Amino) */
export abstract class ScrtAgent extends Fadroma.Agent {

  fees = Scrt.defaultFees

  static Bundle: Fadroma.BundleCtor<ScrtBundle>
         Bundle: Fadroma.BundleCtor<ScrtBundle> = ScrtAgent.Bundle

  static async create (chain: Scrt, options: Partial<ScrtAgentOpts> = {}): Promise<ScrtAgent> {
    if (options?.legacy) {
      throw Errors.UseOtherLib()
    } else {
      return await ScrtGrpcAgent.create(chain, options) as ScrtAgent
    }
  }
 
}

//@ts-ignore
Scrt.Agent = ScrtAgent

/** Base class for transaction-bundling Agent for both Secret Network implementations. */
export abstract class ScrtBundle extends Fadroma.Bundle {}

//@ts-ignore
Scrt.Agent.Bundle = ScrtBundle

/** gRPC-specific Secret Network settings. */
export interface ScrtGrpcConfig extends ScrtConfig {
  scrtMainnetGrpcUrl: string|null
  scrtTestnetGrpcUrl: string|null
}

/** The Secret Network, accessed via gRPC API. */
export class ScrtGrpc extends Scrt {

  /** Values of FADROMA_CHAIN provided by the ScrtGrpc implementation.
    * Devnets and mocknets are defined downstream in @fadroma/connect */
  static Chains = {
    async 'ScrtGrpcMainnet' (config: ScrtGrpcConfig) {
      const mode = Fadroma.ChainMode.Mainnet
      const id   = config.scrtMainnetChainId ?? Scrt.defaultMainnetChainId
      const url  = config.scrtMainnetGrpcUrl || ScrtGrpc.defaultMainnetGrpcUrl
      return new ScrtGrpc(id, { url, mode })
    },
    async 'ScrtGrpcTestnet' (config: ScrtGrpcConfig) {
      const mode = Fadroma.ChainMode.Testnet
      const id   = config.scrtTestnetChainId ?? Scrt.defaultTestnetChainId
      const url  = config.scrtTestnetGrpcUrl || ScrtGrpc.defaultTestnetGrpcUrl
      return new ScrtGrpc(id, { url, mode })
    },
  }

  /** Get configuration from the environment. */
  static getConfig = function getScrtGrpcConfig (
    cwd: string,
    env: Record<string, string> = {}
  ): ScrtGrpcConfig {
    const { Str, Bool } = getFromEnv(env)
    return {
      scrtAgentName:       Str('SCRT_AGENT_NAME',        ()=>null),
      scrtAgentAddress:    Str('SCRT_AGENT_ADDRESS',     ()=>null),
      scrtAgentMnemonic:   Str('SCRT_AGENT_MNEMONIC',    ()=>null),
      scrtMainnetChainId:  Str('SCRT_MAINNET_CHAIN_ID',  ()=>Scrt.defaultMainnetChainId),
      scrtMainnetGrpcUrl:  Str('SCRT_MAINNET_GRPC_URL',  ()=>ScrtGrpc.defaultMainnetGrpcUrl),
      scrtTestnetChainId:  Str('SCRT_TESTNET_CHAIN_ID',  ()=>Scrt.defaultTestnetChainId),
      scrtTestnetGrpcUrl:  Str('SCRT_TESTNET_GRPC_URL',  ()=>ScrtGrpc.defaultTestnetGrpcUrl),
    }
  }

  static defaultMainnetGrpcUrl: string = 'https://secret-4.api.trivium.network:9091'
  static defaultTestnetGrpcUrl: string = 'https://testnet-web-rpc.roninventures.io'

  static Agent: Fadroma.AgentCtor<ScrtGrpcAgent>
         Agent: Fadroma.AgentCtor<ScrtGrpcAgent> = ScrtGrpc.Agent

  api: Promise<SecretJS.SecretNetworkClient> =
    SecretJS.SecretNetworkClient.create({ chainId: this.id, grpcWebUrl: this.url })

  async getBalance (denom = this.defaultDenom, address: Fadroma.Address) {
    const response = await (await this.api).query.bank.balance({ address, denom })
    return response.balance!.amount
  }

  async getLabel (address: string): Promise<string> {
    const { ContractInfo: { label } } = await (await this.api).query.compute.contractInfo(address)
    return label
  }

  async getCodeId (address: string): Promise<string> {
    const { ContractInfo: { codeId } } = await (await this.api).query.compute.contractInfo(address)
    return codeId
  }

  async getHash (address: string|number): Promise<string> {
    if (typeof address === 'number') {
      return await (await this.api).query.compute.codeHash(address)
    } else {
      return await (await this.api).query.compute.contractCodeHash(address)
    }
  }

  async query <U> (instance: Fadroma.Instance, query: Fadroma.Message): Promise<U> {
    throw new Error('TODO: Scrt#query: use same method on agent')
  }

  get block () {
    return this.api.then(api=>api.query.tendermint.getLatestBlock({}))
  }

  get height () {
    return this.block.then(block=>Number(block.block?.header?.height))
  }

}

/** gRPC-specific configuration options. */
export interface ScrtGrpcAgentOpts extends ScrtAgentOpts {
  wallet:  SecretJS.Wallet
  url:     string
  api:     SecretJS.SecretNetworkClient
}

export class ScrtGrpcAgent extends ScrtAgent {

  static Bundle: Fadroma.BundleCtor<ScrtBundle>
         Bundle: Fadroma.BundleCtor<ScrtBundle> = ScrtGrpcAgent.Bundle

  static async create (
    chain:   Scrt,
    options: Partial<ScrtGrpcAgentOpts>
  ): Promise<ScrtGrpcAgent> {

    const { mnemonic, keyPair, address } = options

    let { wallet } = options

    if (!wallet) {
      if (mnemonic) {
        wallet = new SecretJS.Wallet(mnemonic)
      } else {
        throw Errors.WalletMnemonic()
      }
    }

    if (keyPair) {
      Warnings.IgnoringKeyPair()
      delete options.keyPair
    }

    const api = await SecretJS.SecretNetworkClient.create({
      chainId:    chain.id,
      grpcWebUrl: chain.url || "http://rpc.pulsar.griptapejs.com:9091",
      wallet,
      walletAddress: wallet.address || address
    })

    return new ScrtGrpcAgent(chain as ScrtGrpc, {
      legacy: false,
      ...options,
      wallet,
      api,
    })

  }

  constructor (chain: ScrtGrpc, options: Partial<ScrtGrpcAgentOpts>) {
    super(chain as Fadroma.Chain, options)
    if (!options.wallet) throw Errors.NoWallet()
    if (!options.api)    throw Errors.NoAPI()
    this.wallet  = options.wallet
    this.api     = options.api
    this.address = this.wallet?.address
  }

  async instantiateMany (configs: [Fadroma.Template, string, Fadroma.Message][] = []) {
    // instantiate multiple contracts in a bundle:
    const instances = await this.bundle().wrap(async bundle=>{
      await bundle.instantiateMany(configs)
    })
    // add code hashes to them:
    for (const i in configs) {
      const [{ codeId, codeHash }, label] = configs[i]
      const instance = instances[i]
      if (instance) {
        instance.codeId   = codeId
        instance.codeHash = codeHash
        instance.label    = label
      }
    }
    return instances
  }

  wallet:  SecretJS.Wallet

  api:     SecretJS.SecretNetworkClient

  get account () {
    return this.api.query.auth.account({ address: this.address })
  }

  get balance () {
    return this.getBalance(this.defaultDenom, this.address)
  }

  async getBalance (denom = this.defaultDenom, address: Fadroma.Address) {
    const response = await this.api.query.bank.balance({ address, denom })
    return response.balance!.amount
  }

  async send (to: Fadroma.Address, amounts: Fadroma.ICoin[], opts?: any) {
    return this.api.tx.bank.send({
      fromAddress: this.address,
      toAddress:   to,
      amount:      amounts
    }, {
      gasLimit: opts?.gas?.gas
    })
  }

  async sendMany (outputs: never, opts: never) {
    throw new Error('ScrtAgent#sendMany: not implemented')
  }

  async getLabel (address: string): Promise<string> {
    const { ContractInfo: { label } } = await this.api.query.compute.contractInfo(address)
    return label
  }

  async getCodeId (address: string): Promise<string> {
    const { ContractInfo: { codeId } } = await this.api.query.compute.contractInfo(address)
    return codeId
  }

  async getHash (address: string): Promise<string> {
    return await this.api.query.compute.contractCodeHash(address)
  }

  // @ts-ignore
  async query <U> (instance: Fadroma.Instance, query: Fadroma.Message): Promise<U> {
    const { address: contractAddress, codeHash } = instance
    const args = { contractAddress, codeHash, query: query as Record<string, unknown> }
    // @ts-ignore
    return await this.api.query.compute.queryContract(args) as U
  }

  async upload (data: Uint8Array): Promise<Fadroma.Template> {
    type Log = { type: string, key: string }
    const sender     = this.address
    const args       = {sender, wasmByteCode: data, source: "", builder: ""}
    const gasLimit   = Number(Scrt.defaultFees.upload.amount[0].amount)
    const result     = await this.api.tx.compute.storeCode(args, { gasLimit })
    const findCodeId = (log: Log) => log.type === "message" && log.key === "code_id"
    const codeId     = result.arrayLog?.find(findCodeId)?.value
    const codeHash   = await this.api.query.compute.codeHash(Number(codeId))
    const chainId    = this.chain.id
    return new Fadroma.Template(
      undefined,
      codeHash,
      chainId,
      codeId,
      result.transactionHash
    )
  }

  async instantiate <T> (
    template: Fadroma.Template, label: Fadroma.Label, initMsg: T, initFunds = []
  ): Promise<Fadroma.Instance> {
    const { chainId, codeId, codeHash } = template
    if (chainId !== this.chain.id) throw Errors.AnotherChain()
    if (isNaN(Number(codeId)))     throw Errors.NoCodeId()
    const sender   = this.address
    const args     = { sender, codeId: Number(codeId), codeHash, initMsg, label, initFunds }
    const gasLimit = Number(Scrt.defaultFees.init.amount[0].amount)
    const result   = await this.api.tx.compute.instantiateContract(args, { gasLimit })
    if (result.arrayLog) {
      type Log = { type: string, key: string }
      const findAddr = (log: Log) => log.type === "message" && log.key === "contract_address"
      const address  = result.arrayLog.find(findAddr)?.value!
      return { initTx: result.transactionHash, chainId, codeId, codeHash, address, label, template }
    } else {
      throw Object.assign(
        new Error(`SecretRPCAgent#instantiate: ${result.rawLog}`), {
          jsonLog: result.jsonLog
        }
      )
    }
  }

  async execute (
    instance: Fadroma.Instance, msg: Fadroma.Message, opts: Fadroma.ExecOpts = {}
  ): Promise<ScrtGrpcTxResult> {
    const { address, codeHash } = instance
    const { send, memo, fee = this.fees.exec } = opts
    if (memo) Warnings.NoMemos()
    const result = await this.api.tx.compute.executeContract({
      sender:          this.address,
      contractAddress: address,
      codeHash,
      msg:             msg as Record<string, unknown>,
      sentFunds:       send
    }, {
      gasLimit: Number(fee.amount[0].amount)
    })
    // check error code as per https://grpc.github.io/grpc/core/md_doc_statuscodes.html
    if (result.code !== 0) {
      const error = `ScrtAgent#execute: gRPC error ${result.code}: ${result.rawLog}`
      // make the original result available on request
      const original = structuredClone(result)
      Object.defineProperty(result, "original", {
        enumerable: false,
        get () { return original }
      })
      // decode the values in the result
      //@ts-ignore
      result.txBytes = tryDecode(result.txBytes)
      for (const i in result.tx.signatures) {
        //@ts-ignore
        result.tx.signatures[i] = tryDecode(result.tx.signatures[i])
      }
      for (const event of result.events) {
        for (const attr of event.attributes) {
          //@ts-ignore
          try { attr.key   = tryDecode(attr.key)   } catch (e) {}
          //@ts-ignore
          try { attr.value = tryDecode(attr.value) } catch (e) {}
        }
      }
      throw Object.assign(new Error(error), result)
    }
    return result as ScrtGrpcTxResult
  }

}

/** Used to decode Uint8Array-represented UTF8 strings in TX responses. */
const decoder = new TextDecoder('utf-8', { fatal: true })

/** Marks a response field as non-UTF8 to prevent large binary arrays filling the console. */
export const nonUtf8 = Symbol('<binary data, see result.original for the raw Uint8Array>')

/** Decode binary response data or mark it as non-UTF8 */
const tryDecode = (data: Uint8Array): string|Symbol => {
  try {
    return decoder.decode(data)
  } catch (e) {
    return nonUtf8
  }
}

export class ScrtGrpcBundle extends ScrtBundle {

  async submit (memo = "") {
    this.assertCanSubmit()
    const msgs  = await this.buildForSubmit()
    const limit = Number(Scrt.defaultFees.exec.amount[0].amount)
    const gas   = msgs.length * limit
    try {
      const agent = this.agent as unknown as ScrtGrpcAgent
      const txResult = await agent.api.tx.broadcast(msgs, { gasLimit: gas })
      if (txResult.code !== 0) {
        const error = `ScrtBundle#execute: gRPC error ${txResult.code}: ${txResult.rawLog}`
        throw Object.assign(new Error(error), txResult)
      }
      const results = this.collectSubmitResults(msgs, txResult)
      return results
    } catch (err) {
      await this.handleSubmitError(err as Error)
    }
  }

  /** Format the messages for API v1 like secretjs and encrypt them. */
  protected async buildForSubmit () {
    const encrypted = await Promise.all(this.msgs.map(async ({init, exec})=>{
      if (init) {
        return new SecretJS.MsgInstantiateContract({
          sender:    init.sender,
          codeId:    init.codeId,
          codeHash:  init.codeHash,
          label:     init.label,
          initMsg:   init.msg,
          initFunds: init.funds,
        })
      }
      if (exec) {
        return new SecretJS.MsgExecuteContract({
          sender:          exec.sender,
          contractAddress: exec.contract,
          codeHash:        exec.codeHash,
          msg:             exec.msg,
          sentFunds:       exec.funds,
        })
      }
      throw 'unreachable'
    }))
    return encrypted
  }

  protected collectSubmitResults (
    msgs:     ScrtBundleMessage[],
    txResult: ScrtGrpcTxResult
  ): ScrtBundleResult[] {
    const results: ScrtBundleResult[] = []
    for (const i in msgs) {
      const msg = msgs[i]
      const result: Partial<ScrtBundleResult> = {}
      result.sender  = this.address
      result.tx      = txResult.transactionHash
      result.chainId = this.chain.id
      if (msg instanceof SecretJS.MsgInstantiateContract) {
        type Log = { msg: number, type: string, key: string }
        const findAddr = ({msg, type, key}: Log) =>
          msg  ==  Number(i) &&
          type === "message" &&
          key  === "contract_address"
        result.type    = 'wasm/MsgInstantiateContract'
        result.codeId  = msg.codeId
        result.label   = msg.label
        result.address = txResult.arrayLog?.find(findAddr)?.value
      }
      if (msg instanceof SecretJS.MsgExecuteContract) {
        result.type    = 'wasm/MsgExecuteContract'
        result.address = msg.contractAddress
      }
      results[Number(i)] = result as ScrtBundleResult
    }
    return results
  }

  protected async handleSubmitError (err: Error) {
    console.error('Submitting bundle failed:', err.message)
    console.error('Decrypting gRPC bundle errors is not implemented.')
    throw err
  }

  async save (name: never) {
    throw new Error('ScrtGrpcBundle#save: not implemented')
  }

}

ScrtGrpc.Agent       = ScrtGrpcAgent as Fadroma.AgentCtor<ScrtGrpcAgent>

ScrtGrpcAgent.Bundle = ScrtGrpcBundle

export interface ScrtBundleCtor <B extends ScrtBundle> {
  new (agent: ScrtAgent): B
}

export type ScrtBundleMessage =
  |SecretJS.MsgInstantiateContract
  |SecretJS.MsgExecuteContract<object>

export interface ScrtBundleResult {
  sender?:   Fadroma.Address
  tx:        Fadroma.TxHash
  type:      'wasm/MsgInstantiateContract'|'wasm/MsgExecuteContract'
  chainId:   Fadroma.ChainId
  codeId?:   Fadroma.CodeId
  codeHash?: Fadroma.CodeHash
  address?:  Fadroma.Address
  label?:    Fadroma.Label
}

/** Data used for creating a signature as per the SNIP-24 spec:
  * https://github.com/SecretFoundation/SNIPs/blob/master/SNIP-24.md#permit-content---stdsigndoc
  * This type is case sensitive! */
export interface SignDoc {
  readonly chain_id:       string;
  /** Always 0. */
  readonly account_number: string;
  /** Always 0. */
  readonly sequence:       string;
  /** Always 0 uscrt + 1 gas */
  readonly fee:            Fadroma.IFee;
  /** Always 1 message of type query_permit */
  readonly msgs:           readonly AminoMsg[];
  /** Always empty. */
  readonly memo:           string;
}

export function createSignDoc <T> (
  chain_id:   Fadroma.ChainId,
  permit_msg: T
) {
  return {
    chain_id,
    account_number: "0", // Must be 0
    sequence: "0", // Must be 0
    fee: {
      amount: [{ denom: "uscrt", amount: "0" }], // Must be 0 uscrt
      gas: "1", // Must be 1
    },
    msgs: [
      {
        type: "query_permit", // Must be "query_permit"
        value: permit_msg,
      },
    ],
    memo: "", // Must be empty
  }
}

export interface Signer {
  chain_id: Fadroma.ChainId
  address:  Fadroma.Address
  sign <T> (permit_msg: PermitAminoMsg<T>): Promise<Permit<T>>
}

export class KeplrSigner implements Signer {

  constructor (
    /** The id of the chain which permits will be signed for. */
    readonly chain_id: Fadroma.ChainId,
    /** The address which will do the signing and
      * which will be the address used by the contracts. */
    readonly address:  Fadroma.Address,
    /** Must be a pre-configured instance. */
    readonly keplr:    KeplrSigningHandle<any>
  ) {}

  async sign <T> (permit_msg: PermitAminoMsg<T>): Promise<Permit<T>> {

    const { signature } = await this.keplr.signAmino(
      this.chain_id,
      this.address,
      createSignDoc(this.chain_id, permit_msg),
      {
        preferNoSetFee: true,  // Fee must be 0, so hide it from the user
        preferNoSetMemo: true, // Memo must be empty, so hide it from the user
      }
    )

    return {
      params: {
        chain_id:       this.chain_id,
        allowed_tokens: permit_msg.allowed_tokens,
        permit_name:    permit_msg.permit_name,
        permissions:    permit_msg.permissions
      },
      signature
    }

  }

}

export interface KeplrSigningHandle <T> {
  signAmino (
    chain_id: Fadroma.ChainId,
    address:  Fadroma.Address,
    signDoc:  SignDoc,
    options: { preferNoSetFee: boolean, preferNoSetMemo: boolean }
  ): Promise<Permit<T>>
}

export interface Permit<T> {
  params: {
    permit_name:    string,
    allowed_tokens: Fadroma.Address[]
    chain_id:       string,
    permissions:    T[]
  },
  signature: Signature
}

// This type is case sensitive!
export interface Signature {
  readonly pub_key: Pubkey
  readonly signature: string
}

export interface Pubkey {
  /** Must be: `tendermint/PubKeySecp256k1` */
  readonly type: string
  readonly value: any
}

export interface AminoMsg {
  readonly type: string;
  readonly value: any;
}

/** Used as the `value` field of the {@link AminoMsg} type. */
export interface PermitAminoMsg<T> {
  permit_name:    string,
  allowed_tokens: Fadroma.Address[],
  permissions:    T[],
}

export type ViewingKey = string

export class ViewingKeyClient extends Fadroma.Client {

  async create (entropy = randomBytes(32).toString("hex")) {
    const msg    = { create_viewing_key: { entropy, padding: null } }
    let { data } = await this.execute(msg) as { data: Uint8Array|Uint8Array[] }
    if (data instanceof Uint8Array) data = [data]
    return data[0]
  }

  async set (key: unknown) {
    return this.execute({ set_viewing_key: { key } })
  }

}

const Errors = {
  UseOtherLib () {
    return new Error('Use @fadroma/scrt-amino')
  },
  WalletMnemonic () {
    return new Error('ScrtGrpcAgent: Can only be created from mnemonic or wallet+address')
  },
  AnotherChain () {
    return new Error('ScrtGrpcAgent: Tried to instantiate a contract that is uploaded to another chain')
  },
  NoWallet () {
    return new Error('ScrtGrpcAgent: no wallet')
  },
  NoAPI () {
    return new Error('ScrtGrpcAgent: no api')
  },
  NoAPIUrl () {
    return new Error('ScrtGrpc: no gRPC API URL')
  },
  NoCodeId () {
    return new Error("ScrtGrpcAgent: need code ID to instantiate contract")
  },
}

const Warnings = {
  IgnoringKeyPair () {
    console.warn('ScrtGrpcAgent: Created from mnemonic, ignoring keyPair')
  },
  NoMemos () {
    console.warn("ScrtGrpcAgent: Transaction memos are not supported in SecretJS RPC API")
  },
  NoDefaultAmino (envVar: string) {
    console.warn(
      "getScrtConfig: no default API endpoints are provided for legacy Amino mode." +
      (envVar ? `\nSet ${envVar} to provide yout known API endpoint.` : '')
    )
  }
}

/** Allow Scrt clients to be implemented with just `@fadroma/scrt` */
export * from '@fadroma/client'

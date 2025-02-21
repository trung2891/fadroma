import { Console, Error, Config, Chain, Agent, Bundle } from './cw-base'
import type { AgentClass, ClientClass, Uint128, Address, ChainId, AgentFees } from '@fadroma/agent'
import { Client, Fee, bindChainSupport } from '@fadroma/agent'
import type { CosmWasmClient } from '@hackbg/cosmjs-esm'

class OKP4Config extends Config {
  static defaultTestnetChainId: string =
    'okp4-nemeton-1'
  static defaultTestnetUrl: string =
    'https://okp4-testnet-rpc.polkachu.com/'
    //'https://okp4-testnet-api.polkachu.com/'
  testnetChainId: string = this.getString(
    'FADROMA_OKP4_TESTNET_CHAIN_ID',
    () => OKP4Config.defaultTestnetChainId)
  testnetUrl: string = this.getString(
    'FADROMA_OKP4_TESTNET_URL',
    () => OKP4Config.defaultTestnetUrl)
}

/** Code IDs for versions of Cognitarium contract. */
export const cognitariumCodeIds = [7]

/** Code IDs for versions of Objectarium contract. */
export const objectariumCodeIds = [4]

/** Code IDs for versions of Law Stone contract. */
export const lawStoneCodeIds = [5]

/** OKP4 chain. */
class OKP4Chain extends Chain {
  /** Default denomination of gas token. */
  static defaultDenom = 'uknow'
  /** @returns Fee in uscrt */
  static gas = (amount: Uint128|number) =>
    new Fee(amount, this.defaultDenom)
  /** Set permissive fees by default. */
  static defaultFees: AgentFees = {
    upload: this.gas(1000000),
    init:   this.gas(1000000),
    exec:   this.gas(1000000),
    send:   this.gas(1000000),
  }
  /** Default Agent class to use. */
  declare Agent: AgentClass<OKP4Agent>
  /** Logging handle. */
  log = new Console('OKP4Chain')
  /** Default denomination of gas token. */
  defaultDenom = OKP4Chain.defaultDenom

  constructor (options: Partial<OKP4Chain> & { config?: OKP4Config } = {
    config: new OKP4Config()
  }) {
    super(options)
  }

  /** Connect to OKP4 in testnet mode. */
  static testnet = (options: Partial<OKP4Chain> = {}): OKP4Chain => {
    const config = new OKP4Config()
    return super.testnet({
      id:  config.testnetChainId,
      url: config.testnetUrl,
      ...options||{},
    }) as OKP4Chain
  }

  /** Get clients for all Cognitarium instances,
    * keyed by address. */
  async cognitaria ({ map = true } = {}) {
    const { api } = await this.ready
    return await getContractsById(this.id, api, Cognitarium, cognitariumCodeIds, map)
  }

  /** Get clients for all Objectarium instances,
    * keyed by address. */
  async objectaria ({ map = true } = {}) {
    const { api } = await this.ready
    return await getContractsById(this.id, api, Objectarium, objectariumCodeIds, map)
  }

  /** Get clients for all Law Stone instances,
    * keyed by address. */
  async lawStones ({ map = true } = {}) {
    const { api } = await this.ready
    return await getContractsById(this.id, api, LawStone, lawStoneCodeIds, map)
  }
}

async function getContractsById <C extends Client> (
  chainId: ChainId,
  api: CosmWasmClient,
  $C: ClientClass<C>,
  ids: number[],
  map = true
): Promise<
  typeof map extends true ? Map<Address, C> : Record<Address, C>
> {
  const contracts = map ? new Map() : {}
  for (const codeId of ids) {
    const { checksum } = await api.getCodeDetails(codeId)
    const addresses = await api.getContracts(codeId)
    for (const address of addresses) {
      const contract = new $C({
        address,
        codeHash: checksum,
        codeId: String(codeId),
      } as Partial<C>)
      contract.meta.chainId = chainId
      if (map) {
        (contracts as Map<Address, C>).set(address, contract)
      } else {
        (contracts as Record<Address, C>)[address] = contract
      }
    }
  }
  return contracts
}

/** Agent for OKP4. */
class OKP4Agent extends Agent {
  /** Logging handle. */
  log = new Console('OKP4Agent')
  /** Chain on which this agent operates. */
  declare chain: OKP4Chain
  /** The coin type in the HD derivation path */
  declare coinType: number
  /** The bech32 prefix for the account's address  */
  declare bech32Prefix: string
  /** The account index in the HD derivation path */
  declare hdAccountIndex: number
  /** Transaction fees for this agent. */
  fees = OKP4Chain.defaultFees

  constructor (options: Partial<OKP4Agent> = {}) {
    super({
      ...options||{},
      coinType: 118,
      bech32Prefix: 'okp4',
      hdAccountIndex: 0
    })
    this.log.label = `${this.address??'(no address)'} @ ${this.chain?.id??'(no chain id)'}`
  }

  /** Get clients for all Cognitarium instances,
    * keyed by address. */
  async cognitaria ({ map = true } = {}) {
    return populateAgent(map, await this.chain.cognitaria({map}), this)
  }

  /** Get clients for all Objectarium instances,
    * keyed by address. */
  async objectaria ({ map = true } = {}) {
    return populateAgent(map, await this.chain.objectaria({map}), this)
  }

  /** Get clients for all Law Stone instances,
    * keyed by address. */
  async lawStones ({ map = true } = {}) {
    return populateAgent(map, await this.chain.lawStones({map}), this)
  }
}

function populateAgent <C extends Client> (
  map: boolean,
  contracts: typeof map extends true ? Map<Address, C> : Record<Address, C>,
  agent: OKP4Agent
) {
  const values = map
    ? (contracts as unknown as Map<Address, Cognitarium>).values()
    : Object.values(contracts)
  for (const contract of values) {
    contract.agent = agent
  }
  return contracts
}

/** Transaction bundle for OKP4. */
class OKP4Bundle extends Bundle {}

bindChainSupport(OKP4Chain, OKP4Agent, OKP4Bundle)
export { OKP4Config as Config, OKP4Chain as Chain, OKP4Agent as Agent, OKP4Bundle as Bundle }

/** Connect to OKP4 testnet. */
export const testnet = OKP4Chain.testnet

/** OKP4 triple store. */
export class Cognitarium extends Client {
  /** Create an init message for a cognitarium. */
  static init = (limits?: CognitariumLimits) =>
    ({ limits })
  /** Add data to this cognitarium. */
  insert = (format: CognitariumFormat, data: string) =>
    this.execute({ insert_data: { format, data } })
  /** Query data in this cognitarium. */
  select = (
    limit:    number,
    prefixes: CognitariumPrefix[],
    select:   CognitariumSelect[],
    where:    CognitariumWhere[]
  ) =>
    this.query({ select: { query: { limit, prefixes, select, where } } })
}

export type CognitariumLimits = {
  max_byte_size:                Uint128
  max_insert_data_byte_size:    Uint128
  max_insert_data_triple_count: Uint128
  max_query_limit:              number
  max_query_variable_count:     number
  max_triple_byte_size:         Uint128
  max_triple_count:             Uint128
}

export type CognitariumFormat = 'turtle'|'rdf_xml'|'n_triples'|'n_quads'

export type CognitariumPrefix = { prefix: string, namespace: string }

export type CognitariumSelect = { variable: string }

export type CognitariumWhere = {
  simple: {
    triple_pattern: {
      subject: { variable: string }
      predicate: { node: { named_node: string } }
      object: { variable: string }
    }
  }
}

/** OKP4 object store. */
export class Objectarium extends Client {
  /** Create an init message for an objectarium. */
  static init = (bucket: string) =>
    ({ bucket })
  store = (pin: boolean, data: string) =>
    this.execute({ store_object: { data, pin } })
  pin = (id: string) =>
    this.execute({ pin_object: { id } })
  unpin = (id: string) =>
    this.execute({ unpin_object: { id } })
  forget = (id: string) =>
    this.execute({ forget_object: { id } })
}

/** OKP4 rule engine. */
export class LawStone extends Client {
  /** Create an init message for a law stone. */
  static init = (storage_address: Address, program: string) =>
    ({ storage_address, program })
  /** Make a query against this law stone's program. */
  ask = (query: string) =>
    this.query({ ask: { query } })
  /** Permanently prevent this law stone from answering further queries. */
  break = () =>
    this.execute("break_stone")
}

import type { Agent, Address, CodeHash, Uint128, ICoin, ClientClass } from '@fadroma/agent'
import {
  Token, TokenFungible, TokenNonFungible, CustomToken, Client, Coin,
  randomBytes, randomBase64, bold, colors,
} from '@fadroma/agent'
import type { Permit } from './scrt-auth'
import { Console } from './scrt-base'

/** Client to a specific SNIP-721 non-fungible token contract. */
export class Snip721 extends Client implements TokenNonFungible {
  /** The token contract's address. */
  get id () { return this.address! }
  /** @returns false */
  isFungible = () => false
}

export class Snip20 extends Client implements TokenFungible {
  log = new Console('@fadroma/tokens: Snip20')
  /** The full name of the token. */
  name: string|null = null
  /** The market symbol of the token. */
  symbol: string|null = null
  /** The decimal precision of the token. */
  decimals: number|null = null
  /** The total supply of the token. */
  totalSupply: Uint128|null = null

  /** Create a SNIP20 token client from a CustomToken descriptor. */
  static fromDescriptor = (descriptor: CustomToken, agent?: Agent): Snip20 =>
    descriptor.asClient(agent, this)
  /** Create a SNIP20 init message. */
  static init = (
    name:     string,
    symbol:   string,
    decimals: number,
    admin:    Address|{ address: Address },
    config:   Partial<Snip20InitConfig> = {},
    balances: Array<{address: Address, amount: Uint128}> = []
  ): Snip20InitMsg => {
    if (typeof admin === 'object') admin = admin.address
    return {
      name, symbol, decimals, admin, config, initial_balances: balances, prng_seed: randomBase64(),
    }
  }

  /** Get a comparable token ID. */
  get id () { return this.address! }
  /** Get a client to the Viewing Key API. */
  get vk (): ViewingKeyClient { return new ViewingKeyClient(this) }
  /** @returns self as plain CustomToken with a *hidden (from serialization!)*
    * `client` property pointing to `this`. */
  get asDescriptor (): CustomToken { return new CustomToken(this.address!, this.codeHash) }

  /** @returns true */
  isFungible = () => true
  /** @returns true */
  isCustom = () => true
  /** @returns false */
  isNative = () => false

  async fetchMetadata (): Promise<this> {
    await this.fetchCodeHash()
    const { name, symbol, decimals, total_supply } = await this.getTokenInfo()
    this.name        = name
    this.symbol      = symbol
    this.decimals    = decimals
    this.totalSupply = total_supply || null
    return this
  }
  async getTokenInfo () {
    const msg = { token_info: {} }
    const { token_info }: { token_info: TokenInfo } = await this.query(msg)
    return token_info
  }
  async getBalance (address: Address, key: string) {
    const msg = { balance: { address, key } }
    const response: { balance: { amount: Uint128 } } = await this.query(msg)
    if (response.balance && response.balance.amount) {
      return response.balance.amount
    } else {
      throw new Error(JSON.stringify(response))
    }
  }
  /** Change the admin of the token, who can set the minters */
  changeAdmin = (address: string) =>
    this.execute({ change_admin: { address } })
  /** Set specific addresses to be minters, remove all others */
  setMinters = (minters: Array<string>) =>
    this.execute({ set_minters: { minters } })
  /** Add addresses to be minters */
  addMinters = (minters: Array<string>) =>
    this.execute({ add_minters: { minters } })
  /** Mint SNIP20 tokens */
  mint = (
    amount: string|number|bigint, recipient: string|undefined = this.agent?.address
  ) => {
    if (!recipient) {
      throw new Error('Snip20#mint: specify recipient')
    }
    return this.execute({ mint: { amount: String(amount), recipient } })
  }
  /** Burn SNIP20 tokens */
  burn = (amount: string|number|bigint, memo?: string) =>
    this.execute({ burn: { amount: String(amount), memo } })
  /** Deposit native tokens into the contract. */
  deposit = (nativeTokens: ICoin[],) =>
    this.execute({ deposit: {} }, { send: nativeTokens })
  /** Redeem an amount of a native token from the contract. */
  redeem = (amount: string|number|bigint, denom?: string) =>
    this.execute({ redeem: { amount: String(amount), denom } })
  /** Get the current allowance from `owner` to `spender` */
  getAllowance = async (owner: Address, spender: Address, key: string): Promise<Allowance> => {
    const msg = { allowance: { owner, spender, key } }
    const response: { allowance: Allowance } = await this.query(msg)
    return response.allowance
  }
  /** Check the current allowance from `owner` to `spender`. */
  checkAllowance = (spender: string, owner: string, key: string) =>
    this.query({ check_allowance: { owner, spender, key } })
  /** Increase allowance to spender */
  increaseAllowance = (amount:  string|number|bigint, spender: Address) => {
    this.log.debug(
      `${bold(this.agent?.address||'(missing address)')}: increasing allowance of`,
      bold(spender), 'by', bold(String(amount)), bold(String(this.symbol||this.address))
    )
    return this.execute({ increase_allowance: { amount: String(amount), spender } })
  }
  /** Decrease allowance to spender */
  decreaseAllowance = (amount: string|number|bigint, spender: Address) =>
    this.execute({ decrease_allowance: { amount: String(amount), spender } })
  /** Transfer tokens to address */
  transfer = (amount: string|number|bigint, recipient: Address) =>
    this.execute({ transfer: { amount, recipient } })
  transferFrom = (owner: Address, recipient: Address, amount: Uint128, memo?: string) =>
    this.execute({ transfer_from: { owner, recipient, amount, memo } })
  /** Send tokens to address.
    * Same as transfer but allows for receive callback. */
  send = (
    amount: string|number|bigint, recipient: Address, callback?: string|object
  ) => this.execute({
    send: {
      amount, recipient,
      msg: callback ? Buffer.from(JSON.stringify(callback)).toString('base64') : undefined
    }
  })
  sendFrom = (
    owner: Address, amount: Uint128, recipient: String,
    hash?: CodeHash, msg?: string, memo?: string
  ) => this.execute({
    send_from: { owner, recipient, recipient_code_hash: hash, amount, msg, memo }
  })
  batchTransfer = (actions: TransferAction[]) =>
    this.execute({ batch_transfer: { actions } })
  batchTransferFrom = (actions: TransferFromAction[]) =>
    this.execute({ batch_transfer_from: { actions } })
  batchSend = (actions: SendAction[]) =>
    this.execute({ batch_transfer: { actions } })
  batchSendFrom = (actions: SendFromAction[]) =>
    this.execute({ batch_send_from: { actions } })
}

export interface Snip20BaseConfig {
  /** The full name of the token. */
  name: string
  /** The market symbol of the token. */
  symbol: string
  /** The decimal precision of the token. */
  decimals: number
}

export interface Snip20InitMsg extends Snip20BaseConfig {
  /** The admin of the token. */
  admin: Address
  /** The PRNG seed for the token. */
  prng_seed: string
  /** The settings for the token. */
  config: Snip20InitConfig
  /** Initial balances. */
  initial_balances?: {address: Address, amount: Uint128}[]
  // Allow to be cast as Record<string, unknown>:
  [name: string]: unknown
}

export interface Snip20InitConfig {
  public_total_supply?: boolean
  enable_mint?: boolean
  enable_burn?: boolean
  enable_deposit?: boolean
  enable_redeem?: boolean
  // Allow unknown properties:
  [name: string]: unknown
}

export interface Allowance {
  spender: Address
  owner: Address
  allowance: Uint128
  expiration?: number|null
}

export interface TokenInfo {
  name: string
  symbol: string
  decimals: number
  total_supply?: Uint128|null
}

export type Snip20Permit = Permit<'allowance'|'balance'|'history'|'owner'>

export type QueryWithPermit <Q, P> = { with_permit: { query: Q, permit: P } }

export const createPermitMsg = <Q> (query: Q, permit: Snip20Permit) =>
  ({ with_permit: { query, permit } })


export interface TransferAction {
  recipient: Address
  amount:    Uint128
  memo?:     string
}

export interface TransferFromAction {
  owner:     Address
  recipient: Address
  amount:    Uint128
  memo?:     string
}

export interface SendAction {
  recipient:            Address
  recipient_code_hash?: CodeHash
  amount:               Uint128
  msg?:                 string
  memo?:                string
}

export interface SendFromAction {
  owner:                Address
  recipient_code_hash?: CodeHash
  recipient:            Address
  amount:               Uint128
  msg?:                 string
  memo?:                string
}

/** A viewing key. */
export type ViewingKey = string

/** A contract's viewing key methods. */
export class ViewingKeyClient extends Client {
  /** Create a random viewing key. */
  async create (entropy = randomBytes(32).toString("hex")) {
    const msg = { create_viewing_key: { entropy, padding: null } }
    let { data } = await this.execute(msg) as { data: Uint8Array|Uint8Array[] }
    if (data instanceof Uint8Array) {
      return data
    } else {
      return data[0]
    }
  }
  /** Set a user-specified viewing key. */
  async set (key: ViewingKey) {
    return this.execute({ set_viewing_key: { key } })
  }
}

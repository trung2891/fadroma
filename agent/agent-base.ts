/**

  Fadroma: Base Console and Error Types
  Copyright (C) 2023 Hack.bg

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

import { Error as BaseError } from '@hackbg/oops'
import { Console, bold, colors } from '@hackbg/logs'
import type {
  Address, Message, Label, CodeId, CodeHash, Chain, Deployment,
  Contract, Instantiable, Instantiated, Client
} from './agent'

export { bold, colors, timestamp } from '@hackbg/logs'
export * from '@hackbg/into'
export * from '@hackbg/hide'
export * from '@hackbg/many'
export * from '@hackbg/4mat'

export type Name = string

/** The default Git ref when not specified. */
export const HEAD = 'HEAD'

/** A class constructor. */
export interface Class<T, U extends unknown[]> { new (...args: U): T }

export function prop <T> (host: object, property: string, value: T) {
  Object.defineProperty(host, property, {
    get () { return value },
    set (value) { return prop(host, property, value) },
    enumerable: true,
    configurable: true,
  })
}

/** Error kinds. */
class FadromaError extends BaseError {
  /** Thrown when unsupported functionality is requested. */
  static Unsupported: typeof FadromaError_Unsupported
  /** Thrown when a required parameter is missing. */
  static Missing: typeof FadromaError_Missing
  /** Thrown when an invalid value or operation is at hand. */
  static Invalid: typeof FadromaError_Invalid
  /** Thrown when an operation fails. */
  static Failed: typeof FadromaError_Failed
  /** Thrown when the control flow reaches unimplemented areas. */
  static Unimplemented = this.define('Unimplemented', (info: string) =>
    'Not implemented' + (info ? `: ${info}` : ''))
}

class FadromaError_Unsupported extends FadromaError.define(
  'Unsupported', (msg='unsupported feature') => msg as string
) {
  /** When global Fetch API is not available, Fadroma must switch to node:fs API. */
  static Fetch = this.define('Fetch', () =>
    'global fetch is unavailable, use FSUploader instead of Uploader')
}

class FadromaError_Missing extends FadromaError.define(
  'Missing', (msg='a required parameter was missing') => msg as string
) {
  static Address = this.define('Address', () => 'no address')
  static Agent = this.define('Agent', (info?: any) => `no agent${info?`: ${info}`:``}`)
  static Artifact = this.define('Artifact', () => "no artifact url")
  static Builder = this.define('Builder', () => `no builder`)
  static Chain = this.define('Chain', () => "no chain")
  static ChainId = this.define('ChainId', () => "no chain idspecified")
  static CodeId = this.define('CodeId', (info?: any) => `no code id${info?`: ${info}`:``}`)
  static CodeHash = this.define('CodeHash', () => "no code hash")
  static Crate = this.define('Crate', () => `no crate specified`)
  static DeployFormat = this.define("DeployFormat", () => `no deployment format`)
  static DeployStore = this.define("DeployStore", () => `no deployment store`)
  static DeployStoreClass = this.define("DeployStoreClass", () => `no deployment store class`)
  static Deployment = this.define("Deployment", () => `no deployment`)
  static DevnetImage = this.define("DevnetImage", () => `no devnet image`)
  static InitMsg = this.define('InitMsg', (info?: any) => `no init message${info?`: ${info}`:``}`)
  static Label = this.define('Label', (info?: any) => `no label${info?`: ${info}`:``}`)
  static Name = this.define("Name", () => "no name")
  static Uploader = this.define('Uploader', () => "no uploader")
  static Workspace = this.define('Workspace', () => "no workspace")
}

class FadromaError_Invalid extends FadromaError.define(
  'Invalid', (msg='an invalid value was provided') => msg as string
) {
  static Message = this.define('Message', () => 'messages must have exactly 1 root key')
  static Label = this.define('Label', (label: string) => `can't set invalid label: ${label}`)
  static Batching = this.define('Batching', (op: string) => `invalid when batching: ${op}`)
  static Hashes = this.define('Hashes', () =>
    'passed both codeHash and code_hash and they were different')
  static Value = this.define('Value', (x: string, y: string, a: any, b: any) =>
    `wrong ${x}: ${y} was passed ${a} but fetched ${b}`)
  static WrongChain = this.define('WrongChain', () =>
    'tried to instantiate a contract that is uploaded to another chain')
}

class FadromaError_Failed extends FadromaError.define(
  'Failed', (msg='an action failed') => msg as string
) {
  static Upload = this.define('Upload', (args) =>
    'upload failed.', (err, args) => Object.assign(err, args||{}))
  static Init = this.define('Init', (id: any) =>
    `instantiation of code id ${id} failed.`)
}

export const Error = Object.assign(FadromaError, {
  Unsupported: FadromaError_Unsupported,
  Missing:     FadromaError_Missing,
  Invalid:     FadromaError_Invalid,
  Failed:      FadromaError_Failed
})

class AgentConsole extends Console {

  constructor (label: string = 'Fadroma') {
    super(label)
    this.label = label
  }

  emptyBundle = () => this.warn('tried to submit bundle with no messages')

  devnetIdOverride = (a: any, b: any) =>
    this.warn(`node.chainId "${a}" overrides chain.id "${b}"`)
  devnetUrlOverride = (a: any, b: any) =>
    this.warn(`node.url "${a}" overrides chain.url "${b}"`)
  devnetModeInvalid = () =>
    this.warn(`chain.devnet: only applicable in devnet chain mode`)

  noAgent = (name: string) =>
    this.warn(`${name}: no agent; actions will fail until agent is set`)
  noAddress = (name: string) =>
    this.warn(`${name}: no address; actions will fail until address is set`)
  noCodeHash = (name: string) =>
    this.warn(`${name}: no codeHash; actions may be slow until code hash is set`)
  fetchedCodeHash = (address: string, realCodeHash: string) =>
    this.warn(`code hash not provided for ${address}; fetched: ${realCodeHash}`)
  codeHashMismatch = (address: string, expected: string|undefined, fetched: string) =>
    this.warn(`code hash mismatch for ${address}: expected ${expected}, fetched ${fetched}`)

  waitingForBlock = (height: number, elapsed?: number) =>
    this.log(`waiting for block > ${height}...`, elapsed ? `${elapsed}ms elapsed` : '')

  confirmCodeHash = (address: string, codeHash: string) =>
    this.info(`confirmed code hash of ${address}: ${codeHash}`)

  bundleMessages = (msgs: any, N: number) => {
    this.info(`Messages in bundle`, `#${N}:`)
    for (const msg of msgs??[]) this.info(' ', JSON.stringify(msg))
  }

  bundleMessagesEncrypted = (msgs: any, N: number) => {
    this.info(`Encrypted messages in bundle`, `#${N}:`)
    for (const msg of msgs??[]) this.info(' ', JSON.stringify(msg))
  }

  foundDeployedContract = (address: Address, name: Name) =>
    this.sub(name).log('found at', bold(address))

  beforeDeploy = <C extends Client> (
    template: Contract<C>,
    label?: Label, codeId?: CodeId, codeHash?: CodeHash, crate?: string, revision?: string
  ) => {
    codeId ??= template?.codeId ? bold(String(template.codeId)) : colors.red('(no code id!)')
    codeHash ??= template?.codeHash ? bold(template.codeHash) : colors.red('(no code hash!)')
    label = label ? bold(label) : colors.red('(missing label!)')
    crate ??= template?.crate
    revision ??= template.revision ?? 'HEAD'
    let info = `${bold(label)} from code id ${bold(codeId)}`
    if (crate) info += ` (${bold(crate)} @ ${bold(revision)})`
    this.log(`init: ${info}`)
  }

  deployFailed = (e: Error, template: Instantiable, name: Label, msg: Message) => {
    this.error(`deploy of ${bold(name)} failed:`)
    this.error(`${e?.message}`)
    this.deployFailedContract(template)
    this.error(`init message:`, JSON.stringify(msg))
  }

  deployManyFailed = (template: Instantiable, contracts: any[] = [], e: Error) => {
    this.error(`Deploy of multiple contracts failed:`)
    this.error(bold(e?.message))
    this.deployFailedContract(template)
    for (const [name, init] of contracts) this.error(`${bold(name)}:`, JSON.stringify(init))
  }

  deployFailedContract = (template?: Instantiable) => {
    if (!template) return this.error(`No template was provided`)
    this.error(`Code hash:`, bold(template.codeHash||''))
    this.error(`Chain ID: `, bold(template.chainId ||''))
    this.error(`Code ID:  `, bold(template.codeId  ||''))
  }

  afterDeploy = <C extends Client> (contract: Partial<Contract<C>>) => {
    let { name, prefix, address, codeHash } = contract || {}
    name    = name ? bold(green(name)) : bold(red('(no name)'))
    prefix  = contract?.prefix ? bold(green(contract.prefix)) : bold(red('(no deployment)'))
    address = address ? bold(colors.green(address)) : bold(red('(no address)'))
    this.info('addr:', address)
    this.info('hash:', contract?.codeHash?colors.green(contract.codeHash):colors.red('(n/a)'))
    this.info('added to', prefix)
    this.br()
  }

  saveNoStore = (name: string) =>
    this.warn(`not saving: store not set`)
  saveNoChain = (name: string) =>
    this.warn(`not saving: chain not set`)
  notSavingMocknet = (name: string) =>
    this.warn(`not saving: mocknet is not stateful (yet)`)
  saving = (name: string, state: object) =>
    this.log('saving')

  deployment = (deployment: Deployment, name = deployment?.name) => {
    if (!deployment) return this.info('(no deployment)')
    const { contracts = {} } = deployment
    const len = Math.max(40, Object.keys(contracts).reduce((x,r)=>Math.max(x,r.length),0))
    const count = Object.values(contracts).length
    if (count <= 0) return this.info(`${name} is an empty deployment`)
    this.info(`${bold(String(count))} contract(s) in deployment ${bold(name)}:`)
    this.br()
    for (const name of Object.keys(contracts).sort()) {
      this.receipt(name, contracts[name], len)
      this.br()
    }
  }

  receipt = (name: string, receipt?: any, len?: number) => {
    let { address, codeHash, codeId, crate, repository } = receipt || {}
    this.info(`name: ${bold(name       || gray('(no name)'))     }`)
    this.info(`addr: ${bold(address    || gray('(no address)'))  }`)
    this.info(`hash: ${bold(codeHash   || gray('(no code hash)'))}`)
    this.info(`code: ${bold(codeId)    || gray('(no code id)')   }`)
    this.info(`repo: ${bold(repository || gray('(no repo)'))     }`)
    this.info(`crate: ${bold(crate     || gray('(no crate)'))    }`)
  }


}

const { red, green, gray } = colors

export { AgentConsole as Console }

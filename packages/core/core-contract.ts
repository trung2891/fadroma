import type { Task } from '@hackbg/komandi'
import type { ChainId } from './core-chain'
import type { CodeId, CodeHash, Hashed } from './core-code'
import type { Uploader } from './core-upload'
import type { Address, Message, TxHash } from './core-tx'
import type { Label } from './core-labels'
import type { Name, Class, Many } from './core-fields'
import type { Client } from './core-client'
import type { Builder } from './core-build'

import { assertAddress } from './core-tx'
import { codeHashOf } from './core-code'
import * as Impl from './core-contract-impl'

/** Define a callable class. Instances of the generated class can be invoked as functions.
  * The body of the function is passed as second argument.
  * The function's `this` identifier is bound to the instance.
  * @returns a callable class extending `Base`. */
export function defineCallable <T, U extends unknown[], F extends Function> (
  Base: Class<any, any>, fn: F
): Class<any, any> {
  return Object.defineProperty(class extends Base {
    constructor (...args: any) {
      super(...args)
      const self = this
      let call = function (...args: any) {
        return fn.apply(call, args)
      }
      let descriptors = {}
      let parent
      parent = call
      while (parent = Object.getPrototypeOf(parent)) {
        descriptors = { ...descriptors, ...Object.getOwnPropertyDescriptors(parent) }
      }
      parent = this
      while (parent = Object.getPrototypeOf(parent)) {
        descriptors = { ...descriptors, ...Object.getOwnPropertyDescriptors(parent) }
      }
      Object.setPrototypeOf(call, Object.defineProperties({}, descriptors))
      Object.defineProperties(call, Object.getOwnPropertyDescriptors(this))
      return call
    }
  }, 'name', {
    value: `${Base.name}Callable`
  })
}

export interface ContractTemplate<C extends Client> extends Impl.ContractTemplate<C> {
  (): Task<ContractTemplate<C>, ContractTemplate<C> & Uploaded>
}

/** Callable object: contract template.
  * Can build and upload, but not instantiate.
  * Can produce deployable Contract instances. */
export class ContractTemplate<C extends Client> extends defineCallable(
  Impl.ContractTemplate,
  function ensureTemplate <C extends Client> (this: ContractTemplate<C>) {
    return this.uploaded
  }
) {}

export interface Contract<C extends Client> extends Impl.Contract<C> {
  (): Task<ContractTemplate<C>, C>
}

/** Callable object: contract.
  * Can build and upload, and instantiate itself. */
export class Contract<C extends Client> extends defineCallable(
  Impl.Contract,
  function ensureContract <C extends Client> (this: Contract<C>, ...args: any) {
    // Parse options
    const options: Partial<typeof this> =
      (typeof args[0] === 'string')
        ? { id: args[0], initMsg: args[1] }
        : { ...args[0] }
    // If there is a deployment, look for the contract in it
    if (options.id && options.context?.hasContract(options.id)) {
      return options.context.getContract(options.id)
    }
    return this.deploy(...args)
  }
) {}

export interface ContractGroup<A extends unknown[]> extends Impl.ContractGroup<A> {
  (): Task<ContractGroup<A>, Many<Client>>
}

/** Callable object: contract group.
  * Can build and upload, and instantiate multiple contracts. */
export class ContractGroup<A extends unknown[]> extends defineCallable(
  Impl.ContractGroup,
  function ensureContractGroup <A extends unknown[]> (this: ContractGroup<A>, ...args: any) {
    return this.deploy(...args)
  }
) {}

/** Parameters involved in building a contract. */
export interface Buildable {
  crate:       string
  features?:   string[]
  workspace?:  string
  repository?: string|URL
  revision?:   string
  dirty?:      boolean
  builder?:    Builder
}

/** Result of building a contract. */
export interface Built {
  artifact:   string|URL
  codeHash?:  CodeHash
  builder?:   Builder
  builderId?: string
}

/** @returns the data for saving a build receipt. */
export function toBuildReceipt (s: Buildable & Built) {
  return {
    repository: s.repository,
    revision:   s.revision,
    dirty:      s.dirty,
    workspace:  s.workspace,
    crate:      s.crate,
    features:   s.features?.join(', '),
    builder:    undefined,
    builderId:  s.builder?.id,
    artifact:   s.artifact?.toString(),
    codeHash:   s.codeHash
  }
}

/** Parameters involved in uploading a contract */
export interface Uploadable {
  artifact:  string|URL
  chainId:   ChainId,
  codeHash?: CodeHash
}

/** Result of uploading a contract */
export interface Uploaded {
  chainId:   ChainId
  codeId:    CodeId
  codeHash:  CodeHash
  uploader?: Uploader
  uploadBy?: Address
  uploadTx?: TxHash
}

/** @returns the data for saving an upload receipt. */
export function toUploadReceipt (
  t: Buildable & Built & Uploadable & Uploaded
) {
  return {
    ...toBuildReceipt(t),
    chainId:    t.chainId,
    uploaderId: t.uploader?.id,
    uploader:   undefined,
    uploadBy:   t.uploadBy,
    uploadTx:   t.uploadTx,
    codeId:     t.codeId
  }
}

/** Parameters involved in instantiating a contract */
export interface Instantiable {
  chainId:   ChainId
  codeId:    CodeId
  codeHash?: CodeHash
  label?:    Label
  prefix?:   Name
  name?:     Name
  suffix?:   Name
  initMsg:   Message
}

/** Result of instantiating a contract */
export interface Instantiated {
  chainId:  ChainId
  address:  Address
  codeHash: CodeHash
  label:    Label
  prefix?:  Name
  name?:    Name
  suffix?:  Name
  initBy?:  Address
  initTx?:  TxHash
}

/** @returns the data for a deploy receipt */
export function toInstanceReceipt (
  c: Buildable & Built & Uploadable & Uploaded & Instantiable & Instantiated
) {
  return {
    ...toUploadReceipt(c),
    initBy:  c.initBy,
    initMsg: c.initMsg,
    initTx:  c.initTx,
    address: c.address,
    label:   c.label,
    prefix:  c.prefix,
    name:    c.name,
    suffix:  c.suffix
  }
}

/** Convert Fadroma.Instance to address/hash struct (ContractLink) */
export const linkStruct = (instance: IntoLink): ContractLink => ({
  address:   assertAddress(instance),
  code_hash: codeHashOf(instance)
})

/** Objects that have an address and code hash.
  * Pass to linkTuple or linkStruct to get either format of link. */
export type IntoLink = Hashed & {
  address: Address
}

/** Reference to an instantiated smart contract,
  * in the format of Fadroma ICC. */
export interface ContractLink {
  readonly address:   Address
  readonly code_hash: CodeHash
}

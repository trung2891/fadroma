import { Console, DeployError } from '../util'

import {
  Agent, AnyContract, Contract, Client, Deployment, DeploymentState, DeployStore,
  toInstanceReceipt, timestamp, bold
} from '@fadroma/agent'

import $, {
  Path, YAMLDirectory, YAMLFile, TextFile, alignYAML, OpaqueDirectory
} from '@hackbg/file'

import { basename } from 'node:path'
import { loadAll, dump } from 'js-yaml'

/** Directory containing deploy receipts, e.g. `state/$CHAIN/deploy`.
  * Each deployment is represented by 1 multi-document YAML file, where every
  * document is delimited by the `\n---\n` separator and represents a deployed
  * smart contract. */
export default class YAMLDeployments_v1 extends DeployStore {
  log = new Console('DeployStore (YAML1)')
  /** Root directory of deploy store. */
  root: YAMLDirectory<unknown>
  /** Name of symlink pointing to active deployment, without extension. */
  KEY = '.active'

  constructor (
    storePath: string|Path|YAMLDirectory<unknown>,
    public defaults: Partial<Deployment> = {},
  ) {
    super()
    const root = this.root = $(storePath).as(YAMLDirectory)
    Object.defineProperty(this, 'root', {
      enumerable: true,
      get () { return root }
    })
  }

  get [Symbol.toStringTag]() { return `${this.root?.shortPath??'-'}` }

  /** Load the deployment activeted by symlink */
  get active () {
    return this.load(this.KEY)
  }
  /** Create a deployment with a specific name. */
  async create (name: string = timestamp()): Promise<DeploymentState> {
    this.log.deploy.creating(name)
    const path = this.root.at(`${name}.yml`)
    if (path.exists()) throw new DeployError.DeploymentAlreadyExists(name)
    this.log.deploy.location(path.shortPath)
    path.makeParent().as(YAMLFile).save(undefined)
    return this.load(name)!
  }
  /** Make the specified deployment be the active deployment. */
  async select (name: string = this.KEY): Promise<DeploymentState> {
    let selected = this.root.at(`${name}.yml`)
    if (selected.exists()) {
      const active = this.root.at(`${this.KEY}.yml`).as(YAMLFile)
      if (name === this.KEY) name = active.real.name
      name = basename(name, '.yml')
      active.relLink(`${name}.yml`)
      this.log.deploy.activating(selected.real.name)
      return this.load(name)!
    }
    if (name === this.KEY) {
      const deployment = new Deployment()
      const d = await this.create(deployment.name)
      return this.select(deployment.name)
    }
    throw new DeployError.DeploymentDoesNotExist(name)
  }
  /** List the deployments in the deployments directory. */
  list (): string[] {
    if (this.root.exists()) {
      const list = this.root.as(OpaqueDirectory).list() ?? []
      return list.filter(x=>x.endsWith('.yml')).map(x=>basename(x, '.yml')).filter(x=>x!=this.KEY)
    } else {
      this.log.deploy.storeDoesNotExist(this.root.shortPath)
      return []
    }
  }
  /** Get the contents of the named deployment, or null if it doesn't exist. */
  load (name: string): DeploymentState|null {
    let file = this.root.at(`${name}.yml`)
    if (!file.exists()) return null
    name = basename(file.real.name, '.yml')
    const state: DeploymentState = {}
    for (const receipt of file.as(YAMLFile).loadAll() as Partial<AnyContract>[]) {
      if (!receipt.name) continue
      state[receipt.name] = receipt
    }
    return state
  }
  /** Save a deployment's state to this store. */
  save (name: string, state: DeploymentState = {}) {
    this.root.make()
    const file = this.root.at(`${name}.yml`)
    // Serialize data to multi-document YAML
    let output = ''
    for (let [name, data] of Object.entries(state)) {
      output += '---\n'
      name ??= data.name!
      if (!name) throw new Error('Deployment: no name')
      const receipt: any = toInstanceReceipt(new Contract(data as Partial<AnyContract>) as any)
      data = JSON.parse(JSON.stringify({
        name,
        label:    receipt.label,
        address:  receipt.address,
        codeHash: receipt.codeHash,
        codeId:   receipt.label,
        crate:    receipt.crate,
        revision: receipt.revision,
        ...receipt,
        deployment: undefined
      }))
      const daDump = dump(data, { noRefs: true })
      output += alignYAML(daDump)
    }
    file.as(TextFile).save(output)
    return this
  }

}

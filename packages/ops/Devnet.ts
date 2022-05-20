import { URL } from 'url'
import * as HTTP from 'http'
import { basename, relative, resolve } from 'path'
import { cwd } from 'process'
import { existsSync, readlinkSync, symlinkSync } from 'fs'

import type { AgentOptions } from '@fadroma/client'
import { Console, bold } from '@hackbg/konzola'
import { Path, Directory, JSONFormat, JSONFile, JSONDirectory } from '@hackbg/kabinet'
import { freePort, waitPort } from '@hackbg/portali'
import { Dokeres, DokeresImage, DokeresContainer, waitUntilLogsSay } from '@hackbg/dokeres'
import { randomHex } from '@hackbg/toolbox'

import { config } from './Config'
import { Endpoint } from './Endpoint'

const console = Console('Fadroma Devnet')

/** Domain API. A Devnet is created from a given chain ID
  * with given pre-configured identities, and its state is stored
  * in a given directory. */
export interface DevnetOptions {
  /** Internal name that will be given to chain. */
  chainId?:   string
  /** Names of genesis accounts to be created with the node */
  identities?: Array<string>
  /** Path to directory where state will be stored. */
  stateRoot?: string,
  /** Port to connect to. */
  port?:      number
}

export abstract class Devnet {

  /** Creates an object representing a devnet.
    * Use the `respawn` method to get it running. */
  constructor ({ chainId, identities, stateRoot, port }: DevnetOptions) {
    this.chainId = chainId || this.chainId
    this.port    = port    || this.port
    if (!this.chainId) {
      throw new Error(
        '@fadroma/ops/Devnet: refusing to create directories for devnet with empty chain id'
      )
    }
    if (identities) {
      this.genesisAccounts = identities
    }
    stateRoot = stateRoot || resolve(config.projectRoot, 'receipts', this.chainId)
    this.stateRoot = new Directory(stateRoot)
    this.nodeState = this.stateRoot.at('node.json').as(JSONFormat)
  }

  /** The chain ID that will be passed to the devnet node. */
  chainId  = 'fadroma-devnet'

  /** The protocol of the API URL without the trailing colon. */
  protocol = 'http'

  /** The hostname of the API URL. */
  host     = 'localhost'

  /** The port of the API URL.
    * If `null`, `freePort` will be used to obtain a random port. */
  port     = ''

  /** The API URL that can be used to talk to the devnet. */
  get url (): URL {
    const url = `${this.protocol}://${this.host}:${this.port}`
    return new URL(url)
  }

  /** This directory is created to remember the state of the devnet setup. */
  stateRoot: Directory

  /** List of genesis accounts that will be given an initial balance
    * when creating the devnet container for the first time. */
  genesisAccounts: Array<string> = ['ADMIN', 'ALICE', 'BOB', 'CHARLIE', 'MALLORY']

  /** Retrieve an identity */
  abstract getGenesisAccount (name: string): Promise<AgentOptions>

  /** Start the node. */
  abstract spawn (): Promise<this>

  /** This file contains the id of the current devnet container.
    * TODO store multiple containers */
  nodeState: JSONFile

  /** Save the info needed to respawn the node */
  save (extraData = {}) {
    const shortPath = relative(cwd(), this.nodeState.path)
    console.info(`Saving devnet node to ${shortPath}`)
    const data = { chainId: this.chainId, port: this.port, ...extraData }
    this.nodeState.save(data)
    return this
  }

  /** Restore this node from the info stored in the nodeState file */
  load () {
    const path = relative(cwd(), this.nodeState.path)
    if (this.stateRoot.exists && this.nodeState.exists) {
      console.info(bold(`Loading:  `), path)
      try {
        const data = this.nodeState.load()
        const { chainId, port } = data
        if (this.chainId !== chainId) {
          console.warn(`Loading state of ${chainId} into Devnet with id ${this.chainId}`)
        }
        this.port = String(port)
        return data
      } catch (e) {
        console.warn(`Failed to load ${path}. Deleting it`)
        this.stateRoot.delete()
        throw e
      }
    } else {
      console.info(`${path} does not exist.`)
    }
  }

  /** Start the node if stopped. */
  abstract respawn (): Promise<this>

  /** Stop this node and delete its state. */
  async terminate () {
    await this.kill()
    await this.erase()
  }

  /** Stop the node. */
  abstract kill (): Promise<void>

  /** Erase the state of the node. */
  abstract erase (): Promise<void>

}

export type DevnetPortMode = 'lcp'|'grpcWeb'

/** Parameters for the Dockerode-based implementation of Devnet.
  * (https://www.npmjs.com/package/dockerode) */
export interface DockerodeDevnetOptions extends DevnetOptions {
  /** Docker image of the chain's runtime. */
  image?:       DokeresImage
  /** Init script to launch the devnet. */
  initScript?:  string
  /** Once this string is encountered in the log output
    * from the container, the devnet is ready to accept requests. */
  readyPhrase?: string
  /** Which of the services should be exposed the devnet's port. */
  portMode:   DevnetPortMode
}

/** Used to reconnect between runs. */
export interface DockerodeDevnetReceipt {
  containerId: string
  chainId:     string
  port:        number|string
}

/** Fadroma can spawn a devnet in a container using Dockerode.
  * This requires an image name and a handle to Dockerode. */
export class DockerodeDevnet extends Devnet {

  constructor (options: DockerodeDevnetOptions = {}) {
    super(options)
    console.info('Constructing', bold('Dockerode')+'-based devnet')
    this.identities  = this.stateRoot.subdir('identities').as(JSONFormat)
    this.image       = options.image
    this.initScript  = options.initScript
    this.readyPhrase = options.readyPhrase
    this.portMode    = options.portMode
  }

  /** Which service does the API URL port correspond to. */
  portMode: DevnetPortMode

  get dokeres (): Dokeres {
    return this.image.dokeres
  }

  /** This should point to the standard production docker image for the network. */
  image: DokeresImage

  /** */
  container: DokeresContainer|null

  /** Mounted into devnet container in place of default init script
    * in order to add custom genesis accounts with initial balances
    * and store their keys. */
  initScript: string

  /** Mounted out of devnet container to persist keys of genesis wallets. */
  identities: JSONDirectory

  /** Gets the info for a genesis account, including the mnemonic */
  async getGenesisAccount (name: string): Promise<AgentOptions> {
    return this.identities.load(name)
  }

  /** Once this phrase is encountered in the log output
    * from the container, the devnet is ready to accept requests. */
  readyPhrase: string

  /** Path under which the init script is mounted in the container. */
  get initScriptName (): string {
    return resolve('/', basename(this.initScript))
  }

  async spawn () {
    // tell the user that we have begun
    console.info(`Spawning new node...`)
    // if no port is specified, use a random port
    if (!this.port) {
      this.port = await freePort()
    }
    // create the state dirs and files
    const items = [this.stateRoot, this.nodeState]
    for (const item of items) {
      try {
        item.make()
      } catch (e) {
        console.warn(`Failed to create ${item.path}: ${e.message}`)
      }
    }
    // run the container
    const containerName = `${this.chainId}-${this.port}`
    console.info('Creating and starting devnet container:', bold(containerName))
    const env: Record<string, string> = {
      ChainID:         this.chainId,
      GenesisAccounts: this.genesisAccounts.join(' '),
    }
    switch (this.portMode) {
      case 'lcp':     env.lcpPort     = this.port;              break
      case 'grpcWeb': env.gRPCWebAddr = `0.0.0.0:${this.port}`; break
      default: throw new Error(`DockerodeDevnet#portMode must be either 'lcp' or 'grpcWeb'`)
    }
    this.container = await this.image.run(containerName, {
      env,
      exposed: [`${this.port}/tcp`],
      extra: {
        Tty:          true,
        AttachStdin:  true,
        AttachStdout: true,
        AttachStderr: true,
        Hostname:     this.chainId,
        Domainname:   this.chainId,
        HostConfig:   {
          NetworkMode: 'bridge',
          Binds: [
            `${this.initScript}:${resolve('/', basename(this.initScript))}:ro`,
            `${this.stateRoot.path}:/receipts/${this.chainId}:rw`
          ],
          PortBindings: {
            [`${this.port}/tcp`]: [{HostPort: `${this.port}`}]
          }
        }
      }
    }, ['node', this.initScriptName], '/usr/bin/env')
    // update the record
    this.save()
    // wait for logs to confirm that the genesis is done
    await waitUntilLogsSay(
      this.container.container,
      this.readyPhrase,
      false,
      this.waitSeconds,
      DockerodeDevnet.logFilter
    )
    // wait for port to be open
    await this.waitPort({ host: this.host, port: Number(this.port) })
    return this
  }

  /** Overridable for testing. */
  protected waitSeconds = 7

  /** Filter logs when waiting for the ready phrase. */
  static logFilter (data: string) {
    const RE_GARBAGE = /[\x00-\x1F]/
    return (
      data.length > 0                            &&
      !data.startsWith('TRACE ')                 &&
      !data.startsWith('DEBUG ')                 &&
      !data.startsWith('INFO ')                  &&
      !data.startsWith('I[')                     &&
      !data.startsWith('Storing key:')           &&
      !RE_GARBAGE.test(data)                     &&
      !data.startsWith('{"app_message":')        &&
      !data.startsWith('configuration saved to') &&
      !(data.length>1000)
    )
  }

  /** Overridable for testing. */
  protected waitPort = waitPort

  async load (): Promise<DockerodeDevnetReceipt> | null {
    const data = super.load()
    if (data.containerId) {
      this.container = await this.dokeres.container(data.containerId)
    } else {
      throw new Error('@fadroma/ops/Devnet: missing container id in devnet state')
    }
    return data
  }

  /** Write the state of the devnet to a file. */
  save () {
    return super.save({ containerId: this.container.id })
  }

  /** Spawn the existing localnet, or a new one if that is impossible */
  async respawn () {
    const shortPath = relative(config.projectRoot, this.nodeState.path)
    // if no node state, spawn
    if (!this.nodeState.exists) {
      console.info(`No devnet found at ${bold(shortPath)}`)
      return this.spawn()
    }
    // get stored info about the container was supposed to be
    let id: string
    try {
      id = (await this.load()).containerId
    } catch (e) {
      // if node state is corrupted, spawn
      console.warn(e)
      console.info(`Reading ${bold(shortPath)} failed`)
      return this.spawn()
    }
    this.container = await this.dokeres.container(id)
    // check if contract is running
    let running: boolean
    try {
      running = await this.container.isRunning
    } catch (e) {
      // if error when checking, RESPAWN
      console.info(`✋ Failed to get container ${bold(id)}`)
      console.info('Error was:', e)
      console.info(`Cleaning up outdated state...`)
      await this.erase()
      console.info(`Trying to launch a new node...`)
      return this.spawn()
    }
    // if not running, RESPAWN
    if (!running) {
      await this.container.start()
    }
    // ...and try to make sure it dies when the Node process dies
    process.on('beforeExit', () => {
      if (config.devnetEphemeral) {
        this.container.kill()
      } else {
        console.log()
        console.info(
          'Devnet is running on port', bold(String(this.port)),
          'from container', bold(this.container.id.slice(0,8))
        )
      }
    })
    return this
  }

  /** Kill the container, if necessary find it first */
  async kill () {
    if (this.container) {
      const { id } = this.container
      await this.container.kill()
      console.info(
        `Stopped container`, bold(id)
      )
    } else {
      console.info(
        `Checking if there's an old node that needs to be stopped...`
      )
      try {
        const { containerId } = await this.load()
        await this.container.kill()
        console.info(`Stopped container ${bold(containerId)}.`)
      } catch (_e) {
        console.info("Didn't stop any container.")
      }
    }
  }

  /** External environment needs to be returned to a pristine state via Docker.
    * (Otherwise, root-owned dotdirs leak and have to be manually removed with sudo.) */
  async erase () {
    const path = bold(relative(cwd(), this.stateRoot.path))
    try {
      if (this.stateRoot.exists) {
        console.info(`Deleting ${path}...`)
        this.stateRoot.delete()
      }
    } catch (e) {
      if (e.code === 'EACCES' || e.code === 'ENOTEMPTY') {
        console.warn(`Failed to delete ${path}: ${e.message}; trying cleanup container...`)
        await this.image.ensure()
        const containerName = `${this.chainId}-${this.port}-cleanup`
        const options = {
          AutoRemove: true,
          Image:      this.image.name,
          Entrypoint: [ '/bin/rm' ],
          Cmd:        ['-rvf', '/state',],
          HostConfig: { Binds: [`${this.stateRoot.path}:/state:rw`] }
          //Tty: true, AttachStdin: true, AttachStdout: true, AttachStderr: true,
        }
        const cleanupContainer = await this.image.run(
          containerName,
          { extra: options },
          ['-rvf', '/state'],
          '/bin/rm'
        )
        console.info(`Starting cleanup container...`)
        await cleanupContainer.start()
        console.info('Waiting for cleanup to finish...')
        await cleanupContainer.wait()
        console.info(`Deleted ${path} via cleanup container.`)
      } else {
        console.warn(`Failed to delete ${path}: ${e.message}`)
        throw e
      }
    }
  }

}

/** Parameters for the HTTP API-managed implementation of Devnet. */
export type ManagedDevnetOptions = DevnetOptions & {
  /** Base URL of the API that controls the managed node. */
  managerURL: string
}

/** When running in docker-compose, Fadroma needs to request
  * from the devnet container to spawn a chain node with the
  * given chain id and identities via a HTTP API. */
export class ManagedDevnet extends Devnet {

  /** Get a handle to a remote devnet. If there isn't one,
    * create one. If there already is one, reuse it. */
  static getOrCreate (
    managerURL: string,
    chainId?:   string,
    prefix?:    string
  ) {

    // If passed a chain id, use it; this makes a passed prefix irrelevant.
    if (chainId && prefix) {
      console.warn('Passed both chainId and prefix to ManagedDevnet.getOrCreate: ignoring prefix')
    }

    // Establish default prefix. Chain subclasses should define this.
    if (!prefix) {
      prefix = 'devnet'
    }

    // If no chain id passed, try to reuse the last created devnet;
    // if there isn't one, create a new one and symlink it as active.
    if (!chainId) {
      const active = resolve(config.projectRoot, 'receipts', `${prefix}-active`)
      if (existsSync(active)) {
        chainId = basename(readlinkSync(active))
        console.info('Reusing existing managed devnet with chain id', bold(chainId))
      } else {
        chainId = `${prefix}-${randomHex(4)}`
        const devnet = new Path(config.projectRoot).in('receipts').in(chainId)
        devnet.make()
        symlinkSync(devnet.path, active)
        console.info('Creating new managed devnet with chain id', bold(chainId))
      }
    }

    return new ManagedDevnet({ managerURL, chainId })

  }

  constructor (options) {
    super(options)
    console.info('Constructing', bold('remotely managed'), 'devnet')
    const { managerURL = config.devnetManager } = options
    this.manager = new Endpoint(managerURL)
  }

  manager: Endpoint

  apiURL: URL = new URL('http://devnet:1317')

  async spawn () {
    const port = String(await freePort())
    this.apiURL.port = port
    console.info(bold('Spawning managed devnet'), this.chainId, 'on port', port)
    await this.manager.get('/spawn', {
      id:      this.chainId,
      genesis: this.genesisAccounts.join(','),
      port
    })
    await this.ready()
    return this
  }

  save () {
    const shortPath = relative(config.projectRoot, this.nodeState.path)
    console.info(`Saving devnet node to ${shortPath}`)
    const data = { chainId: this.chainId, port: this.port }
    this.nodeState.save(data)
    return this
  }

  async respawn () {
    const shortPath = relative(config.projectRoot, this.nodeState.path)
    // if no node state, spawn
    if (!this.nodeState.exists) {
      console.info(`No devnet found at ${bold(shortPath)}`)
      return this.spawn()
    }
    return this
  }

  protected async ready (): Promise<void> {
    while (true) {
      const { ready } = await this.manager.get('/ready')
      if (ready) {
        break
      }
      console.info('Waiting for devnet to become ready...')
      await new Promise(resolve=>setTimeout(resolve, 1000))
    }
  }

  async getGenesisAccount (name: string): Promise<AgentOptions> {
    const identity = await this.manager.get('/identity', { name })
    if (identity.error) {
      throw new Error(`ManagedDevnet#getGenesisAccount: failed to get ${name}: ${identity.error}`)
    }
    return identity
  }

  async erase () { throw new Error('not implemented') }

  async kill () { throw new Error('not implemented') }

}

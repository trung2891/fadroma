import { Error, Console, Config } from '../util'
import type { DevnetConfig } from '../util'
import { bold, randomHex, ChainMode, Chain } from '@fadroma/agent'
import type { AgentOpts, ChainClass, ChainId, DevnetHandle } from '@fadroma/agent'
import $, { JSONFile, JSONDirectory, OpaqueDirectory } from '@hackbg/file'
import { freePort, Endpoint, waitPort, isPortTaken } from '@hackbg/port'
import * as Dock from '@hackbg/dock'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** @returns Devnet configured as per environment and options. */
export function getDevnet (options: Partial<DevnetConfig> = {}) {
  return new Config({ devnet: options }).getDevnet()
}

/** Root of this module.
  * Used for finding embedded assets, e.g. Dockerfiles.
  * TypeScript doesn't like `import.meta.url` when compiling to JS. */
//@ts-ignore
export const devnetPackage = dirname(fileURLToPath(import.meta.url)) // resource finder

/** Used to reconnect between runs. */
export interface DevnetState {
  /** ID of Docker container to restart. */
  containerId?: string
  /** Chain ID that was set when creating the devnet. */
  chainId:      string
  /** The port on which the devnet will be listening. */
  host?:        string
  /** The port on which the devnet will be listening. */
  port:         number|string
}

/** Supported connection types. */
export type DevnetPortMode = 'lcp'|'grpcWeb'

/** Supported devnet variants. */
export type DevnetPlatform =
  |'scrt_1.2'
  |'scrt_1.3'
  |'scrt_1.4'
  |'scrt_1.5'
  |'scrt_1.6'
  |'scrt_1.7'
  |'scrt_1.8'

/** Default connection type to expose on each devnet variant. */
export const devnetPortModes: Record<DevnetPlatform, DevnetPortMode> = {
  'scrt_1.2': 'lcp',
  'scrt_1.3': 'grpcWeb',
  'scrt_1.4': 'grpcWeb',
  'scrt_1.5': 'lcp',
  'scrt_1.6': 'lcp',
  'scrt_1.7': 'lcp',
  'scrt_1.8': 'lcp'
}

/** A Devnet is created from a given chain ID with given pre-configured identities,
  * and its state is stored in a given directory (e.g. `state/fadroma-devnet`). */
export interface DevnetOpts {
  /** Internal name that will be given to chain. */
  chainId?:    string
  /** Names of genesis accounts to be created with the node */
  identities?: Array<string>
  /** Path to directory where state will be stored. */
  stateRoot?:  string,
  /** Host to connect to. */
  host?:       string
  /** Port to connect to. */
  port?:       number
  /** Which of the services should be exposed the devnet's port. */
  portMode?:   DevnetPortMode
  /** Whether to destroy this devnet on exit. */
  ephemeral?:  boolean
}

/** Parameters for the Dockerode-based implementation of Devnet.
  * (https://www.npmjs.com/package/dockerode) */
export interface DockerDevnetOpts extends DevnetOpts {
  /** Container image of the chain's runtime. */
  image?: Dock.Image
  /** Init script to launch the devnet. */
  initScript?: string
  /** Once this string is encountered in the log output
    * from the container, the devnet is ready to accept requests. */
  readyPhrase?: string
}


/** An ephemeral private instance of a network. */
export abstract class Devnet implements DevnetHandle {
  /** Logger. */
  log:       Console = new Console('@fadroma/devnet')
  /** Whether to destroy this devnet on exit. */
  ephemeral: boolean = false
  /** The chain ID that will be passed to the devnet node. */
  chainId:   ChainId = 'fadroma-devnet'
  /** The protocol of the API URL without the trailing colon. */
  protocol:  string = 'http'
  /** The hostname of the API URL. */
  host:      string = process.env.FADROMA_DEVNET_HOST ?? 'localhost'
  /** The port of the API URL. If `null`, `freePort` will be used to obtain a random port. */
  port:      number
  /** Which service does the API URL port correspond to. */
  portMode:  DevnetPortMode
  /** This directory is created to remember the state of the devnet setup. */
  stateRoot: OpaqueDirectory

  /** Create an object representing a devnet.
    * Must call the `respawn` method to get it running. */
  constructor (options?: Partial<DevnetOpts>) {
    let { chainId, identities, stateRoot, host, port, portMode, ephemeral } = options || {}
    this.chainId = chainId ?? this.chainId
    if (!this.chainId) throw new Error.Devnet.NoChainId()
    // FIXME: Is the auto-destroy working?
    this.ephemeral = ephemeral ?? this.ephemeral
    // Define connection method
    this.host     = host ?? this.host
    this.portMode = portMode! // this should go, in favor of exposing all ports
    this.port     = port ?? ((this.portMode === 'lcp') ? 1317 : 9091)
    // Define initial wallets
    this.genesisAccounts = identities ?? this.genesisAccounts
    // Define storage
    this.stateRoot = $(stateRoot || $('state', this.chainId).path).as(OpaqueDirectory)
  }

  /** The API URL that can be used to talk to the devnet. */
  get url (): URL { return new URL(`${this.protocol}://${this.host}:${this.port}`) }
  /** This file contains the id of the current devnet container.
    * TODO store multiple containers */
  get nodeState (): JSONFile<DevnetState> {
    return this.stateRoot.at('devnet.json').as(JSONFile) as JSONFile<DevnetState>
  }
  /** List of genesis accounts that will be given an initial balance
    * when creating the devnet container for the first time. */
  genesisAccounts: Array<string> = [
    'Admin',
    'Alice',
    'Bob',
    'Charlie',
    'Mallory'
  ]
  /** Save the info needed to respawn the node */
  save (extraData = {}) {
    const data = { chainId: this.chainId, port: this.port, ...extraData }
    this.nodeState.save(data)
    return this
  }
  /** Restore this node from the info stored in the nodeState file */
  async load (): Promise<DevnetState|null> {
    const path = this.nodeState.shortPath
    if (this.stateRoot.exists() && this.nodeState.exists()) {
      //log.info(bold(`Loading:  `), path)
      try {
        const data = this.nodeState.load()
        const { chainId, port } = data
        if (this.chainId !== chainId) {
          this.log.devnet.loadingState(chainId, this.chainId)
        }
        this.port = port as number
        return data
      } catch (e) {
        this.log.devnet.loadingFailed(path)
        this.stateRoot.delete()
        throw e
      }
    } else {
      this.log.devnet.loadingRejected(path)
      return null
    }
  }
  /** Stop this node and delete its state. */
  async terminate () {
    await this.kill()
    await this.erase()
    return this
  }
  /** Retrieve an identity */
  abstract getGenesisAccount (name: string): Promise<AgentOpts>
  /** Start the node. */
  abstract spawn (): Promise<this>
  /** Start the node if stopped. */
  abstract respawn (): Promise<this>
  /** Stop the node. */
  abstract kill (): Promise<void>
  /** Erase the state of the node. */
  abstract erase (): Promise<void>

  getChain <C extends Chain> (
    $C: ChainClass<C> = Chain as unknown as ChainClass<C>
  ): C {
    return new $C({ id: this.chainId, mode: Chain.Mode.Devnet, devnet: this })
  }
  /** Regexp for non-printable characters. */
  static RE_GARBAGE = /[\x00-\x1F]/
}

/** Fadroma can spawn a devnet in a container using Dockerode.
  * This requires an image name and a handle to Dockerode. */
export class DevnetContainer extends Devnet implements DevnetHandle {

  static dockerfiles: Record<DevnetPlatform, string> = {
    'scrt_1.2': $(devnetPackage, 'scrt_1_2.Dockerfile').path,
    'scrt_1.3': $(devnetPackage, 'scrt_1_3.Dockerfile').path,
    'scrt_1.4': $(devnetPackage, 'scrt_1_4.Dockerfile').path,
    'scrt_1.5': $(devnetPackage, 'scrt_1_5.Dockerfile').path,
    'scrt_1.6': $(devnetPackage, 'scrt_1_6.Dockerfile').path,
    'scrt_1.7': $(devnetPackage, 'scrt_1_7.Dockerfile').path,
    'scrt_1.8': $(devnetPackage, 'scrt_1_8.Dockerfile').path
  }

  static dockerTags: Record<DevnetPlatform, string> = {
    'scrt_1.2': 'ghcr.io/hackbg/fadroma-devnet-scrt-1.2:master',
    'scrt_1.3': 'ghcr.io/hackbg/fadroma-devnet-scrt-1.3:master',
    'scrt_1.4': 'ghcr.io/hackbg/fadroma-devnet-scrt-1.4:master',
    'scrt_1.5': 'ghcr.io/hackbg/fadroma-devnet-scrt-1.5:master',
    'scrt_1.6': 'ghcr.io/hackbg/fadroma-devnet-scrt-1.6:master',
    'scrt_1.7': 'ghcr.io/hackbg/fadroma-devnet-scrt-1.7:master',
    'scrt_1.8': 'ghcr.io/hackbg/fadroma-devnet-scrt-1.8:master',
  }

  static readyMessage: Record<DevnetPlatform, string> = {
    'scrt_1.2': 'indexed block',
    'scrt_1.3': 'indexed block',
    'scrt_1.4': 'indexed block',
    'scrt_1.5': 'indexed block',
    'scrt_1.6': 'indexed block',
    'scrt_1.7': 'indexed block',
    'scrt_1.8': 'Done verifying block height',
  }

  static initScriptMount = 'devnet.init.mjs'

  static getOrCreate (
    version: DevnetPlatform,
    dock:    Dock.Engine,
    port?:   number
  ) {
    const portMode    = devnetPortModes[version]
    const dockerfile  = this.dockerfiles[version]
    const imageTag    = this.dockerTags[version]
    const readyPhrase = this.readyMessage[version]
    //if (mountInitScript)
    //const initScript = $(devnetPackage, this.initScriptMount).path
    const image = dock.image(imageTag, dockerfile, [this.initScriptMount])
    return new DevnetContainer({ port, portMode, image, readyPhrase })
  }

  /** Filter logs when waiting for the ready phrase. */
  static logFilter (data: string) {
    return (
      data.length > 0                            &&
      !data.startsWith('TRACE ')                 &&
      !data.startsWith('DEBUG ')                 &&
      !data.startsWith('INFO ')                  &&
      !data.startsWith('I[')                     &&
      !data.startsWith('Storing key:')           &&
      !Devnet.RE_GARBAGE.test(data)                     &&
      !data.startsWith('{"app_message":')        &&
      !data.startsWith('configuration saved to') &&
      !(data.length>1000)
    )
  }

  log = new Console('DevnetContainer')

  /** This should point to the standard production docker image for the network. */
  image: Dock.Image
  /** Handle to created devnet container */
  container: Dock.Container|null = null
  /** If set, overrides the script that launches the devnet in the container. */
  initScript: string|null = null
  /** Mounted out of devnet container to persist keys of genesis wallets. */
  identities: JSONDirectory<unknown>
  /** Once this phrase is encountered in the log output
    * from the container, the devnet is ready to accept requests. */
  readyPhrase: string
  /** Throw if container is not ready in this many seconds. */
  launchTimeout: number = 10
  /** Overridable for testing. */
  //@ts-ignore
  protected waitPort = waitPort
  /** Seconds to wait after first block.
    * Overridable for testing. */
  protected postLaunchWait = 7
  /** Kludge. */
  private exitHandlerSet = false

  constructor (options: DockerDevnetOpts = {}) {
    super(options)
    this.identities  ??= this.stateRoot.in('wallet').as(JSONDirectory)
    this.image       ??= options.image!
    this.initScript  ??= options.initScript!
    this.readyPhrase ??= options.readyPhrase!
    this.log.log(options.image?.name, `on`, options.image?.engine?.constructor.name)
  }

  /** Handle to Docker API if configured. */
  get dock (): Dock.Engine|null {
    return this.image.engine
  }

  /** Gets the info for a genesis account, including the mnemonic */
  async getGenesisAccount (name: string): Promise<AgentOpts> {
    if (process.env.FADROMA_DEVNET_NO_STATE_MOUNT) {
      if (!this.container) throw new Error.Devnet.ContainerNotSet()
      const [identity] = await this.container.exec('cat', `/state/${this.chainId}/wallet/${name}.json`)
      return JSON.parse(identity)
    } else {
      return this.identities.at(`${name}.json`).as(JSONFile).load() as AgentOpts
    }
  }

  /** Virtual path inside the container where the init script is mounted. */
  get initScriptMount (): string {
    return this.initScript ? $('/', $(this.initScript).name).path : '/devnet.init.mjs'
  }

  async spawn () {
    // host is usr configurable, so should port
    this.host = process.env.FADROMA_DEVNET_HOST ?? this.host
    // if port is unspecified or taken, use a random port
    while (!this.port || await isPortTaken(this.port)) {
      this.port = (await freePort()) as number
      this.log.log('Trying port', this.port)
    }
    // tell the user that we have begun
    this.log.log(`Spawning new node to listen on`, bold(this.url))
    // create the state dirs and files
    const stateDirs = [ this.stateRoot, this.nodeState ]
    for (const item of stateDirs) item.make()
    // run the container
    this.container = await this.image.run(
      `${this.chainId}-${this.port}`,               // container name
      this.spawnOptions,                            // container options
      this.initScript ? [this.initScriptMount] : [] // command and arguments
    )
    // update the record
    this.save()
    // Wait for everything to be ready
    await this.container.waitLog(this.readyPhrase, DevnetContainer.logFilter, false)
    await Dock.Docker.waitSeconds(this.postLaunchWait)
    await this.waitPort({ host: this.host, port: Number(this.port) })
    return this
  }

  /** The @hackbg/dock options for spawining a container */
  get spawnOptions () {

    // Environment variables in devnet container
    const env: Record<string, string> = {
      Verbose:         process.env.FADROMA_DEVNET_VERBOSE ? 'yes' : '',
      ChainID:         this.chainId,
      GenesisAccounts: this.genesisAccounts.join(' '),
      _UID: String(process.env.FADROMA_DEVNET_UID??(process.getuid?process.getuid():1000)),
      _GID: String(process.env.FADROMA_DEVNET_GID??(process.getgid?process.getgid():1000)),
    }

    // Which kind of API to expose at the default container port
    switch (this.portMode) {
      case 'lcp':     env.lcpPort     = String(this.port);      break
      case 'grpcWeb': env.grpcWebAddr = `0.0.0.0:${this.port}`; break
      default: throw new Error.Devnet(`DockerDevnet#portMode must be either 'lcp' or 'grpcWeb'`)
    }

    // Container options
    const options = {
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
          Binds: [] as string[],
          PortBindings: { [`${this.port}/tcp`]: [{HostPort: `${this.port}`}] }
        }
      }
    }

    // Override init script for development
    if (this.initScript) {
      options.extra.HostConfig.Binds.push(
        `${this.initScript}:${this.initScriptMount}:ro`
      )
    }

    // Mount receipts directory (FIXME:
    // - breaks Drone DinD CI
    // - leaves root-owned files in project dir)
    if (!process.env.FADROMA_DEVNET_NO_STATE_MOUNT) {
      options.extra.HostConfig.Binds.push(
        `${this.stateRoot.path}:/state/${this.chainId}:rw`
      )
    }

    return options

  }

  async load (): Promise<DevnetState> {
    const data = await super.load()
    if (data?.containerId) {
      this.container = await this.dock!.container(data.containerId)
    } else {
      throw new Error.Devnet('missing container id in devnet state')
    }
    return data
  }

  /** Write the state of the devnet to a file. */
  save () {
    return super.save({ containerId: this.container?.id })
  }

  /** Spawn the existing localnet, or a new one if that is impossible */
  async respawn () {
    const shortPath = $(this.nodeState.path).shortPath

    // if no node state, spawn
    if (!this.nodeState.exists()) {
      this.log.info(`No devnet found at ${bold(shortPath)}`)
      return this.spawn()
    }

    // get stored info about the container was supposed to be
    let id: string
    try {
      id = (await this.load()).containerId!
    } catch (e) {
      if (!(e?.statusCode == 404 && e?.json?.message.startsWith('No such container'))) {
        this.log.warn(e)
      } else {
        this.log.warn('Devnet container not found, recreating')
      }
      this.log.info(`Reading ${bold(shortPath)} failed, starting devnet container`)
      return this.spawn()
    }

    this.container = await this.dock!.container(id)

    // check if contract is running
    let running: boolean
    try {
      running = await this.container.isRunning
    } catch (e) {
      // if error when checking, RESPAWN
      this.log.info(`✋ Failed to get container ${bold(id)}`)
      this.log.info('Error was:', e)
      this.log.info(`Cleaning up outdated state...`)
      await this.erase()
      this.log.info(`Trying to launch a new node...`)
      return this.spawn()
    }

    // if not running, RESPAWN
    if (!running) {
      await this.container.start()
    }

    // ...and try to make sure it dies when the Node process dies
    if (!this.exitHandlerSet) {
      process.on('beforeExit', () => {
        if (this.ephemeral) {
          this.container!.kill()
        } else {
          this.log.br()
          this.log.devnet.isNowRunning(this)
        }
      })
      this.exitHandlerSet = true
    }

    return this
  }

  /** Kill the container, if necessary find it first */
  async kill () {
    if (this.container) {
      const { id } = this.container
      await this.container.kill()
      this.log.log(`Stopped container`, bold(id))
      return
    }
    this.log.log(`Checking if there's an old node that needs to be stopped...`)
    try {
      const { containerId } = await this.load()
      await this.container!.kill()
      this.log.log(`Stopped container ${bold(containerId!)}.`)
    } catch (_e) {
      this.log.log("Didn't stop any container.")
    }
  }

  /** External environment needs to be returned to a pristine state via Docker.
    * (Otherwise, root-owned dotdirs leak and have to be manually removed with sudo.) */
  async erase () {
    const path = this.stateRoot.shortPath
    try {
      if (this.stateRoot.exists()) {
        this.log.info(`Deleting ${path}...`)
        this.stateRoot.delete()
      }
    } catch (e: any) {
      if (e.code === 'EACCES' || e.code === 'ENOTEMPTY') {
        this.log.warn(`Failed to delete ${path}: ${e.code}; trying cleanup container...`)
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
        this.log.info(`Starting cleanup container...`)
        await cleanupContainer.start()
        this.log.info('Waiting for cleanup to finish...')
        await cleanupContainer.wait()
        this.log.info(`Deleted ${path} via cleanup container.`)
      } else {
        this.log.warn(`Failed to delete ${path}: ${e.message}`)
        throw e
      }
    }
  }

  async export (repository?: string, tag?: string) {
    if (!this.container) throw new Error.Devnet("Can't export: no container")
    return this.container.export(repository, tag)
  }
}

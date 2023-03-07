import ConnectConfig from './ConnectConfig'
import ConnectCommands from './ConnectCommands'
import Console from './ConnectConsole'

import { Deployment } from '@fadroma/core'
import type { Class } from '@fadroma/core'

import { bold } from '@hackbg/logs'
import type { CommandContext } from '@hackbg/cmds'

/** A Deployment with associated Agent and awareness of other chains. */
export default class Connector extends Deployment {

  constructor (options: Partial<Connector>) {
    const { config = new ConnectConfig() } = options ?? {}
    super(options as Partial<Deployment>)
    this.config = config
    //this.addCommands(
      //'chain',
      //'manage chains' + (
        //this.config.chainSelector ? ` (current: ${bold(this.config.chainSelector)})` : ''
      //),
      //new ConnectCommands(this) as CommandContext
    //)
  }

  /** Logger */
  log = new Console('@fadroma/connect')

  /** Configuration. */
  config: ConnectConfig

  /** List all known chains. */
  async listChains () {
    this.log.supportedChains()
    this.log.selectedChain(this.config.chainSelector as string)
  }

}

/** Constructor for a subclass of Connector that
  * maintains the original constructor signature. */
export interface ConnectorClass<C extends Connector> extends Class<C, [
  Partial<Connector>
]>{}

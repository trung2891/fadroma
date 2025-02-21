import { Config } from '@hackbg/conf'
import type { Environment } from '@hackbg/conf'
import { Console, Error, bold } from '@fadroma/agent'
import type { Address, ChainId, Fee } from '@fadroma/agent'

/** Environment settings for Secret Network. */
class ScrtConfig extends Config {
  /** The mainnet chain ID. */
  static defaultMainnetChainId: string = 'secret-4'
  /** The mainnet URL. */
  static defaultMainnetUrl:     string = 'https://lcd.mainnet.secretsaturn.net'
  /** The testnet chain ID. */
  static defaultTestnetChainId: string = 'pulsar-3'
  /** The testnet URL. */
  static defaultTestnetUrl:     string = 'https://api.pulsar3.scrttestnet.com/'

  constructor (
    options: Partial<ScrtConfig> = {},
    environment?: Environment
  ) {
    super(environment)
    this.override(options)
  }

  agentName: string|null = this.getString(
    'FADROMA_SCRT_AGENT_NAME', ()=>null)
  agentMnemonic: string|null = this.getString(
    'FADROMA_SCRT_AGENT_MNEMONIC', ()=>null)
  mainnetChainId: string = this.getString(
    'FADROMA_SCRT_MAINNET_CHAIN_ID', ()=>ScrtConfig.defaultMainnetChainId)
  testnetChainId: string = this.getString(
    'FADROMA_SCRT_TESTNET_CHAIN_ID', ()=>ScrtConfig.defaultTestnetChainId)
  mainnetUrl: string = this.getString(
    'FADROMA_SCRT_MAINNET_URL', ()=>ScrtConfig.defaultMainnetUrl)
  testnetUrl: string = this.getString(
    'FADROMA_SCRT_TESTNET_URL', ()=>ScrtConfig.defaultTestnetUrl)
}

class ScrtError extends Error {}

class ScrtConsole extends Console {
  label = '@fadroma/scrt'

  noMemos = () => this.warn(
    "transaction memos are not supported.")
  defaultGas = (fees: Fee[]) => this.warn(
    "could not fetch block gas limit, defaulting to:",
    fees.map(fee=>fee.gas).join('/'))
  ignoringMnemonic = () => this.warn(
    'created agent from passed wallet, ignoring mnemonic')
  generatedMnemonic = (mnemonic: string, address?: string) => {
    this.warn("No mnemonic passed, generated this one:", bold(mnemonic))
    if (address) this.warn("The corresponding address is:", bold(address))
    this.warn("To specify a default mnemonic, set the FADROMA_MNEMONIC environment variable.")
    return this
  }
  bundleSigningCommand = (
    name: string, multisig: Address, chainId: ChainId, accountNumber: number, sequence: number,
    unsigned: any
  ) => {
    const output = `${name}.signed.json`
    const string = JSON.stringify(unsigned)
    const txdata = shellescape([string])
    this.br()
    this.log('Multisig bundle ready.')
    this.log(`Run the following command to sign the bundle:
\nsecretcli tx sign /dev/stdin --output-document=${output} \\
--offline --from=YOUR_MULTISIG_MEMBER_ACCOUNT_NAME_HERE --multisig=${multisig} \\
--chain-id=${chainId} --account-number=${accountNumber} --sequence=${sequence} \\
<<< ${txdata}`)
    this.br()
    this.log(`Bundle contents:`, JSON.stringify(unsigned, null, 2))
    this.br()
  }
  submittingBundleFailed = ({ message }: Error) => {
    this.br()
    this.error('submitting bundle failed:')
    this.error(bold(message))
    this.warn('(decrypting bundle errors is not implemented)')
  }
}

export { ScrtConfig as Config, ScrtError as Error, ScrtConsole as Console, }

function shellescape (a: string[]) {
  const ret: string[] = [];
  a.forEach(function(s: string) {
    if (/[^A-Za-z0-9_\/:=-]/.test(s)) {
      s = "'"+s.replace(/'/g,"'\\''")+"'";
      s = s.replace(/^(?:'')+/g, '') // unduplicate single-quote at the beginning
        .replace(/\\'''/g, "\\'" ); // remove non-escaped single-quote if there are enclosed between 2 escaped
    }
    ret.push(s);
  });
  return ret.join(' ');
}

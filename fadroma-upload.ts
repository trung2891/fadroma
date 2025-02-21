/**

  Fadroma Upload
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

import type {
  Agent, CodeHash, ChainId, CodeId, Uploadable, Uploaded, AnyContract,
} from './fadroma'
import Config from './fadroma-config'

import {
  Template, Uploader, assertAgent, toUploadReceipt, base16, sha256,
  hideProperties as hide, Error as BaseError, Console, colors, bold
} from '@fadroma/connect'

import $, { Path, BinaryFile, JSONFile, JSONDirectory } from '@hackbg/file'

import { fileURLToPath } from 'node:url'

/** Uploads contracts from the local filesystem, with optional caching:
  * if provided with an Uploads directory containing upload receipts,
  * allows for uploaded contracts to be reused. */
export class FSUploader extends Uploader {
  get [Symbol.toStringTag] () { return this.store?.shortPath ?? '(*)' }
  log = new UploadConsole('upload (node:fs)')
  /** Unique identifier of this uploader implementation. */
  id = 'FS'
  /** Directory with JSON files */
  store = new JSONDirectory<UploadReceipt_v1>()
  /** @returns Uploaded from the cache or store or undefined */
  get (uploadable: Uploadable): Uploaded|undefined {
    this.addCodeHash(uploadable)
    const cached = super.get(uploadable)
    if (cached) return cached
    const { codeHash } = uploadable
    if (!this.agent) throw new UploadError.Missing.Agent()
    if (!this.agent.chain) throw new UploadError.Missing.Chain()
    const receipt = this.store
      .in('state')
      .in(this.agent.chain.id)
      .in('upload')
      .at(`${codeHash!.toLowerCase()}.json`)
      .as(JSONFile<Uploaded>)
    if (receipt.exists()) {
      const uploaded = receipt.load() as unknown as Uploaded
      this.log.receiptCodeId(receipt, uploaded.codeId)
      if (uploaded.codeId) return this.cache[codeHash!] = uploaded
    }
  }
  /** Add an Uploaded to the cache and store. */
  set (uploaded: Uploaded): this {
    this.addCodeHash(uploaded)
    super.set(uploaded)
    if (!this.agent) throw new UploadError.Missing.Agent()
    if (!this.agent.chain) throw new UploadError.Missing.Chain()
    const receipt = this.store
      .in('state')
      .in(this.agent.chain.id)
      .in('upload')
      .at(`${uploaded.codeHash!.toLowerCase()}.json`)
      .as(JSONFile<Uploaded>)
    this.log('writing', receipt.shortPath)
    receipt.save({
      artifact: String(uploaded.artifact),
      chainId:  uploaded.chainId || this.agent.chain.id,
      codeId:   uploaded.codeId,
      codeHash: uploaded.codeHash,
      uploadTx: uploaded.uploadTx
    })
    return this
  }
  protected addCodeHash (uploadable: Partial<Uploadable & { name: string }>) {
    if (!uploadable.codeHash) {
      if (uploadable.artifact) {
        uploadable.codeHash = base16.encode(sha256(this.fetchSync(uploadable.artifact)))
        this.log(`hashed ${String(uploadable.artifact)}:`, uploadable.codeHash)
      } else {
        this.log(`no artifact, can't compute code hash for: ${uploadable?.name||'(unnamed)'}`)
      }
    }
  }
  protected async fetch (path: string|URL): Promise<Uint8Array> {
    return await Promise.resolve(this.fetchSync(path))
  }
  protected fetchSync (path: string|URL): Uint8Array {
    return $(fileURLToPath(new URL(path, 'file:'))).as(BinaryFile).load()
  }
}

Uploader.variants['FS'] = FSUploader


/** Class that convert itself to a `Template`,
  * from which `Contract`s can subsequently be instantiated. */
export class UploadReceipt_v1 extends JSONFile<UploadReceiptData> {
  /** Create a Template object with the data from the receipt. */
  toTemplate (defaultChainId?: string) {
    let { chainId, codeId, codeHash, uploadTx, artifact } = this.load()
    chainId ??= defaultChainId
    codeId  = String(codeId)
    return new Template({ artifact, codeHash, chainId, codeId, uploadTx })
  }
}

export interface UploadReceiptData {
  artifact?:          any
  chainId?:           string
  codeHash:           string
  codeId:             number|string
  compressedChecksum: string
  compressedSize:     string
  logs:               any[]
  originalChecksum:   string
  originalSize:       number
  transactionHash:    string
  uploadTx?:          string
}

export class UploadError extends BaseError {}

class UploadConsole extends Console {
  receiptCodeId = (receipt: Path, id?: CodeId) => id
    ? this.log('found code id', id, 'at', receipt.shortPath)
    : this.warn(receipt.shortPath, 'contained no "codeId"')
}

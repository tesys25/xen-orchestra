// TODO: remove once completely merged in vhd.js

import assert from 'assert'
import concurrency from 'limit-concurrency-decorator'

import Vhd from './vhd'
import { DISK_TYPE_DIFFERENCING, DISK_TYPE_DYNAMIC } from './_constants'

// Merge vhd child into vhd parent.
export default concurrency(2)(async function merge (
  parentHandler,
  parentPath,
  childHandler,
  childPath
) {
  const parentFd = await parentHandler.openFile(parentPath, 'r+')
  try {
    const parentVhd = new Vhd(parentHandler, parentFd)
    const childFd = await childHandler.openFile(childPath, 'r')
    try {
      const childVhd = new Vhd(childHandler, childFd)

      // Reading footer and header.
      await Promise.all([
        parentVhd.readHeaderAndFooter(),
        childVhd.readHeaderAndFooter(),
      ])

      assert(childVhd.header.blockSize === parentVhd.header.blockSize)

      const parentDiskType = parentVhd.footer.diskType
      assert(
        parentDiskType === DISK_TYPE_DIFFERENCING ||
          parentDiskType === DISK_TYPE_DYNAMIC
      )
      assert.strictEqual(childVhd.footer.diskType, DISK_TYPE_DIFFERENCING)

      // Read allocation table of child/parent.
      await Promise.all([
        parentVhd.readBlockAllocationTable(),
        childVhd.readBlockAllocationTable(),
      ])

      await parentVhd.ensureBatSize(childVhd.header.maxTableEntries)

      let mergedDataSize = 0
      for (
        let blockId = 0;
        blockId < childVhd.header.maxTableEntries;
        blockId++
      ) {
        if (childVhd.containsBlock(blockId)) {
          mergedDataSize += await parentVhd.coalesceBlock(childVhd, blockId)
        }
      }

      const cFooter = childVhd.footer
      const pFooter = parentVhd.footer

      pFooter.currentSize = cFooter.currentSize
      pFooter.diskGeometry = { ...cFooter.diskGeometry }
      pFooter.originalSize = cFooter.originalSize
      pFooter.timestamp = cFooter.timestamp
      pFooter.uuid = cFooter.uuid

      // necessary to update values and to recreate the footer after block
      // creation
      await parentVhd.writeFooter()

      return mergedDataSize
    } finally {
      await childHandler.closeFile(childFd)
    }
  } finally {
    await parentHandler.closeFile(parentFd)
  }
})

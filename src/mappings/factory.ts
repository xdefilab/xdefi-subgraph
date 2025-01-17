import { BigInt, BigDecimal } from '@graphprotocol/graph-ts'
import { LOG_NEW_POOL } from '../types/Factory/Factory'
import { XDEFI, Pool } from '../types/schema'
import { Pool as PoolContract } from '../types/templates'
import { ZERO_BD, DEFAULT_SAFU_FEE_BD } from './helpers'



export function handleNewPool(event: LOG_NEW_POOL): void {
    let factory = XDEFI.load('1')

    // if no factory yet, set up blank initial
    if (factory == null) {
        factory = new XDEFI('1')
        factory.version = 'APOLLO'
        factory.poolCount = 0
        factory.finalizedPoolCount = 0
        factory.txCount = BigInt.fromI32(0)
        factory.totalLiquidity = ZERO_BD
        factory.totalSwapVolume = ZERO_BD
        factory.totalSwapFee = ZERO_BD
    }
    factory.poolCount = factory.poolCount + 1
    factory.save()

    let pool = new Pool(event.params.pool.toHexString())
    pool.controller = event.params.caller
    pool.publicSwap = false
    pool.finalized = false
    pool.active = true
    pool.isFarm = false
    pool.swapFee = BigDecimal.fromString('0.0001')
    pool.exitFee = ZERO_BD
    pool.safuFee = DEFAULT_SAFU_FEE_BD
    pool.totalWeight = ZERO_BD
    pool.totalShares = ZERO_BD
    pool.totalSwapVolume = ZERO_BD
    pool.totalSwapFee = ZERO_BD
    pool.liquidity = ZERO_BD
    pool.createTime = event.block.timestamp
    pool.tokensCount = BigInt.fromI32(0)
    pool.holdersCount = BigInt.fromI32(0)
    pool.joinsCount = BigInt.fromI32(0)
    pool.exitsCount = BigInt.fromI32(0)
    pool.swapsCount = BigInt.fromI32(0)
    pool.factoryID = event.address.toHexString()
    pool.tokensList = []
    pool.tx = event.transaction.hash
    pool.save()

    PoolContract.create(event.params.pool)
}

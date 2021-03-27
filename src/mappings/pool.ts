import { BigInt, Address, Bytes, store, BigDecimal } from '@graphprotocol/graph-ts'
import { LOG_CALL, LOG_JOIN, LOG_EXIT, LOG_SWAP, LOG_REFER, LOG_BIND, LOG_FINAL, LOG_EXIT_FEE, Transfer, UPDATE_FARM, LOG_UPDATE_SAFU, GulpCall } from '../types/templates/Pool/Pool'
import { Pool as XPool } from '../types/templates/Pool/Pool'
import {
    XDEFI,
    Pool,
    PoolToken,
    PoolShare,
    Swap,
    TokenPrice,
    //Referral,
    ReferralTrx
} from '../types/schema'
import {
    hexToDecimal,
    bigIntToDecimal,
    tokenToDecimal,
    createPoolShareEntity,
    createPoolTokenEntity,
    updatePoolLiquidity,
    saveTransaction,
    ZERO_BD,
    MIN_EFFETIVE_BD
} from './helpers'
import { log } from '@graphprotocol/graph-ts'

/************************************
 ********** Pool Controls ***********
 ************************************/

export function handleSetExitFee(event: LOG_EXIT_FEE): void {
    let poolId = event.address.toHex()
    let pool = Pool.load(poolId)
    pool.exitFee = tokenToDecimal(event.params.fee.toBigDecimal(), 18)
    pool.save()

    saveTransaction(event, 'setExitFee')
}

export function handleSetController(event: LOG_CALL): void {
    let poolId = event.address.toHex()
    let pool = Pool.load(poolId)
    let controller = Address.fromString(event.params.data.toHexString().slice(-40))
    pool.controller = controller
    pool.save()

    saveTransaction(event, 'setController')
}

export function handleFinalize(event: LOG_FINAL): void {
    let poolId = event.address.toHex()

    let pool = Pool.load(poolId)
    // let balance = BigDecimal.fromString('100')
    pool.finalized = true
    pool.name = 'XDeFi Pool Token (XPT)'
    pool.symbol = 'XPT'
    pool.publicSwap = true
    // pool.totalShares = balance
    pool.swapFee = tokenToDecimal(event.params.swapFee.toBigDecimal(), 18)
    pool.save()

    /*
    let poolShareId = poolId.concat('-').concat(event.params.caller.toHex())
    let poolShare = PoolShare.load(poolShareId)
    if (poolShare == null) {
      createPoolShareEntity(poolShareId, poolId, event.params.caller.toHex())
      poolShare = PoolShare.load(poolShareId)
    }
    poolShare.balance = balance
    poolShare.save()
    */

    let factory = XDEFI.load('1')
    factory.finalizedPoolCount = factory.finalizedPoolCount + 1
    factory.save()

    saveTransaction(event, 'finalize')
}

export function handleBind(event: LOG_BIND): void {
    let poolId = event.address.toHex()
    let pool = Pool.load(poolId)
    let tokenBytes = (Bytes.fromHexString(event.params.token.toHexString()) as Bytes)
    let tokensList = pool.tokensList || []
    if (tokensList.indexOf(tokenBytes) == -1) {
        tokensList.push(tokenBytes)
    }
    pool.tokensList = tokensList
    pool.tokensCount = BigInt.fromI32(tokensList.length)

    let denormWeight = event.params.denorm.toBigDecimal()

    let poolTokenId = poolId.concat('-').concat(event.params.token.toHexString())
    let poolToken = PoolToken.load(poolTokenId)
    if (poolToken == null) {
        createPoolTokenEntity(poolTokenId, poolId, event.params.token.toHexString())
        poolToken = PoolToken.load(poolTokenId)
        pool.totalWeight += denormWeight
    }

    let balance = bigIntToDecimal(event.params.balance, poolToken.decimals)
    poolToken.balance = balance
    poolToken.denormWeight = denormWeight
    poolToken.save()

    if (balance.equals(ZERO_BD)) {
        pool.active = false
    }
    pool.save()

    updatePoolLiquidity(poolId)
    saveTransaction(event, 'bind')
}

export function handleUpdateFarm(event: UPDATE_FARM): void {
    let poolId = event.address.toHex()
    let pool = Pool.load(poolId)
    pool.isFarm = event.params.isFarm;

    pool.save()

    saveTransaction(event, 'updateFarm')
}

export function handleUpdateSafu(event: LOG_UPDATE_SAFU): void {
    let poolId = event.address.toHex()
    let pool = Pool.load(poolId)
    pool.safuFee = tokenToDecimal(event.params.fee.toBigDecimal(), 18)
    pool.save()

    saveTransaction(event, 'updateSafu')
}

export function handleGulp(call: GulpCall): void {
    let poolId = call.to.toHexString()

    let address = call.inputs.token.toHexString()

    let pool = XPool.bind(Address.fromString(poolId))
    let balanceCall = pool.try_getBalance(Address.fromString(address))

    let poolTokenId = poolId.concat('-').concat(address)
    let poolToken = PoolToken.load(poolTokenId)

    if (poolToken != null) {
        let balance = ZERO_BD
        if (!balanceCall.reverted) {
            balance = bigIntToDecimal(balanceCall.value, poolToken.decimals)
        }
        poolToken.balance = balance
        poolToken.save()
    }

    updatePoolLiquidity(poolId)
}

/************************************
 ********** JOINS & EXITS ***********
 ************************************/

export function handleJoinPool(event: LOG_JOIN): void {
    let poolId = event.address.toHex()
    let pool = Pool.load(poolId)
    pool.joinsCount += BigInt.fromI32(1)
    pool.save()

    let address = event.params.tokenIn.toHex()
    let poolTokenId = poolId.concat('-').concat(address.toString())
    let poolToken = PoolToken.load(poolTokenId)
    let tokenAmountIn = tokenToDecimal(event.params.tokenAmountIn.toBigDecimal(), poolToken.decimals)
    let newAmount = poolToken.balance.plus(tokenAmountIn)
    poolToken.balance = newAmount
    poolToken.save()

    updatePoolLiquidity(poolId)
    saveTransaction(event, 'join')
}

export function handleExitPool(event: LOG_EXIT): void {
    let poolId = event.address.toHex()

    let address = event.params.tokenOut.toHex()
    let poolTokenId = poolId.concat('-').concat(address.toString())
    let poolToken = PoolToken.load(poolTokenId)
    let tokenAmountOut = tokenToDecimal(event.params.tokenAmountOut.toBigDecimal(), poolToken.decimals)
    let newAmount = poolToken.balance.minus(tokenAmountOut)
    poolToken.balance = newAmount
    poolToken.save()

    let pool = Pool.load(poolId)
    pool.exitsCount += BigInt.fromI32(1)
    if (newAmount.le(MIN_EFFETIVE_BD)) {
        pool.active = false

        let factory = XDEFI.load('1')
        factory.finalizedPoolCount = factory.finalizedPoolCount - 1
        factory.save()
    }
    pool.save()

    updatePoolLiquidity(poolId)
    saveTransaction(event, 'exit')
}

/************************************
 ************** SWAPS ***************
 ************************************/

export function handleRefer(event: LOG_REFER): void {
    let poolId = event.address.toHex()

    let referralTrx = new ReferralTrx(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
    referralTrx.caller = event.params.caller
    referralTrx.referrer = event.params.ref
    referralTrx.token = event.params.tokenIn
    referralTrx.fee = event.params.fee.toBigDecimal()
    referralTrx.timestamp = event.block.timestamp
    referralTrx.poolId = poolId
    referralTrx.save()

    // let referral = Referral.load(event.params.ref.toHex())
    // if (referral == null) {
    //     referral = new Referral(event.params.ref.toHex())
    //     referral.totalFeeValue = ZERO_BD;
    // }
    // referral.lastUpdated = event.block.timestamp
    // referral.save()

    let pool = Pool.load(poolId)
    let tokenIn = event.params.tokenIn.toHex()
    let poolTokenInId = poolId.concat('-').concat(tokenIn.toString())
    let poolTokenIn = PoolToken.load(poolTokenInId)
    // to referral
    let referFee = tokenToDecimal(event.params.fee.toBigDecimal(), poolTokenIn.decimals)
    let newAmountIn = poolTokenIn.balance.minus(referFee)
    if (pool.isFarm) {
        newAmountIn = poolTokenIn.balance
    }
    poolTokenIn.balance = newAmountIn
    poolTokenIn.save()

    saveTransaction(event, 'referral')
}

export function handleSwap(event: LOG_SWAP): void {
    let poolId = event.address.toHex()
    let pool = Pool.load(poolId)
    let tokenIn = event.params.tokenIn.toHex()
    let poolTokenInId = poolId.concat('-').concat(tokenIn.toString())
    let poolTokenIn = PoolToken.load(poolTokenInId)
    let tokenAmountIn = tokenToDecimal(event.params.tokenAmountIn.toBigDecimal(), poolTokenIn.decimals)
    let newAmountIn = poolTokenIn.balance.plus(tokenAmountIn)
    // to SAFU
    let safuFee = tokenAmountIn.times(pool.safuFee)
    if (pool.isFarm) {
        safuFee = tokenAmountIn.times(pool.swapFee)
    }
    newAmountIn = newAmountIn.minus(safuFee)

    poolTokenIn.balance = newAmountIn
    poolTokenIn.save()

    let tokenOut = event.params.tokenOut.toHex()
    let poolTokenOutId = poolId.concat('-').concat(tokenOut.toString())
    let poolTokenOut = PoolToken.load(poolTokenOutId)
    let tokenAmountOut = tokenToDecimal(event.params.tokenAmountOut.toBigDecimal(), poolTokenOut.decimals)
    let newAmountOut = poolTokenOut.balance.minus(tokenAmountOut)
    poolTokenOut.balance = newAmountOut
    poolTokenOut.save()

    updatePoolLiquidity(poolId)
    pool = Pool.load(poolId)

    let swapId = event.transaction.hash.toHexString().concat('-').concat(event.logIndex.toString())
    let swap = Swap.load(swapId)
    if (swap == null) {
        swap = new Swap(swapId)
    }

    let tokensList: Array<Bytes> = pool.tokensList
    let tokenOutPriceValue = ZERO_BD
    let tokenOutPrice = TokenPrice.load(tokenOut)

    if (tokenOutPrice != null) {
        tokenOutPriceValue = tokenOutPrice.price
    } else {
        for (let i: i32 = 0; i < tokensList.length; i++) {
            let tokenPriceId = tokensList[i].toHexString()
            if (!tokenOutPriceValue.gt(ZERO_BD) && tokenPriceId !== tokenOut) {
                let tokenPrice = TokenPrice.load(tokenPriceId)
                if (tokenPrice !== null && tokenPrice.price.gt(ZERO_BD)) {
                    let poolTokenId = poolId.concat('-').concat(tokenPriceId)
                    let poolToken = PoolToken.load(poolTokenId)
                    tokenOutPriceValue = tokenPrice.price
                        .times(poolToken.balance)
                        .div(poolToken.denormWeight)
                        .times(poolTokenOut.denormWeight)
                        .div(poolTokenOut.balance)
                }
            }
        }
    }

    let totalSwapVolume = pool.totalSwapVolume
    let totalSwapFee = pool.totalSwapFee
    let liquidity = pool.liquidity
    let swapValue = ZERO_BD
    let swapFeeValue = ZERO_BD

    if (tokenOutPriceValue.gt(ZERO_BD)) {
        swapValue = tokenOutPriceValue.times(tokenAmountOut)
        swapFeeValue = swapValue.times(pool.swapFee)
        totalSwapVolume = totalSwapVolume.plus(swapValue)
        totalSwapFee = totalSwapFee.plus(swapFeeValue)

        let factory = XDEFI.load('1')
        factory.totalSwapVolume = factory.totalSwapVolume.plus(swapValue)
        factory.totalSwapFee = factory.totalSwapFee.plus(swapFeeValue)
        factory.save()

        pool.totalSwapVolume = totalSwapVolume
        pool.totalSwapFee = totalSwapFee
    }
    pool.swapsCount += BigInt.fromI32(1)
    if (newAmountIn.equals(ZERO_BD) || newAmountOut.equals(ZERO_BD)) {
        pool.active = false
    }
    pool.save()

    swap.caller = event.params.caller
    swap.tokenIn = event.params.tokenIn
    swap.tokenInSym = poolTokenIn.symbol
    swap.tokenOut = event.params.tokenOut
    swap.tokenOutSym = poolTokenOut.symbol
    swap.tokenAmountIn = tokenAmountIn
    swap.tokenAmountOut = tokenAmountOut
    swap.poolAddress = event.address.toHex()
    swap.userAddress = event.transaction.from.toHex()
    swap.poolTotalSwapVolume = totalSwapVolume
    swap.poolTotalSwapFee = totalSwapFee
    swap.poolLiquidity = liquidity
    swap.value = swapValue
    swap.feeValue = swapFeeValue
    swap.timestamp = event.block.timestamp
    swap.save()

    saveTransaction(event, 'swap')
}


/************************************
 *********** POOL SHARES ************
 ************************************/

export function handleTransfer(event: Transfer): void {
    let poolId = event.address.toHex()

    let ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

    let isMint = event.params.src.toHex() == ZERO_ADDRESS
    let isBurn = event.params.dst.toHex() == ZERO_ADDRESS

    let poolShareFromId = poolId.concat('-').concat(event.params.src.toHex())
    let poolShareFrom = PoolShare.load(poolShareFromId)
    let poolShareFromBalance = poolShareFrom == null ? ZERO_BD : poolShareFrom.balance

    let poolShareToId = poolId.concat('-').concat(event.params.dst.toHex())
    let poolShareTo = PoolShare.load(poolShareToId)
    let poolShareToBalance = poolShareTo == null ? ZERO_BD : poolShareTo.balance

    let pool = Pool.load(poolId)

    if (isMint) {
        if (poolShareTo == null) {
            createPoolShareEntity(poolShareToId, poolId, event.params.dst.toHex())
            poolShareTo = PoolShare.load(poolShareToId)
        }
        poolShareTo.balance += tokenToDecimal(event.params.amt.toBigDecimal(), 18)
        poolShareTo.save()
        pool.totalShares += tokenToDecimal(event.params.amt.toBigDecimal(), 18)
    } else if (isBurn) {
        if (poolShareFrom == null) {
            createPoolShareEntity(poolShareFromId, poolId, event.params.src.toHex())
            poolShareFrom = PoolShare.load(poolShareFromId)
        }
        poolShareFrom.balance -= tokenToDecimal(event.params.amt.toBigDecimal(), 18)
        poolShareFrom.save()
        pool.totalShares -= tokenToDecimal(event.params.amt.toBigDecimal(), 18)
    } else {
        if (poolShareTo == null) {
            createPoolShareEntity(poolShareToId, poolId, event.params.dst.toHex())
            poolShareTo = PoolShare.load(poolShareToId)
        }
        poolShareTo.balance += tokenToDecimal(event.params.amt.toBigDecimal(), 18)
        poolShareTo.save()

        if (poolShareFrom == null) {
            createPoolShareEntity(poolShareFromId, poolId, event.params.src.toHex())
            poolShareFrom = PoolShare.load(poolShareFromId)
        }
        poolShareFrom.balance -= tokenToDecimal(event.params.amt.toBigDecimal(), 18)
        poolShareFrom.save()
    }

    if (
        poolShareTo !== null
        && poolShareTo.balance.notEqual(ZERO_BD)
        && poolShareToBalance.equals(ZERO_BD)
    ) {
        pool.holdersCount += BigInt.fromI32(1)
    }

    if (
        poolShareFrom !== null
        && poolShareFrom.balance.equals(ZERO_BD)
        && poolShareFromBalance.notEqual(ZERO_BD)
    ) {
        pool.holdersCount -= BigInt.fromI32(1)
    }

    pool.save()
}

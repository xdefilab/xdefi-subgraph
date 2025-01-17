import {
    BigDecimal,
    Address,
    BigInt,
    Bytes,
    dataSource,
    ethereum
} from '@graphprotocol/graph-ts'
import {
    Pool,
    User,
    PoolToken,
    PoolShare,
    TokenPrice,
    Transaction,
    XDEFI
} from '../types/schema'
import { XPTokenBytes } from '../types/templates/Pool/XPTokenBytes'
import { XPToken } from '../types/templates/Pool/XPToken'
import { log } from '@graphprotocol/graph-ts'

export let ZERO_BD = BigDecimal.fromString('0')
export let MIN_EFFETIVE_BD = BigDecimal.fromString('0.0001')
export let ONE_BD = BigDecimal.fromString('1')
export let DEFAULT_SAFU_FEE_BD = BigDecimal.fromString('0.0005')

let network = dataSource.network()

// Config for mainnet
let WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
let USD = '0xdac17f958d2ee523a2206206994597c13d831ec7' //USDT
let DAI = '0x6b175474e89094c44da98b954eedeac495271d0f' //DAI

if (network == 'kovan') {
    WETH = '0xd0a1e359811322d97991e03f863a0c30c2cf029c'
    USD = '0xde99c79533eeb1897d1d12df3e5437d498ba82a6' //xdai
    DAI = '0x993e60ed0061637b9c2065d0e37444112429c4aa' //xusdt
}

export function hexToDecimal(hexString: String, decimals: i32): BigDecimal {
    let bytes = Bytes.fromHexString(hexString).reverse() as Bytes
    let bi = BigInt.fromUnsignedBytes(bytes)
    let scale = BigInt.fromI32(10).pow(decimals as u8).toBigDecimal()
    return bi.divDecimal(scale)
}

export function bigIntToDecimal(amount: BigInt, decimals: i32): BigDecimal {
    let scale = BigInt.fromI32(10).pow(decimals as u8).toBigDecimal()
    return amount.toBigDecimal().div(scale)
}

export function tokenToDecimal(amount: BigDecimal, decimals: i32): BigDecimal {
    let scale = BigInt.fromI32(10).pow(decimals as u8).toBigDecimal()
    return amount.div(scale)
}

export function createPoolShareEntity(id: string, pool: string, user: string): void {
    let poolShare = new PoolShare(id)

    createUserEntity(user)

    poolShare.userAddress = user
    poolShare.poolId = pool
    poolShare.balance = ZERO_BD
    poolShare.save()
}

export function createPoolTokenEntity(id: string, pool: string, address: string): void {
    let token = XPToken.bind(Address.fromString(address))
    let tokenBytes = XPTokenBytes.bind(Address.fromString(address))
    let symbol = ''
    let name = ''
    let decimals = 18

    // COMMENT THE LINES BELOW OUT FOR LOCAL DEV ON KOVAN

    let symbolCall = token.try_symbol()
    let nameCall = token.try_name()
    let decimalCall = token.try_decimals()

    if (symbolCall.reverted) {
        let symbolBytesCall = tokenBytes.try_symbol()
        if (!symbolBytesCall.reverted) {
            symbol = symbolBytesCall.value.toString()
        }
    } else {
        symbol = symbolCall.value
    }

    if (nameCall.reverted) {
        let nameBytesCall = tokenBytes.try_name()
        if (!nameBytesCall.reverted) {
            name = nameBytesCall.value.toString()
        }
    } else {
        name = nameCall.value
    }

    if (!decimalCall.reverted) {
        decimals = decimalCall.value
    }

    // COMMENT THE LINES ABOVE OUT FOR LOCAL DEV ON KOVAN

    // !!! COMMENT THE LINES BELOW OUT FOR NON-LOCAL DEPLOYMENT
    // This code allows Symbols to be added when testing on local Kovan
    /*
    if (address == '0xd0a1e359811322d97991e03f863a0c30c2cf029c')
        symbol = 'WETH';
    else if (address == '0x4F96Fe3b7A6Cf9725f59d353F723c1bDb64CA6Aa')
        symbol = 'DAI'
    else if (address == '0xef13c0c8abcaf5767160018d268f9697ae4f5375')
        symbol = 'MKR'
    else if (address == '0x2f375e94fc336cdec2dc0ccb5277fe59cbf1cae5')
        symbol = 'USDC'
    else if (address == '0x482dC9bB08111CB875109B075A40881E48aE02Cd')
        symbol = 'BAT'
    else if (address == '0x86436bce20258a6dcfe48c9512d4d49a30c4d8c4')
        symbol = 'SNX'
    else if (address == '0x8c9e6c40d3402480ace624730524facc5482798c')
        symbol = 'REP'
    */
    // !!! COMMENT THE LINES ABOVE OUT FOR NON-LOCAL DEPLOYMENT

    let poolToken = new PoolToken(id)
    poolToken.poolId = pool
    poolToken.address = address
    poolToken.name = name
    poolToken.symbol = symbol
    poolToken.decimals = decimals
    poolToken.balance = ZERO_BD
    poolToken.denormWeight = ZERO_BD
    poolToken.priceUSD = address === USD || address == DAI ? ONE_BD : ZERO_BD
    poolToken.volume = ZERO_BD
    poolToken.save()
}

export function updatePoolLiquidity(id: string): void {
    let pool = Pool.load(id)
    if (pool == null) {
        throw new Error("Pool must be not null")
    }

    let tokensList: Array<Bytes> = pool.tokensList

    if (!tokensList || pool.tokensCount.lt(BigInt.fromI32(2)) || !pool.publicSwap) return

    // Find pool liquidity
    let hasPrice = false
    let hasUsdPrice = false
    let poolLiquidity = ZERO_BD
    if (tokensList.includes(Address.fromString(USD))) {
        let usdPoolTokenId = id.concat('-').concat(USD)
        let usdPoolToken = PoolToken.load(usdPoolTokenId)

        if (usdPoolToken !== null) {
            poolLiquidity = usdPoolToken.balance.div(usdPoolToken.denormWeight).times(pool.totalWeight)
            hasPrice = true
            hasUsdPrice = true
        }
    } else if (tokensList.includes(Address.fromString(WETH))) {
        let wethTokenPrice = TokenPrice.load(WETH)
        if (wethTokenPrice !== null) {
            let poolTokenId = id.concat('-').concat(WETH)
            let poolToken = PoolToken.load(poolTokenId)

            poolLiquidity = wethTokenPrice.price.times(poolToken.balance).div(poolToken.denormWeight).times(pool.totalWeight)
            hasPrice = true
        }
    } else if (tokensList.includes(Address.fromString(DAI))) {
        let daiTokenPrice = TokenPrice.load(DAI)
        if (daiTokenPrice !== null) {
            let poolTokenId = id.concat('-').concat(DAI)
            let poolToken = PoolToken.load(poolTokenId)

            poolLiquidity = daiTokenPrice.price.times(poolToken.balance).div(poolToken.denormWeight).times(pool.totalWeight)
            hasPrice = true
        }
    } else {
        let l = tokensList.length
    }

    // Create or update token price
    if (hasPrice) {
        for (let i: i32 = 0; i < tokensList.length; i++) {
            let tokenPriceId = tokensList[i].toHexString()
            let tokenPrice = TokenPrice.load(tokenPriceId)
            if (tokenPrice == null) {
                tokenPrice = new TokenPrice(tokenPriceId)
                tokenPrice.poolTokenId = ''
                tokenPrice.poolLiquidity = ZERO_BD
            }

            let poolTokenId = id.concat('-').concat(tokenPriceId)
            let poolToken = PoolToken.load(poolTokenId)
            if (
                (tokenPrice.poolTokenId == poolTokenId || poolLiquidity.gt(tokenPrice.poolLiquidity)) &&
                (
                    (tokenPriceId != WETH.toString() && tokenPriceId != DAI.toString()) ||
                    (pool.tokensCount.equals(BigInt.fromI32(2)) && hasUsdPrice)
                )
            ) {
                tokenPrice.price = ZERO_BD

                if (poolToken.balance.gt(ZERO_BD)) {
                    tokenPrice.price = poolLiquidity.div(pool.totalWeight).times(poolToken.denormWeight).div(poolToken.balance)
                }

                tokenPrice.symbol = poolToken.symbol
                tokenPrice.name = poolToken.name
                tokenPrice.decimals = poolToken.decimals
                tokenPrice.poolLiquidity = poolLiquidity
                tokenPrice.poolTokenId = poolTokenId
                tokenPrice.save()
            }
        }
    }

    // Update pool liquidity
    let liquidity = ZERO_BD
    let denormWeight = ZERO_BD
    for (let i: i32 = 0; i < tokensList.length; i++) {
        let tokenPriceId = tokensList[i].toHexString()
        let tokenPrice = TokenPrice.load(tokenPriceId)

        if (tokenPrice !== null) {
            let poolTokenId = id.concat('-').concat(tokenPriceId)
            let poolToken = PoolToken.load(poolTokenId)
            if (tokenPrice.price.gt(ZERO_BD) && poolToken.denormWeight.gt(denormWeight)) {
                denormWeight = poolToken.denormWeight
                liquidity = tokenPrice.price.times(poolToken.balance).div(poolToken.denormWeight).times(pool.totalWeight)
            }
        }
    }

    let factory = XDEFI.load('1')
    factory.totalLiquidity = factory.totalLiquidity.minus(pool.liquidity).plus(liquidity)
    factory.save()

    pool.liquidity = liquidity
    pool.save()
}

export function saveTransaction(event: ethereum.Event, eventName: string): void {
    let tx = event.transaction.hash.toHexString().concat('-').concat(event.logIndex.toString())
    let userAddress = event.transaction.from.toHex()
    let transaction = Transaction.load(tx)
    if (transaction == null) {
        transaction = new Transaction(tx)
    }
    transaction.event = eventName
    transaction.poolAddress = event.address.toHex()
    transaction.userAddress = userAddress
    transaction.gasUsed = event.transaction.gasUsed.toBigDecimal()
    transaction.gasPrice = event.transaction.gasPrice.toBigDecimal()
    transaction.tx = event.transaction.hash
    transaction.timestamp = event.block.timestamp
    transaction.block = event.block.number
    transaction.save()

    createUserEntity(userAddress)
}

export function createUserEntity(address: string): void {
    if (User.load(address) == null) {
        let user = new User(address)
        user.save()
    }
}

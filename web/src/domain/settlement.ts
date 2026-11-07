import type { Expense, Transfer, Valuation } from './ledger-types'
import { splitEqual } from './split'
export function netBalances(
  expenses: Expense[],
  values: Record<string, Valuation>,
  transfers: Transfer[],
  members: string[],
) {
  const net: Record<string, bigint> = Object.fromEntries(
    members.map((id) => [id, 0n]),
  )
  let missing = 0
  const change = (id: string, amount: bigint) => {
    net[id] = (net[id] ?? 0n) + amount
  }
  for (const e of expenses) {
    const amount = values[e.id]?.amountCny
    if (amount == null) {
      missing++
      continue
    }
    change(e.payerUserId, amount)
    for (const [id, share] of Object.entries(
      splitEqual(amount, e.split.members),
    ))
      change(id, -share)
  }
  for (const t of transfers) {
    change(t.fromUserId, BigInt(t.amountCny))
    change(t.toUserId, -BigInt(t.amountCny))
  }
  return { net, missing }
}
export function settle(net: Record<string, bigint>) {
  const ids = Object.keys(net)
      .filter((id) => net[id] !== 0n)
      .sort(),
    n = ids.length
  if (ids.reduce((sum, id) => sum + net[id], 0n) !== 0n)
    throw new Error('净额总和必须为零')
  const groups: string[][] = []
  if (n <= 20 && n > 0) {
    const size = 1 << n,
      sums: bigint[] = new Array(size),
      dp = new Uint8Array(size),
      prev = new Int8Array(size)
    sums[0] = 0n
    // 每次移除一个成员；遇到零和前缀就完成一组。O(n·2^n)，避免 O(3^n) 子集枚举。
    for (let mask = 1; mask < size; mask++) {
      const bit = mask & -mask,
        i = 31 - Math.clz32(bit)
      sums[mask] = sums[mask ^ bit] + net[ids[i]]
      let best = -1,
        selected = i
      for (let rest = mask; rest; rest &= rest - 1) {
        const b = rest & -rest,
          index = 31 - Math.clz32(b),
          score = dp[mask ^ b]
        if (score > best) {
          best = score
          selected = index
        }
      }
      dp[mask] = best + (sums[mask] === 0n ? 1 : 0)
      prev[mask] = selected
    }
    let mask = size - 1,
      group: string[] = []
    while (mask) {
      const i = prev[mask]
      group.push(ids[i])
      mask ^= 1 << i
      if (sums[mask] === 0n) {
        groups.push(group)
        group = []
      }
    }
  } else if (n) groups.push(ids)
  const transfers: {
    fromUserId: string
    toUserId: string
    amountCny: bigint
  }[] = []
  for (const group of groups) {
    const order = (
      a: { id: string; amount: bigint },
      b: { id: string; amount: bigint },
    ) =>
      a.amount === b.amount
        ? a.id.localeCompare(b.id)
        : a.amount > b.amount
          ? -1
          : 1
    const debt = group
      .filter((id) => net[id] < 0n)
      .map((id) => ({ id, amount: -net[id] }))
      .sort(order)
    const credit = group
      .filter((id) => net[id] > 0n)
      .map((id) => ({ id, amount: net[id] }))
      .sort(order)
    let i = 0,
      j = 0
    while (i < debt.length && j < credit.length) {
      const amount =
        debt[i].amount < credit[j].amount ? debt[i].amount : credit[j].amount
      transfers.push({
        fromUserId: debt[i].id,
        toUserId: credit[j].id,
        amountCny: amount,
      })
      debt[i].amount -= amount
      credit[j].amount -= amount
      if (debt[i].amount === 0n) i++
      if (credit[j].amount === 0n) j++
    }
  }
  return { transfers, exact: n <= 20 }
}

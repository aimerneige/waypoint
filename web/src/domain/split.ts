export function splitEqual(
  amount: bigint,
  members: string[],
): Record<string, bigint> {
  const ids = [...new Set(members)].sort()
  if (!ids.length || amount < 0n)
    throw new Error('分摊成员不能为空，金额不能为负')
  const count = BigInt(ids.length),
    base = amount / count,
    extra = amount % count
  return Object.fromEntries(
    ids.map((id, i) => [id, base + (BigInt(i) < extra ? 1n : 0n)]),
  )
}

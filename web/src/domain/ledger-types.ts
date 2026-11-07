export type Expense = {
  id: string
  createdSeq: number
  title: string
  category?: string | null
  date: string
  time?: string | null
  amount: number
  currency: string
  method: 'card' | 'cash' | 'cny'
  payerUserId: string
  rateSource: 'default' | 'wallet' | 'manual' | 'actual'
  rate?: string | null
  amountCny?: number | null
  split: { mode: 'equal'; members: string[] }
  cardNote?: string | null
  note?: string | null
}
export type Exchange = {
  id: string
  createdSeq: number
  ownerUserId: string
  currency: string
  cnyPaid: number
  foreignReceived: number
  date: string
  time?: string | null
  note?: string | null
}
export type Transfer = {
  id: string
  fromUserId: string
  toUserId: string
  amountCny: number
  date: string
  note?: string | null
}
export type Rates = Record<string, string | null>
export type Valuation = {
  amountCny: bigint | null
  rate: string | null
  status: '估算' | '已核实' | '手动' | '钱包成本' | '缺少汇率'
  insufficient?: boolean
}

import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { Command } from 'cmdk'
import {
  database,
  writeEntity,
  type Database,
  type Entity,
  type Trip,
  type Pending,
} from '@/data/db'
import { useEntities } from '@/data/hooks'
import { useSession } from '@/platform/session'
import { valueExpense } from '@/domain/expense'
import { decimal } from '@/domain/decimal'
import { wallet } from '@/domain/wallet'
import { formatMoney, moneyInput, parseMoney } from '@/domain/money'
import { splitEqual } from '@/domain/split'
import { netBalances, settle } from '@/domain/settlement'
import { todayInZone } from '@/domain/format'
import type {
  Exchange,
  Expense,
  Rates,
  Transfer,
  Valuation,
} from '@/domain/ledger-types'
import { Button } from '@/ui/components/button'
import { toast } from '@/ui/components/sonner'
import { ResponsiveOverlay } from '@/ui/responsive-overlay'
import { ListCard } from '@/ui/list-card'
import { ActionMenu } from '@/ui/action-menu'
import { Fab } from '@/ui/shell'
import { useOnline } from '@/ui/hooks'
import { HistoryList } from '../itinerary'

type Member = { id: string; name: string; active: boolean }
const asRecords = <T,>(rows: Entity[]): T[] =>
  rows.map(
    (r) =>
      ({
        ...r.view!.fields,
        id: r.entityId,
        createdSeq: r.view!.createdSeq,
      }) as T,
  )
const safeNumber = (n: bigint, limit = BigInt(Number.MAX_SAFE_INTEGER)) => {
  if (n <= 0n || n > limit)
    throw new Error(`金额必须大于零且不超过 ${limit} 最小单位`)
  return Number(n)
}
function CurrencyPicker({
  value,
  onChange,
  rates,
}: {
  value: string
  onChange: (v: string) => void
  rates: Rates
}) {
  const [open, setOpen] = useState(false)
  const currencies = [
    ...new Set([
      ...Object.keys(rates).filter((c) => rates[c]),
      'CNY',
      ...Intl.supportedValuesOf('currency'),
    ]),
  ]
  return (
    <>
      <label>
        币种
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => setOpen(true)}
        >
          {value}
        </Button>
      </label>
      <ResponsiveOverlay open={open} onOpenChange={setOpen} title="选择币种">
        <Command label="搜索币种">
          <Command.Input aria-label="搜索币种" placeholder="搜索币种代码" />
          <Command.List className="currency-list">
            <Command.Empty>没有匹配币种</Command.Empty>
            {currencies.map((c) => (
              <Command.Item
                key={c}
                value={c}
                onSelect={() => {
                  onChange(c)
                  setOpen(false)
                }}
              >
                {c}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </ResponsiveOverlay>
    </>
  )
}
function ExpenseEditor({
  db,
  trip,
  initial,
  members,
  rates,
  exchanges,
  expenses,
  onSaved,
  retry,
}: {
  db: Database
  trip: Trip
  initial: Expense | null
  members: Member[]
  rates: Rates
  exchanges: Exchange[]
  expenses: Expense[]
  onSaved: () => void | Promise<void>
  retry?: Pending
}) {
  const id = initial?.id ?? 'preview'
  const [f, setF] = useState<Expense>(
    initial ?? {
      id,
      createdSeq: Number.MAX_SAFE_INTEGER,
      title: '',
      date: todayInZone(trip.timezone),
      amount: 0,
      currency: 'CNY',
      method: 'cny',
      payerUserId: db.userId,
      rateSource: 'default',
      split: {
        mode: 'equal',
        members: members.filter((m) => m.active).map((m) => m.id),
      },
    },
  )
  const [amount, setAmount] = useState(
    initial ? moneyInput(BigInt(initial.amount), initial.currency) : '',
  )
  const [actual, setActual] = useState(
    initial?.amountCny ? moneyInput(BigInt(initial.amountCny), 'CNY') : '',
  )
  const [newRate, setNewRate] = useState(''),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState(false)
  const locked = initial?.method === 'cash' && initial.payerUserId !== db.userId
  const change = (patch: Partial<Expense>) => setF({ ...f, ...patch })
  let preview: Valuation = { amountCny: null, rate: null, status: '缺少汇率' },
    error = ''
  try {
    const draft = {
      ...f,
      amount: safeNumber(parseMoney(amount, f.currency), 1000000000000n),
      rate: f.rateSource === 'manual' ? f.rate : null,
      amountCny:
        f.rateSource === 'actual'
          ? safeNumber(parseMoney(actual, 'CNY'))
          : null,
    }
    const cash = wallet(f.payerUserId, f.currency, exchanges, [
      ...expenses.filter((e) => e.id !== id),
      draft,
    ]).valuations
    preview = valueExpense(
      draft,
      { ...rates, ...(newRate ? { [f.currency]: newRate } : {}) },
      cash,
    )
  } catch (e) {
    error = String(e).replace('Error: ', '')
  }
  return (
    <>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            if (error) throw new Error(error)
            if (!f.split.members.length) throw new Error('至少选择一位分摊成员')
            if (
              f.method === 'card' &&
              f.currency !== 'CNY' &&
              f.rateSource === 'default' &&
              !rates[f.currency]
            ) {
              if (!newRate) throw new Error('请填写默认汇率')
              await writeEntity(db, trip.id, 'trip_rates', trip.id, 'update', {
                [f.currency]: newRate,
              })
            }
            const all = {
              title: f.title,
              category: f.category || null,
              date: f.date,
              time: f.time || null,
              amount: safeNumber(
                parseMoney(amount, f.currency),
                1000000000000n,
              ),
              currency: f.currency,
              method: f.method,
              payerUserId: f.payerUserId,
              rateSource: f.rateSource,
              rate: f.rateSource === 'manual' ? f.rate : null,
              amountCny:
                f.rateSource === 'actual'
                  ? safeNumber(parseMoney(actual, 'CNY'))
                  : null,
              split: f.split,
              cardNote: f.cardNote || null,
              note: f.note || null,
            }
            const fields =
              initial && !retry
                ? Object.fromEntries(
                    Object.entries(all).filter(
                      ([k, v]) =>
                        JSON.stringify(v) !==
                        JSON.stringify(initial[k as keyof Expense] ?? null),
                    ),
                  )
                : all
            await writeEntity(
              db,
              trip.id,
              'expense',
              retry?.entityId ?? initial?.id ?? crypto.randomUUID(),
              retry?.kind ?? (initial ? 'update' : 'create'),
              fields,
            )
            await onSaved()
          } catch (e) {
            toast.error(String(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <label>
          金额
          <input
            className="money-input"
            inputMode="decimal"
            required
            value={amount}
            disabled={locked}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        {!locked && (
          <CurrencyPicker
            value={f.currency}
            rates={rates}
            onChange={(currency) =>
              change({
                currency,
                method:
                  currency === 'CNY'
                    ? 'cny'
                    : f.method === 'cny'
                      ? 'card'
                      : f.method,
                rateSource:
                  currency === 'CNY'
                    ? 'default'
                    : f.method === 'cash'
                      ? 'wallet'
                      : 'default',
              })
            }
          />
        )}
        <fieldset disabled={locked}>
          <legend>支付方式</legend>
          <div className="row">
            {(['card', 'cash', 'cny'] as const).map((method) => (
              <Button
                type="button"
                key={method}
                variant={f.method === method ? 'default' : 'outline'}
                disabled={
                  method === 'cash' &&
                  (f.currency === 'CNY' ||
                    (!!initial && initial.payerUserId !== db.userId))
                }
                onClick={() =>
                  change({
                    method,
                    ...(method === 'cny' ? { currency: 'CNY' } : {}),
                    ...(method === 'cash' ? { payerUserId: db.userId } : {}),
                    rateSource: method === 'cash' ? 'wallet' : 'default',
                  })
                }
              >
                {{ card: '刷卡', cash: '现金', cny: '人民币' }[method]}
              </Button>
            ))}
          </div>
        </fieldset>
        {locked && (
          <p className="muted">只有现金付款人本人可修改金额、币种和方式</p>
        )}
        <label>
          付款人
          <select
            disabled={locked || f.method === 'cash'}
            value={f.payerUserId}
            onChange={(e) => change({ payerUserId: e.target.value })}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.active ? '' : '（已退出）'}
              </option>
            ))}
          </select>
        </label>
        <label>
          标题
          <input
            required
            maxLength={200}
            value={f.title}
            onChange={(e) => change({ title: e.target.value })}
          />
        </label>
        <label>
          分类
          <select
            value={f.category ?? ''}
            onChange={(e) => change({ category: e.target.value })}
          >
            <option value="">未分类</option>
            {Object.entries({
              food: '餐饮',
              transport: '交通',
              lodging: '住宿',
              ticket: '门票',
              shopping: '购物',
              other: '其他',
            }).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          日期
          <input
            type="date"
            required
            value={f.date}
            onChange={(e) => change({ date: e.target.value })}
          />
        </label>
        <label>
          时间
          <input
            type="time"
            value={f.time ?? ''}
            onChange={(e) => change({ time: e.target.value })}
          />
        </label>
        <fieldset>
          <legend>分摊成员</legend>
          {members.map((m) => (
            <label key={m.id} className="member-check">
              <input
                type="checkbox"
                checked={f.split.members.includes(m.id)}
                onChange={(e) =>
                  change({
                    split: {
                      mode: 'equal',
                      members: e.target.checked
                        ? [...f.split.members, m.id]
                        : f.split.members.filter((id) => id !== m.id),
                    },
                  })
                }
              />
              {m.name}
              {m.active ? '' : '（已退出）'}
            </label>
          ))}
        </fieldset>
        {f.currency !== 'CNY' && (
          <>
            <p>
              生效汇率：{preview.rate ?? '缺少汇率'} · {preview.status}
            </p>
            <label>
              汇率来源
              <select
                value={f.rateSource}
                onChange={(e) =>
                  change({
                    rateSource: e.target.value as Expense['rateSource'],
                  })
                }
              >
                {f.method === 'cash' ? (
                  <option value="wallet">钱包成本</option>
                ) : (
                  <option value="default">默认汇率</option>
                )}
                <option value="manual">手动汇率</option>
                <option value="actual">实际扣款人民币</option>
              </select>
            </label>
            {f.rateSource === 'manual' && (
              <label>
                手动汇率
                <input
                  required
                  inputMode="decimal"
                  value={f.rate ?? ''}
                  onChange={(e) => change({ rate: e.target.value })}
                />
              </label>
            )}
            {f.rateSource === 'actual' && (
              <label>
                实际扣款人民币
                <input
                  required
                  inputMode="decimal"
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                />
              </label>
            )}
            {f.method === 'card' &&
              f.rateSource === 'default' &&
              !rates[f.currency] && (
                <label>
                  首次使用 {f.currency}，请填写默认汇率
                  <input
                    required
                    inputMode="decimal"
                    value={newRate}
                    onChange={(e) => setNewRate(e.target.value)}
                  />
                </label>
              )}
          </>
        )}
        {f.method === 'card' && (
          <label>
            卡片备注
            <input
              maxLength={50}
              value={f.cardNote ?? ''}
              onChange={(e) => change({ cardNote: e.target.value })}
            />
          </label>
        )}
        <label>
          备注
          <textarea
            maxLength={500}
            value={f.note ?? ''}
            onChange={(e) => change({ note: e.target.value })}
          />
        </label>
        <div className="banner" aria-live="polite">
          折合人民币：
          {preview.amountCny === null
            ? '缺少汇率'
            : formatMoney(preview.amountCny)}
          {preview.amountCny !== null && f.split.members.length > 0 && (
            <div>
              {Object.entries(
                splitEqual(preview.amountCny, f.split.members),
              ).map(([id, n]) => (
                <p key={id}>
                  {members.find((m) => m.id === id)?.name}：{formatMoney(n)}
                </p>
              ))}
            </div>
          )}
          {preview.insufficient && (
            <p className="error">钱包余额不足，仍可保存</p>
          )}
          {error && <p>{error}</p>}
        </div>
        <Button loading={busy}>保存账目</Button>
      </form>
      {initial && (
        <Button variant="outline" onClick={() => setHistory(true)}>
          修改记录
        </Button>
      )}
      <ResponsiveOverlay
        open={history}
        onOpenChange={setHistory}
        title="账目修改记录"
      >
        <HistoryList db={db} tripId={trip.id} entity="expense" entityId={id} />
      </ResponsiveOverlay>
    </>
  )
}

export function Ledger() {
  const { tripId = '' } = useParams(),
    user = useSession((s) => s.currentUser)!,
    db = database(user.id),
    online = useOnline()
  const trip = useLiveQuery(() => db.trips.get(tripId), [db, tripId])
  const notices = useLiveQuery(
    () =>
      db.notices
        .where('tripId')
        .equals(tripId)
        .filter((n) => !n.dismissed)
        .count(),
    [db, tripId],
    0,
  )
  const expenseRows = useEntities(db, tripId, 'expense'),
    exchangeRows = useEntities(db, tripId, 'exchange'),
    transferRows = useEntities(db, tripId, 'settlement_transfer'),
    rateRows = useEntities(db, tripId, 'trip_rates'),
    memberRows = useEntities(db, tripId, 'member')
  const expenses = asRecords<Expense>(expenseRows),
    exchanges = asRecords<Exchange>(exchangeRows),
    transfers = asRecords<Transfer>(transferRows),
    rates = (rateRows[0]?.view?.fields ?? {}) as Rates
  const members: Member[] = memberRows.map((m) => ({
    id: m.entityId,
    name: String(m.view!.fields.nickname),
    active: !m.view!.fields.leftAt,
  }))
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id
  const keys = [
    ...new Set([
      ...exchanges.map((e) => `${e.ownerUserId}:${e.currency}`),
      ...expenses
        .filter((e) => e.method === 'cash')
        .map((e) => `${e.payerUserId}:${e.currency}`),
    ]),
  ]
  const wallets = keys.map((key) => {
    const [owner, currency] = key.split(':')
    return wallet(owner, currency, exchanges, expenses)
  })
  const cash = Object.assign({}, ...wallets.map((w) => w.valuations)) as Record<
    string,
    Valuation
  >
  const values = Object.fromEntries(
    expenses.map((e) => [e.id, valueExpense(e, rates, cash)]),
  )
  const { net, missing } = netBalances(
      expenses,
      values,
      transfers,
      members.map((m) => m.id),
    ),
    suggestions = settle(net)
  const paid = (id: string) =>
    expenses
      .filter((e) => e.payerUserId === id)
      .reduce((n, e) => n + (values[e.id].amountCny ?? 0n), 0n)
  const share = (id: string) =>
    expenses.reduce(
      (n, e) =>
        n +
        (values[e.id].amountCny === null
          ? 0n
          : (splitEqual(values[e.id].amountCny!, e.split.members)[id] ?? 0n)),
      0n,
    )
  const [tab, setTab] = useState('账目'),
    [editor, setEditor] = useState<Expense | null | undefined>(),
    [ratesOpen, setRatesOpen] = useState(false),
    [exchangeOpen, setExchangeOpen] = useState(false),
    [editingExchange, setEditingExchange] = useState<Exchange | null>(null)
  const [payer, setPayer] = useState(''),
    [currency, setCurrency] = useState(''),
    [method, setMethod] = useState(''),
    [status, setStatus] = useState(''),
    [cardNote, setCardNote] = useState(''),
    [date, setDate] = useState('')
  if (!trip) return <main className="page">正在加载账本…</main>
  const remove = async (entity: string, id: string) => {
    await writeEntity(db, tripId, entity, id, 'delete')
    toast.undoable('已撤销', () => {
      void writeEntity(db, tripId, entity, id, 'restore').catch((e) =>
        toast.error(String(e)),
      )
    })
  }
  const filtered = expenses
    .filter(
      (e) =>
        (!payer || e.payerUserId === payer) &&
        (!currency || e.currency === currency) &&
        (!method || e.method === method) &&
        (!status || values[e.id].status === status),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.time ?? '').localeCompare(a.time ?? '') ||
        b.createdSeq - a.createdSeq ||
        a.id.localeCompare(b.id),
    )
  const estimates = expenses.filter(
    (e) => e.method === 'card' && values[e.id].status === '估算',
  )
  return (
    <main className="page stack">
      <div className="row justify-between">
        <h1>账本</h1>
        {notices > 0 && (
          <Link to={`/trips/${tripId}?notices`}>同步冲突提示（{notices}）</Link>
        )}
        <Button variant="outline" onClick={() => setRatesOpen(true)}>
          默认汇率
        </Button>
      </div>
      <div className="row ledger-tabs">
        {['账目', '钱包', '对账', '结算'].map((t) => (
          <Button
            key={t}
            variant={tab === t ? 'default' : 'outline'}
            onClick={() => setTab(t)}
          >
            {t}
          </Button>
        ))}
      </div>
      {tab === '账目' && (
        <>
          <div className="ledger-summary">
            {[
              ['我已付', paid(user.id)],
              ['我应摊', share(user.id)],
              ['我的净额', net[user.id] ?? 0n],
              [
                '全组总支出',
                expenses.reduce(
                  (n, e) => n + (values[e.id].amountCny ?? 0n),
                  0n,
                ),
              ],
            ].map(([label, n]) => (
              <div key={String(label)}>
                <p className="muted">{String(label)}</p>
                <strong>{formatMoney(n as bigint)}</strong>
              </div>
            ))}
          </div>
          <div className="ledger-filters">
            <label>
              付款人
              <select value={payer} onChange={(e) => setPayer(e.target.value)}>
                <option value="">全部</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              币种
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="">全部</option>
                {[...new Set(expenses.map((e) => e.currency))].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              方式
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="">全部</option>
                <option value="card">刷卡</option>
                <option value="cash">现金</option>
                <option value="cny">人民币</option>
              </select>
            </label>
            <label>
              状态
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">全部</option>
                {['估算', '已核实', '手动', '钱包成本', '缺少汇率'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          {filtered.map((e, i) => (
            <div key={e.id}>
              {(!i || filtered[i - 1].date !== e.date) && <h2>{e.date}</h2>}
              <article className="card ledger-card" data-testid="expense-card">
                <ListCard
                  title={
                    <button onClick={() => setEditor(e)}>
                      <strong>{e.title}</strong>
                    </button>
                  }
                  status={values[e.id].status}
                  menu={
                    <ActionMenu
                      label={`账目操作 ${e.title}`}
                      actions={[
                        { label: '编辑账目', onSelect: () => setEditor(e) },
                        {
                          label: '删除账目',
                          danger: true,
                          onSelect: () => remove('expense', e.id),
                        },
                      ]}
                    />
                  }
                  secondary={`${formatMoney(BigInt(e.amount), e.currency)} · ${values[e.id].amountCny === null ? '缺少汇率' : formatMoney(values[e.id].amountCny!)} · ${name(e.payerUserId)} · ${e.split.members.length} 人分摊`}
                  description={
                    values[e.id].insufficient ? '钱包余额不足' : e.note
                  }
                />
              </article>
            </div>
          ))}
          {!filtered.length && (
            <p className="muted">暂无账目，记录旅途的第一笔支出。</p>
          )}
          <Fab aria-label="新增账目" onClick={() => setEditor(null)} />
        </>
      )}
      {tab === '钱包' && (
        <>
          <h2>我的钱包</h2>
          {wallets
            .filter((w) => w.ownerUserId === user.id)
            .map((w) => (
              <article className="card ledger-card" key={w.currency}>
                <ListCard
                  title={w.currency}
                  status={formatMoney(w.balance, w.currency)}
                  secondary={`平均成本汇率：${w.averageRate ?? '缺少汇率'}`}
                  description={
                    w.balance < 0n ? '负余额警告：可能漏记换汇' : undefined
                  }
                />
              </article>
            ))}
          <Button
            onClick={() => {
              setEditingExchange(null)
              setExchangeOpen(true)
            }}
          >
            新增换汇
          </Button>
          <h2>换汇记录</h2>
          {exchanges
            .filter((e) => e.ownerUserId === user.id)
            .sort(
              (a, b) =>
                b.date.localeCompare(a.date) || b.createdSeq - a.createdSeq,
            )
            .map((e) => (
              <article className="card ledger-card" key={e.id}>
                <ListCard
                  title={`${formatMoney(BigInt(e.cnyPaid))} → ${formatMoney(BigInt(e.foreignReceived), e.currency)}`}
                  secondary={[e.date, e.time, e.note]
                    .filter(Boolean)
                    .join(' · ')}
                  menu={
                    <ActionMenu
                      label="换汇操作"
                      actions={[
                        {
                          label: '编辑换汇',
                          onSelect: () => {
                            setEditingExchange(e)
                            setExchangeOpen(true)
                          },
                        },
                        {
                          label: '删除换汇',
                          danger: true,
                          onSelect: () => remove('exchange', e.id),
                        },
                      ]}
                    />
                  }
                />
              </article>
            ))}
        </>
      )}
      {tab === '对账' && (
        <>
          <h2>刷卡对账</h2>
          {members.map((m) => {
            const rows = expenses.filter(
              (e) => e.method === 'card' && e.payerUserId === m.id,
            )
            return (
              <p key={m.id}>
                {m.name}：已核实{' '}
                {rows.filter((e) => values[e.id].status === '已核实').length} 笔
                /{' '}
                {formatMoney(
                  rows
                    .filter((e) => values[e.id].status === '已核实')
                    .reduce((n, e) => n + (values[e.id].amountCny ?? 0n), 0n),
                )}
                ，待核实{' '}
                {rows.filter((e) => values[e.id].status === '估算').length} 笔 /{' '}
                {formatMoney(
                  rows
                    .filter((e) => values[e.id].status === '估算')
                    .reduce((n, e) => n + (values[e.id].amountCny ?? 0n), 0n),
                )}
              </p>
            )
          })}
          <label>
            对账付款人
            <select value={payer} onChange={(e) => setPayer(e.target.value)}>
              <option value="">全部</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            卡片备注筛选
            <input
              value={cardNote}
              onChange={(e) => setCardNote(e.target.value)}
            />
          </label>
          <label>
            对账日期
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {estimates
            .filter(
              (e) =>
                (!payer || payer === e.payerUserId) &&
                (!date || date === e.date) &&
                (!cardNote || e.cardNote?.includes(cardNote)),
            )
            .map((e) => (
              <Reconcile
                key={e.id}
                expense={e}
                value={values[e.id]}
                onSave={async (amountCny) => {
                  await writeEntity(db, tripId, 'expense', e.id, 'update', {
                    rateSource: 'actual',
                    amountCny,
                    rate: null,
                  })
                }}
              />
            ))}
        </>
      )}
      {tab === '结算' && (
        <>
          <h2>AA 结算</h2>
          {estimates.length > 0 && (
            <p className="banner">
              {estimates.length} 笔刷卡未核实实际扣款，结果为估算
            </p>
          )}
          {!online && <p className="banner">可能缺少他人未同步的账目</p>}
          {missing > 0 && (
            <p className="error">{missing} 笔缺少汇率，未参与结算</p>
          )}
          {!suggestions.exact && <p className="banner">结果为近似</p>}
          {suggestions.transfers.map((t, i) => (
            <article className="card ledger-card" key={i}>
              <p>
                {name(t.fromUserId)} → {name(t.toUserId)}{' '}
                {formatMoney(t.amountCny)}
              </p>
              <Button
                onClick={async () => {
                  try {
                    const id = crypto.randomUUID()
                    await writeEntity(
                      db,
                      tripId,
                      'settlement_transfer',
                      id,
                      'create',
                      {
                        ...t,
                        amountCny: safeNumber(t.amountCny),
                        date: todayInZone(trip.timezone),
                      },
                    )
                    toast.undoable('已标记转账', () => {
                      void writeEntity(
                        db,
                        tripId,
                        'settlement_transfer',
                        id,
                        'delete',
                      ).catch((e) => toast.error(String(e)))
                    })
                  } catch (e) {
                    toast.error(String(e))
                  }
                }}
              >
                标记已转账
              </Button>
            </article>
          ))}
          {!suggestions.transfers.length && <p>已结清</p>}
          <h2>每人明细</h2>
          {members.map((m) => (
            <details key={m.id} className="card ledger-card">
              <summary>
                {m.name} · 净额 {formatMoney(net[m.id] ?? 0n)}
              </summary>
              <p>
                已付 {formatMoney(paid(m.id))} · 应摊 {formatMoney(share(m.id))}
              </p>
              {expenses
                .filter(
                  (e) =>
                    e.payerUserId === m.id || e.split.members.includes(m.id),
                )
                .map((e) => (
                  <p key={e.id}>
                    {e.title}：
                    {e.payerUserId === m.id
                      ? `付款 ${values[e.id].amountCny === null ? '缺少汇率' : formatMoney(values[e.id].amountCny!)}`
                      : ''}{' '}
                    {e.split.members.includes(m.id) &&
                    values[e.id].amountCny !== null
                      ? `分摊 ${formatMoney(splitEqual(values[e.id].amountCny!, e.split.members)[m.id])}`
                      : ''}
                  </p>
                ))}
              {transfers
                .filter((t) => t.fromUserId === m.id || t.toUserId === m.id)
                .map((t) => (
                  <p key={t.id}>
                    {t.fromUserId === m.id ? '已转出' : '已收到'}{' '}
                    {formatMoney(BigInt(t.amountCny))}
                  </p>
                ))}
            </details>
          ))}
          <h2>已标记的转账</h2>
          {transfers.map((t) => (
            <article key={t.id} className="card ledger-card">
              <p>
                {name(t.fromUserId)} → {name(t.toUserId)}{' '}
                {formatMoney(BigInt(t.amountCny))} · {t.date}
              </p>
              <Button
                variant="outline"
                onClick={() =>
                  void remove('settlement_transfer', t.id).catch((e) =>
                    toast.error(String(e)),
                  )
                }
              >
                撤销转账
              </Button>
            </article>
          ))}
        </>
      )}
      <ResponsiveOverlay
        open={editor !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditor(undefined)
        }}
        title={editor ? '编辑账目' : '新增账目'}
        fullHeight
      >
        {editor !== undefined && (
          <ExpenseEditor
            key={editor?.id ?? 'new'}
            db={db}
            trip={trip}
            initial={editor}
            members={members}
            rates={rates}
            exchanges={exchanges}
            expenses={expenses}
            onSaved={() => setEditor(undefined)}
          />
        )}
      </ResponsiveOverlay>
      <ResponsiveOverlay
        open={ratesOpen}
        onOpenChange={setRatesOpen}
        title="默认汇率设置"
      >
        <RateSettings
          db={db}
          tripId={tripId}
          rates={rates}
          expenses={expenses}
        />
      </ResponsiveOverlay>
      <ResponsiveOverlay
        open={exchangeOpen}
        onOpenChange={setExchangeOpen}
        title={editingExchange ? '编辑换汇' : '新增换汇'}
      >
        <ExchangeEditor
          key={editingExchange?.id ?? 'new'}
          initial={editingExchange}
          db={db}
          trip={trip}
          rates={rates}
          onSaved={() => setExchangeOpen(false)}
        />
      </ResponsiveOverlay>
    </main>
  )
}
function Reconcile({
  expense: e,
  value,
  onSave,
}: {
  expense: Expense
  value: Valuation
  onSave: (n: number) => Promise<void>
}) {
  const [amount, setAmount] = useState(''),
    [busy, setBusy] = useState(false)
  return (
    <form
      className="card ledger-card"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        try {
          await onSave(safeNumber(parseMoney(amount, 'CNY')))
        } catch (e) {
          toast.error(String(e))
        } finally {
          setBusy(false)
        }
      }}
    >
      <strong>{e.title}</strong>
      <p>
        {e.date} · {e.cardNote} · 估算 {formatMoney(value.amountCny ?? 0n)}
      </p>
      <label>
        实际扣款人民币
        <input
          inputMode="decimal"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <Button loading={busy}>保存实际扣款</Button>
    </form>
  )
}
function RateSettings({
  db,
  tripId,
  rates,
  expenses,
  onSaved,
}: {
  db: Database
  tripId: string
  rates: Rates
  expenses: Expense[]
  onSaved?: () => void | Promise<void>
}) {
  const [currency, setCurrency] = useState('JPY'),
    [rate, setRate] = useState(''),
    [pending, setPending] = useState<{
      currency: string
      rate: string | null
    } | null>(null)
  return (
    <div className="stack">
      {Object.entries(rates)
        .filter(([, r]) => r)
        .map(([c, r]) => (
          <div className="row" key={c}>
            <strong>
              {c} = {r}
            </strong>
            <Button
              variant="outline"
              onClick={() => {
                setCurrency(c)
                setRate(r!)
              }}
            >
              修改 {c}
            </Button>
            <Button
              variant="outline"
              onClick={() => setPending({ currency: c, rate: null })}
            >
              删除 {c}
            </Button>
          </div>
        ))}
      <CurrencyPicker value={currency} rates={rates} onChange={setCurrency} />
      <label>
        默认汇率
        <input
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
      </label>
      <Button
        onClick={() => {
          if (currency === 'CNY') {
            toast.error('CNY 汇率固定为 1')
            return
          }
          try {
            if (decimal(rate).n <= 0n) throw new Error('汇率必须大于零')
            setPending({ currency, rate })
          } catch (e) {
            toast.error(String(e))
          }
        }}
      >
        保存默认汇率
      </Button>
      <ResponsiveOverlay
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title="确认修改默认汇率"
      >
        {pending && (
          <>
            <p>
              将影响{' '}
              {
                expenses.filter(
                  (e) =>
                    e.rateSource === 'default' &&
                    e.currency === pending.currency,
                ).length
              }{' '}
              笔按默认汇率计算的账目
            </p>
            <Button
              onClick={async () => {
                try {
                  await writeEntity(
                    db,
                    tripId,
                    'trip_rates',
                    tripId,
                    'update',
                    { [pending.currency]: pending.rate },
                  )
                  setPending(null)
                  toast.success('默认汇率已保存')
                  await onSaved?.()
                } catch (e) {
                  toast.error(String(e))
                }
              }}
            >
              确认修改
            </Button>
          </>
        )}
      </ResponsiveOverlay>
    </div>
  )
}

export function LedgerRetry({
  db,
  trip,
  retry,
  entity,
  onSaved,
}: {
  db: Database
  trip: Trip
  retry: Pending
  entity?: Entity
  onSaved: () => Promise<void>
}) {
  const members = useEntities(db, trip.id, 'member').map((m) => ({
    id: m.entityId,
    name: String(m.view!.fields.nickname),
    active: !m.view!.fields.leftAt,
  }))
  const expenses = asRecords<Expense>(useEntities(db, trip.id, 'expense'))
  const exchanges = asRecords<Exchange>(useEntities(db, trip.id, 'exchange'))
  const rates = (useEntities(db, trip.id, 'trip_rates')[0]?.view?.fields ??
    {}) as Rates
  const initial = {
    ...entity?.server?.fields,
    ...retry.fields,
    id: retry.entityId,
    createdSeq: entity?.server?.createdSeq ?? Number.MAX_SAFE_INTEGER,
  }
  if (retry.entity === 'expense')
    return (
      <ExpenseEditor
        db={db}
        trip={trip}
        retry={retry}
        initial={initial as Expense}
        members={members}
        rates={rates}
        expenses={expenses}
        exchanges={exchanges}
        onSaved={onSaved}
      />
    )
  if (retry.entity === 'exchange')
    return (
      <ExchangeEditor
        db={db}
        trip={trip}
        retry={retry}
        initial={initial as Exchange}
        rates={rates}
        onSaved={onSaved}
      />
    )
  if (retry.entity === 'trip_rates')
    return (
      <RateSettings
        db={db}
        tripId={trip.id}
        rates={{ ...rates, ...retry.fields } as Rates}
        expenses={expenses}
        onSaved={onSaved}
      />
    )
  return (
    <TransferRetry
      db={db}
      trip={trip}
      retry={retry}
      members={members}
      onSaved={onSaved}
    />
  )
}
function TransferRetry({
  db,
  trip,
  retry,
  members,
  onSaved,
}: {
  db: Database
  trip: Trip
  retry: Pending
  members: Member[]
  onSaved: () => Promise<void>
}) {
  const [from, setFrom] = useState(
      String(retry.fields.fromUserId ?? db.userId),
    ),
    [to, setTo] = useState(String(retry.fields.toUserId ?? '')),
    [amount, setAmount] = useState(
      moneyInput(BigInt(Number(retry.fields.amountCny ?? 0)), 'CNY'),
    ),
    [date, setDate] = useState(String(retry.fields.date ?? trip.startDate))
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          if (from === to) throw new Error('转账双方不能相同')
          await writeEntity(
            db,
            trip.id,
            'settlement_transfer',
            retry.entityId,
            retry.kind,
            {
              fromUserId: from,
              toUserId: to,
              amountCny: safeNumber(parseMoney(amount, 'CNY')),
              date,
              note: retry.fields.note ?? null,
            },
          )
          await onSaved()
        } catch (e) {
          toast.error(String(e))
        }
      }}
    >
      {[
        ['转出成员', from, setFrom],
        ['收款成员', to, setTo],
      ].map(([label, current, set]) => (
        <label key={String(label)}>
          {String(label)}
          <select
            value={String(current)}
            onChange={(e) => (set as (value: string) => void)(e.target.value)}
          >
            <option value="">请选择</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label>
        人民币金额
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label>
        转账日期
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <Button>重试转账</Button>
    </form>
  )
}
function ExchangeEditor({
  initial,
  db,
  trip,
  rates,
  onSaved,
  retry,
}: {
  initial: Exchange | null
  db: Database
  trip: Trip
  rates: Rates
  onSaved: () => void | Promise<void>
  retry?: Pending
}) {
  const [currency, setCurrency] = useState(initial?.currency ?? 'JPY'),
    [paid, setPaid] = useState(
      initial ? moneyInput(BigInt(initial.cnyPaid), 'CNY') : '',
    ),
    [received, setReceived] = useState(
      initial
        ? moneyInput(BigInt(initial.foreignReceived), initial.currency)
        : '',
    ),
    [date, setDate] = useState(initial?.date ?? todayInZone(trip.timezone)),
    [time, setTime] = useState(initial?.time ?? ''),
    [note, setNote] = useState(initial?.note ?? ''),
    [busy, setBusy] = useState(false)
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          if (currency === 'CNY') throw new Error('换汇币种不能为 CNY')
          await writeEntity(
            db,
            trip.id,
            'exchange',
            retry?.entityId ?? initial?.id ?? crypto.randomUUID(),
            retry?.kind ?? (initial ? 'update' : 'create'),
            {
              ownerUserId: db.userId,
              currency,
              cnyPaid: safeNumber(parseMoney(paid, 'CNY')),
              foreignReceived: safeNumber(parseMoney(received, currency)),
              date,
              time: time || null,
              note: note || null,
            },
          )
          await onSaved()
        } catch (e) {
          toast.error(String(e))
        } finally {
          setBusy(false)
        }
      }}
    >
      <CurrencyPicker value={currency} onChange={setCurrency} rates={rates} />
      <label>
        支付人民币
        <input
          required
          inputMode="decimal"
          value={paid}
          onChange={(e) => setPaid(e.target.value)}
        />
      </label>
      <label>
        收到外币
        <input
          required
          inputMode="decimal"
          value={received}
          onChange={(e) => setReceived(e.target.value)}
        />
      </label>
      <label>
        换汇日期
        <input
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label>
        换汇时间
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </label>
      <label>
        换汇备注
        <textarea
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <Button loading={busy}>保存换汇</Button>
    </form>
  )
}

import { Skeleton } from './components/skeleton'
export function LoadingList() {
  return (
    <div className="stack" role="status" aria-label="正在读取本地数据">
      <Skeleton className="h-12" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  )
}

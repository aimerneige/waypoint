import { DayPicker } from 'react-day-picker'
import { zhCN } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
export function Calendar(props: React.ComponentProps<typeof DayPicker>) {
  return <DayPicker locale={zhCN} {...props} />
}

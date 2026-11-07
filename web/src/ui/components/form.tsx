import type { ReactNode } from 'react'
import { useId } from 'react'
import {
  useFormContext,
  type FieldValues,
  type UseFormRegisterReturn,
} from 'react-hook-form'
import { Input } from './input'
import { Label } from './label'
export { FormProvider as Form } from 'react-hook-form'
export function FormField({
  name,
  label,
  type = 'text',
  autoComplete,
}: {
  name: string
  label: string
  type?: string
  autoComplete?: string
}) {
  const id = useId()
  const {
    register,
    formState: { errors },
  } = useFormContext<FieldValues>()
  const error = errors[name]?.message
  return (
    <Field
      id={id}
      label={label}
      error={typeof error === 'string' ? error : undefined}
      registration={register(name)}
      type={type}
      autoComplete={autoComplete}
    />
  )
}
function Field({
  id,
  label,
  error,
  registration,
  ...props
}: {
  id: string
  label: string
  error?: string
  registration: UseFormRegisterReturn
  type: string
  autoComplete?: string
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        {...props}
        {...registration}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && <FormMessage id={`${id}-error`}>{error}</FormMessage>}
    </div>
  )
}
export function FormMessage({
  children,
  id,
}: {
  children: ReactNode
  id?: string
}) {
  return (
    <p id={id} role="alert" className="error">
      {children}
    </p>
  )
}

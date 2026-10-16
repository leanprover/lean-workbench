import { useState } from 'react'

interface QuickFilter {
  setValue: (value: string) => void
}

export function useQuickFilter(): { matchesFilter: (text: string) => boolean; filter: QuickFilter } {
  const [value, setValue] = useState('')
  const lowerCaseValue = value.toLowerCase()
  return {
    matchesFilter: (text: string) => text.toLowerCase().includes(lowerCaseValue),
    filter: { setValue },
  }
}

export function QuickFilterInput(props: { description: string; filter: QuickFilter }) {
  return (
    <input
      type='search'
      placeholder={props.description}
      aria-label={props.description}
      onChange={e => props.filter.setValue(e.target.value)}
    />
  )
}

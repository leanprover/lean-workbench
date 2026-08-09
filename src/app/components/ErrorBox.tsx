export default function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#fee',
        border: '1px solid #c00',
        color: '#900',
        padding: '0.75em 1em',
        borderRadius: '4px',
      }}
    >
      {children}
    </div>
  )
}

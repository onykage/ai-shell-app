import React from 'react'

export function ApproveModal({
  open, command, cwd, onDecision
}: {
  open: boolean
  command: string
  cwd: string
  onDecision: (approved: boolean) => void
}) {
  if (!open) return null
  return (
    <div className="modal">
      <div className="card">
        <h3>Approve command?</h3>
        <p><b>cwd:</b> {cwd}</p>
        <pre><code>{command}</code></pre>
        <div className="row">
          <button onClick={() => onDecision(true)}>Approve & Run</button>
          <button onClick={() => onDecision(false)}>Reject</button>
        </div>
      </div>
    </div>
  )
}

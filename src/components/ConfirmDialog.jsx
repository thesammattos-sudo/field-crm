import ModalPortal from './ModalPortal'

export default function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message = 'This action cannot be undone.',
  confirmText = 'Delete',
  cancelText = 'Cancel',
  confirmVariant = 'danger', // 'danger' | 'primary'
  loading = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null

  const confirmClass =
    confirmVariant === 'primary'
      ? 'btn-primary'
      : 'btn-secondary text-red-700 hover:bg-red-50 border-red-200'

  return (
    <ModalPortal>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '16px',
        }}
        onClick={() => {
          if (loading) return
          onCancel?.()
        }}
      >
        <div
          style={{
            backgroundColor: 'var(--fieldcrm-panel)',
            borderRadius: '8px',
            padding: '24px',
            width: '100%',
            maxWidth: '420px',
            maxHeight: '85vh',
            overflowY: 'auto',
            color: 'var(--fieldcrm-text)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>{title}</h2>
            <button type="button" onClick={onCancel} disabled={loading} aria-label="Close">✕</button>
          </div>
          <p className="text-sm text-field-stone">{message}</p>
          <div className="flex items-center justify-end gap-3 pt-5">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={loading}>
              {cancelText}
            </button>
            <button
              type="button"
              className={confirmClass}
              onClick={onConfirm}
              disabled={loading}
            >
              {loading ? 'Working…' : confirmText}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}


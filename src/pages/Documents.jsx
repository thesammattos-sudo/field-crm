import { useEffect, useState } from 'react'
import { Download, FileText, Image, File, DollarSign, Scale, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import ModalPortal from '../components/ModalPortal'
import ConfirmDialog from '../components/ConfirmDialog'

const getDocIcon = (type) => {
  const icons = {
    marketing: FileText,
    design: Image,
    financial: DollarSign,
    contract: File,
    legal: Scale,
    permit: FileText,
    other: File,
  }
  const Icon = icons[type] || File
  return <Icon className="w-5 h-5" />
}

const getDocColor = (type) => {
  const colors = {
    marketing: 'bg-blue-50 text-blue-600',
    design: 'bg-purple-50 text-purple-600',
    financial: 'bg-green-50 text-green-600',
    contract: 'bg-amber-50 text-amber-600',
    legal: 'bg-red-50 text-red-600',
    permit: 'bg-indigo-50 text-indigo-600',
    other: 'bg-gray-50 text-gray-600',
  }
  return colors[type] || 'bg-gray-50 text-gray-600'
}

const emptyDocForm = {
  name: '',
  type: 'marketing',
  project: '',
  description: '',
  linkUrl: '',
}

function normalizeDocument(row) {
  const createdAt = row.created_at || row.createdAt || null
  return {
    id: row.id,
    name: row.name ?? '',
    type: row.type ?? 'marketing',
    project: row.project ?? row.project_name ?? row.projectName ?? '',
    description: row.description ?? row.notes ?? '',
    url: row.url ?? row.link_url ?? null,
    filePath: row.file_path ?? row.filePath ?? null,
    fileName: row.file_name ?? row.fileName ?? null,
    fileMimeType: row.file_mime_type ?? row.fileMimeType ?? null,
    fileSize: row.file_size ?? row.fileSize ?? null,
    createdAt,
  }
}

function looksLikeMissingColumnError(message) {
  if (!message) return false
  return message.includes('column') && message.includes('does not exist')
}

export default function Documents() {
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [form, setForm] = useState(emptyDocForm)
  const [file, setFile] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null) // doc

  async function fetchDocuments() {
    setLoading(true)
    setError('')
    let res = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false })

    if (res.error && looksLikeMissingColumnError(res.error.message)) {
      res = await supabase.from('documents').select('*')
    }

    if (res.error) {
      setError(res.error.message || 'Failed to load documents.')
      setDocuments([])
      setLoading(false)
      return
    }

    setDocuments((res.data || []).map(normalizeDocument))
    setLoading(false)
  }

  useEffect(() => {
    fetchDocuments()
  }, [])

  function openModal() {
    setForm(emptyDocForm)
    setFile(null)
    setShowModal(true)
  }

  function closeModal() {
    if (saving) return
    setShowModal(false)
    setForm(emptyDocForm)
    setFile(null)
  }

  async function addDocument(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const name = form.name.trim()
    const type = form.type
    const project = form.project.trim()
    const description = form.description.trim()
    const linkUrl = form.linkUrl.trim() || null

    // Upload file (optional). If provided, it becomes the primary URL.
    let uploadedPath = null
    let uploadedPublicUrl = null
    let fileMeta = null

    if (file) {
      const bucket = 'documents'
      const safeName = file.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '')
      const key = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
      uploadedPath = `${key}-${safeName}`

      const uploadRes = await supabase.storage.from(bucket).upload(uploadedPath, file)
      if (uploadRes.error) {
        setError(uploadRes.error.message || 'Failed to upload file.')
        setSaving(false)
        return
      }

      const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(uploadedPath)
      uploadedPublicUrl = publicData?.publicUrl || null
      fileMeta = {
        file_path: uploadedPath,
        file_name: file.name,
        file_mime_type: file.type || null,
        file_size: typeof file.size === 'number' ? file.size : null,
      }
    }

    const payloadFull = {
      name,
      type,
      project,
      description,
      url: uploadedPublicUrl || linkUrl,
      ...(fileMeta || {}),
    }

    const payloadMinimal = {
      name,
      type,
      project,
      url: uploadedPublicUrl || linkUrl,
    }

    let insertRes = await supabase.from('documents').insert(payloadFull).select('*').single()
    if (insertRes.error && looksLikeMissingColumnError(insertRes.error.message)) {
      insertRes = await supabase.from('documents').insert(payloadMinimal).select('*').single()
    }

    if (insertRes.error) {
      // If we uploaded a file but DB insert failed, try to clean up the file.
      if (uploadedPath) {
        await supabase.storage.from('documents').remove([uploadedPath])
      }
      setError(insertRes.error.message || 'Failed to add document.')
      setSaving(false)
      return
    }

    const saved = normalizeDocument(insertRes.data || {})
    setDocuments(prev => [saved, ...prev])
    setSaving(false)
    closeModal()
  }

  async function deleteDocument(doc) {
    setError('')
    setDeleting(true)
    // If it was uploaded to storage, attempt to delete the object too.
    if (doc.filePath) {
      await supabase.storage.from('documents').remove([doc.filePath])
    }
    const { error: supaError } = await supabase.from('documents').delete().eq('id', doc.id)
    if (supaError) {
      setError(supaError.message || 'Failed to delete document.')
      setDeleting(false)
      return
    }
    setDocuments(prev => prev.filter(d => d.id !== doc.id))
    setDeleting(false)
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-semibold text-field-black tracking-tight">Documents</h1>
          <p className="text-field-stone mt-1">Project files</p>
        </div>
        <button className="btn-primary" onClick={openModal}>+ Add Document</button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card-static p-6 text-sm text-field-stone">Loading documents…</div>
      ) : documents.length === 0 ? (
        <div className="card-static p-8 text-center">
          <p className="text-field-black font-semibold">No documents yet</p>
          <p className="text-sm text-field-stone mt-1">Add your first document to get started.</p>
          <button className="btn-primary mt-4" onClick={openModal}>+ Add Document</button>
        </div>
      ) : (
        <div className="card-static overflow-hidden">
          {documents.map((doc, i) => {
            const dateLabel = doc.createdAt ? format(new Date(doc.createdAt), 'MMM d, yyyy') : ''
            return (
              <div
                key={doc.id ?? i}
                className="flex items-center gap-4 px-5 py-4 border-b border-gray-100 last:border-0 hover:bg-field-sand/50 animate-fade-in"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${getDocColor(doc.type)}`}>
                  {getDocIcon(doc.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{doc.name}</p>
                  <p className="text-sm text-field-stone">{doc.project || '—'}</p>
                </div>
                <div className="hidden sm:block text-sm text-field-stone">{dateLabel}</div>

                {doc.url ? (
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-9 h-9 rounded-lg bg-field-sand flex items-center justify-center hover:bg-gray-200 transition-colors"
                    title="Open"
                  >
                    <Download className="w-4 h-4 text-field-stone" />
                  </a>
                ) : (
                  <div className="w-9 h-9" />
                )}

                <button
                  className="w-9 h-9 rounded-lg hover:bg-red-50 flex items-center justify-center transition-colors"
                  title="Delete"
                  onClick={() => setConfirmDelete(doc)}
                >
                  <Trash2 className="w-4 h-4 text-red-600" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
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
            onClick={closeModal}
          >
            <div
              style={{
                backgroundColor: 'var(--fieldcrm-panel)',
                borderRadius: '8px',
                padding: '24px',
                width: '100%',
                maxWidth: '450px',
                maxHeight: '85vh',
                overflowY: 'auto',
                color: 'var(--fieldcrm-text)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>Add Document</h2>
              <button type="button" onClick={closeModal} disabled={saving}>✕</button>
            </div>

            <form onSubmit={addDocument} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label className="text-xs text-field-stone-light">Name</label>
                  <input
                    className="input mt-1"
                    value={form.name}
                    onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                    required
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-field-stone-light">Type</label>
                    <select
                      className="input mt-1"
                      value={form.type}
                      onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}
                    >
                      <option value="marketing">Marketing</option>
                      <option value="legal">Legal</option>
                      <option value="contract">Contract</option>
                      <option value="permit">Permit</option>
                      <option value="design">Design</option>
                      <option value="financial">Financial</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Project</label>
                    <input
                      className="input mt-1"
                      value={form.project}
                      onChange={(e) => setForm(f => ({ ...f, project: e.target.value }))}
                      placeholder="OMMA Villas…"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-field-stone-light">Description</label>
                  <textarea
                    className="input mt-1 min-h-[90px]"
                    value={form.description}
                    onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Notes / details about this document…"
                  />
                </div>

                <div>
                  <label className="text-xs text-field-stone-light">File Upload (PDFs, images, docs)</label>
                  <input
                    type="file"
                    className="input mt-1"
                    accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                  <p className="text-[11px] text-field-stone mt-1">
                    Upload a file, or use the link field below.
                  </p>
                </div>

                <div>
                  <label className="text-xs text-field-stone-light">OR Link URL</label>
                  <input
                    className="input mt-1"
                    value={form.linkUrl}
                    onChange={(e) => setForm(f => ({ ...f, linkUrl: e.target.value }))}
                    placeholder="https://drive.google.com/…"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button type="button" className="btn-secondary" onClick={closeModal} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Add Document'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete document?"
        message={confirmDelete?.name ? `Delete document "${confirmDelete.name}"? This cannot be undone.` : 'Delete this document? This cannot be undone.'}
        confirmText="Delete"
        cancelText="Cancel"
        loading={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const target = confirmDelete
          setConfirmDelete(null)
          if (target) await deleteDocument(target)
        }}
      />
    </div>
  )
}

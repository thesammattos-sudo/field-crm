import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Check, Pencil } from 'lucide-react'
import { projects, leads } from '../data'
import clsx from 'clsx'
import ModalPortal from '../components/ModalPortal'
import { supabase } from '../lib/supabase'

const statusOptions = [
  { value: 'planning', label: 'Planning' },
  { value: 'pre_construction', label: 'Pre-Construction' },
  { value: 'construction', label: 'Construction' },
  { value: 'complete', label: 'Completed' },
]

function parseFirstNumber(value) {
  if (value == null) return ''
  const m = String(value).match(/(\d+(\.\d+)?)/)
  return m ? m[1] : ''
}

function computeUnitCounts(units) {
  const total = units.length
  const available = units.filter(u => u.status === 'available').length
  const reserved = units.filter(u => u.status === 'reserved').length
  const sold = units.filter(u => u.status === 'sold').length
  return { total, available, reserved, sold }
}

function syncUnitsToTotal(totalUnits, units) {
  const t = Math.max(0, Number(totalUnits) || 0)
  const existingByNumber = new Map((units || []).map(u => [Number(u.number), u]))
  const next = []
  for (let n = 1; n <= t; n += 1) {
    const existing = existingByNumber.get(n)
    next.push({
      number: n,
      status: existing?.status || 'available',
      buyer: existing?.buyer || '',
      price: existing?.price ?? null,
    })
  }
  return next
}

function looksLikeMissingRelationError(message) {
  if (!message) return false
  return message.includes('relation') && message.includes('projects') && message.includes('does not exist')
}

function looksLikeMissingColumnError(message) {
  if (!message) return false
  return message.includes('column') && message.includes('does not exist')
}

export default function ProjectDetail() {
  const { slug } = useParams()
  const baseProject = projects.find(p => p.slug === slug)
  const [project, setProject] = useState(baseProject || null)

  const [showEdit, setShowEdit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [form, setForm] = useState(null)

  useEffect(() => {
    setProject(baseProject || null)
  }, [baseProject])

  const interestedLeads = useMemo(() => {
    if (!project) return []
    return leads.filter(l => l.projectId === project.id)
  }, [project])

  if (!project) {
    return (
      <div className="text-center py-20">
        <p className="text-field-stone">Project not found</p>
        <Link to="/projects" className="text-field-gold mt-2 inline-block">← Back to Projects</Link>
      </div>
    )
  }

  function openEditModal() {
    setSaveError('')
    setForm({
      name: project.name || '',
      location: project.location || '',
      status: project.status || 'planning',
      description: project.description || '',
      pricePerUnit: project.pricePerUnit ?? '',
      roiMin: project.roi?.min ?? '',
      roiMax: project.roi?.max ?? '',
      buildSqm: parseFirstNumber(project.buildSize),
      poolSqm: parseFirstNumber(project.poolSize),
      leaseYears: parseFirstNumber(project.leasehold),
      totalUnits: project.totalUnits ?? (project.units?.length || 0),
      units: (project.units || []).map(u => ({
        number: u.number,
        status: u.status,
        buyer: u.buyer || '',
        price: u.price ?? null,
      })),
      timeline: {
        planning: project.milestones?.find(m => m.name.toLowerCase().includes('planning'))?.date || '',
        preConstruction: project.milestones?.find(m => m.name.toLowerCase().includes('pre-construction'))?.date || '',
        construction: project.milestones?.find(m => m.name.toLowerCase().includes('construction'))?.date || '',
        completion: project.milestones?.find(m => m.name.toLowerCase().includes('completion'))?.date || project.completion || '',
      },
      paymentStructure: (project.paymentStructure || []).map(p => ({
        description: p.description || '',
        percentage: p.percentage ?? '',
      })),
    })
    setShowEdit(true)
  }

  function closeEditModal() {
    if (saving) return
    setShowEdit(false)
    setForm(null)
    setSaveError('')
  }

  async function saveProject(e) {
    e.preventDefault()
    if (!form) return
    setSaving(true)
    setSaveError('')

    const units = syncUnitsToTotal(form.totalUnits, form.units || [])
      .map(u => ({
        number: Number(u.number),
        status: u.status,
        buyer: u.status === 'reserved' ? (u.buyer || '') : (u.status === 'sold' ? (u.buyer || '') : ''),
      }))

    const paymentStructure = (form.paymentStructure || [])
      .map((p, idx) => ({
        stage: idx + 1,
        description: String(p.description || '').trim(),
        percentage: Number(p.percentage) || 0,
      }))
      .filter(p => p.description.length > 0 || p.percentage > 0)

    const milestones = [
      { name: 'Planning and Design', status: project.milestones?.[0]?.status || 'pending', date: form.timeline?.planning || '' },
      { name: 'Pre-Construction', status: project.milestones?.[1]?.status || 'pending', date: form.timeline?.preConstruction || '' },
      { name: 'Construction', status: project.milestones?.[2]?.status || 'pending', date: form.timeline?.construction || '' },
      { name: 'Completion and Handover', status: project.milestones?.[3]?.status || 'pending', date: form.timeline?.completion || '' },
    ]

    const pricePerUnit = Number(form.pricePerUnit) || 0
    const totalUnits = Number(form.totalUnits) || units.length
    const totalValue = pricePerUnit && totalUnits ? pricePerUnit * totalUnits : (project.totalValue ?? 0)
    const { available, reserved, sold } = computeUnitCounts(units)

    const payloadFull = {
      slug: project.slug,
      name: form.name.trim(),
      location: form.location.trim(),
      region: project.region || null,
      status: form.status,
      description: form.description.trim(),
      price_per_unit: pricePerUnit || null,
      roi_min: Number(form.roiMin) || null,
      roi_max: Number(form.roiMax) || null,
      build_sqm: Number(form.buildSqm) || null,
      pool_sqm: Number(form.poolSqm) || null,
      lease_years: Number(form.leaseYears) || null,
      total_units: totalUnits,
      units,
      milestones,
      payment_structure: paymentStructure,
      total_value: totalValue || null,
      updated_at: new Date().toISOString(),
    }

    const payloadMinimal = {
      slug: project.slug,
      name: form.name.trim(),
      location: form.location.trim(),
      status: form.status,
      description: form.description.trim(),
    }

    // Check if table exists and whether we have an existing row for this slug
    const existing = await supabase.from('projects').select('id').eq('slug', project.slug).maybeSingle()
    if (existing.error) {
      const msg = existing.error.message || 'Failed to access projects table.'
      if (looksLikeMissingRelationError(msg)) {
        setSaveError('Supabase table "projects" does not exist yet. Create it in Supabase, then try again.')
      } else {
        setSaveError(msg)
      }
      setSaving(false)
      return
    }

    let res
    if (existing.data?.id) {
      res = await supabase.from('projects').update(payloadFull).eq('id', existing.data.id).select('*').single()
      if (res.error && looksLikeMissingColumnError(res.error.message)) {
        res = await supabase.from('projects').update(payloadMinimal).eq('id', existing.data.id).select('*').single()
      }
    } else {
      res = await supabase.from('projects').insert(payloadFull).select('*').single()
      if (res.error && looksLikeMissingColumnError(res.error.message)) {
        res = await supabase.from('projects').insert(payloadMinimal).select('*').single()
      }
    }

    if (res.error) {
      const msg = res.error.message || 'Failed to save project.'
      if (looksLikeMissingRelationError(msg)) {
        setSaveError('Supabase table "projects" does not exist yet. Create it in Supabase, then try again.')
      } else {
        setSaveError(msg)
      }
      setSaving(false)
      return
    }

    // Update UI (view-only) with new values immediately
    setProject(prev => {
      if (!prev) return prev
      return {
        ...prev,
        name: form.name.trim(),
        location: form.location.trim(),
        status: form.status,
        description: form.description.trim(),
        pricePerUnit: pricePerUnit || prev.pricePerUnit,
        priceDisplay: prev.currency === 'USD' && pricePerUnit ? `$${pricePerUnit.toLocaleString()}` : prev.priceDisplay,
        roi: { ...(prev.roi || {}), min: Number(form.roiMin) || 0, max: Number(form.roiMax) || 0 },
        buildSize: form.buildSqm ? `${form.buildSqm} sqm` : prev.buildSize,
        poolSize: form.poolSqm ? `${form.poolSqm} sqm` : prev.poolSize,
        leasehold: form.leaseYears ? `${form.leaseYears}+ years` : prev.leasehold,
        totalUnits,
        units: units.map(u => ({ ...u, buyer: u.buyer || null })),
        milestones,
        paymentStructure,
        totalValue: totalValue || prev.totalValue,
        availableUnits: available,
        reservedUnits: reserved,
        soldUnits: sold,
      }
    })

    setSaving(false)
    closeEditModal()
  }

  return (
    <div className="animate-fade-in">
      <Link to="/projects" className="inline-flex items-center gap-2 text-field-stone text-sm mb-6 hover:text-field-black">
        <ArrowLeft className="w-4 h-4" /> Back to Projects
      </Link>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Hero */}
          <div className="card-static overflow-hidden">
            <div className="relative h-64 lg:h-80">
              <img src={project.coverImage} alt={project.name} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <button
                type="button"
                onClick={openEditModal}
                className="absolute top-4 right-4 bg-white/90 hover:bg-white text-field-black rounded-lg p-2 shadow-sm"
                title="Edit Project"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <div className="absolute bottom-6 left-6 right-6">
                <span className={clsx("inline-block px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide mb-3", project.status === 'complete' ? 'bg-green-600 text-white' : 'bg-field-gold text-white')}>
                  {project.status.replace('_', ' ')}
                </span>
                <h1 className="font-display text-4xl font-semibold text-white mb-2">{project.name}</h1>
                <p className="text-white/80">{project.location}, {project.region} · {project.totalUnits} Units</p>
              </div>
            </div>
            <div className="p-6">
              <p className="text-field-stone leading-relaxed mb-6">{project.description}</p>
              <div className="flex flex-wrap gap-2">
                {project.features.map((feature, i) => (
                  <span key={i} className="text-xs text-field-black bg-field-sand px-3 py-1.5 rounded-full">{feature}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Unit Availability */}
          <div className="card-static p-6">
            <h2 className="font-semibold mb-4">Unit Availability</h2>
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3">
              {project.units.map(unit => (
                <div key={unit.number} className={clsx("aspect-square rounded-lg flex flex-col items-center justify-center text-center p-2", unit.status === 'available' ? 'bg-field-sand border border-gray-200' : unit.status === 'reserved' ? 'bg-amber-50 border border-field-gold' : 'bg-gray-100 border border-gray-300')}>
                  <span className="font-semibold text-lg">#{unit.number}</span>
                  <span className={clsx("text-[10px] uppercase font-semibold mt-1", unit.status === 'available' ? 'text-green-600' : unit.status === 'reserved' ? 'text-field-gold-dark' : 'text-field-stone')}>{unit.status}</span>
                  {unit.buyer && <span className="text-[10px] text-field-stone truncate max-w-full">{unit.buyer}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Timeline */}
          <div className="card-static p-6">
            <h2 className="font-semibold mb-6">Construction Timeline</h2>
            <div className="space-y-0">
              {project.milestones.map((milestone, i) => (
                <div key={i} className="flex items-start gap-4 pb-6 last:pb-0 relative">
                  {i < project.milestones.length - 1 && (
                    <div className="absolute left-[7px] top-4 bottom-0 w-0.5" style={{ backgroundColor: milestone.status === 'complete' ? '#1a1a1a' : '#e5e5e5' }} />
                  )}
                  <div className={clsx("w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center", milestone.status === 'complete' ? 'bg-field-black border-field-black' : milestone.status === 'in_progress' ? 'bg-white border-field-gold' : 'bg-white border-gray-300')}>
                    {milestone.status === 'complete' && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  <div className="flex-1 flex justify-between items-center">
                    <span className={clsx("font-medium", milestone.status === 'pending' ? 'text-field-stone-light' : 'text-field-black')}>{milestone.name}</span>
                    <span className={clsx("text-sm", milestone.status === 'in_progress' ? 'text-field-gold font-semibold' : 'text-field-stone')}>{milestone.date}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {interestedLeads.length > 0 && (
            <div className="card-static p-6">
              <h2 className="font-semibold mb-4">Interested Leads ({interestedLeads.length})</h2>
              <div className="space-y-3">
                {interestedLeads.map(lead => (
                  <div key={lead.id} className="flex items-center justify-between p-3 bg-field-sand rounded-lg">
                    <div>
                      <p className="font-medium text-sm">{lead.name}</p>
                      <p className="text-xs text-field-stone">{lead.interestedUnit || 'General'} · {lead.source}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{lead.budgetDisplay}</p>
                      <p className="text-xs text-field-stone capitalize">{lead.stage.replace('_', ' ')}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="card-static p-6">
            <p className="font-display text-4xl font-semibold text-field-black mb-1">{project.priceDisplay}</p>
            <p className="text-sm text-field-stone mb-6">per villa</p>
            {project.roi && (
              <div className="bg-field-black rounded-xl p-5 mb-6">
                <p className="text-xs text-field-stone-light uppercase tracking-wider mb-2">NET ROI</p>
                <p className="font-display text-3xl font-semibold text-field-gold">{project.roi.min}% – {project.roi.max}%</p>
                {project.roi.guaranteed && <p className="text-sm text-field-stone-light mt-2">Or {project.roi.guaranteed}% guaranteed</p>}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-field-sand rounded-lg"><p className="text-xs text-field-stone mb-1">Build</p><p className="font-semibold">{project.buildSize}</p></div>
              {project.landSize && <div className="p-3 bg-field-sand rounded-lg"><p className="text-xs text-field-stone mb-1">Land</p><p className="font-semibold">{project.landSize}</p></div>}
              <div className="p-3 bg-field-sand rounded-lg"><p className="text-xs text-field-stone mb-1">Pool</p><p className="font-semibold">{project.poolSize}</p></div>
              <div className="p-3 bg-field-sand rounded-lg"><p className="text-xs text-field-stone mb-1">Lease</p><p className="font-semibold">{project.leasehold}</p></div>
            </div>
          </div>

          <div className="card-static p-6">
            <h2 className="font-semibold mb-4">Sales Summary</h2>
            <div className="space-y-3">
              <div className="flex justify-between p-3 bg-field-sand rounded-lg"><span className="text-field-stone">Total Units</span><span className="font-semibold">{project.totalUnits}</span></div>
              <div className="flex justify-between p-3 bg-field-sand rounded-lg"><span className="text-field-stone">Reserved</span><span className="font-semibold text-field-gold">{project.reservedUnits}</span></div>
              <div className="flex justify-between p-3 bg-field-sand rounded-lg"><span className="text-field-stone">Available</span><span className="font-semibold text-green-600">{project.availableUnits}</span></div>
              <div className="flex justify-between p-4 bg-field-black rounded-lg mt-2"><span className="text-white">Total Value</span><span className="font-display text-lg font-semibold text-white">${(project.totalValue / 1000).toFixed(0)}K</span></div>
            </div>
          </div>

          {project.paymentStructure && (
            <div className="card-static p-6">
              <h2 className="font-semibold mb-4">Payment Structure</h2>
              <div className="space-y-2">
                {project.paymentStructure.map((stage, i) => (
                  <div key={i} className="flex justify-between items-center p-3 bg-field-sand rounded-lg">
                    <span className="text-sm text-field-stone">{stage.description}</span>
                    <span className="font-semibold">{stage.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showEdit && form && (
        <ModalPortal>
          <div style={{
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
          }} onClick={closeEditModal}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              width: '100%',
              maxWidth: '700px',
              maxHeight: '85vh',
              overflowY: 'auto',
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>Edit Project</h2>
                <button type="button" onClick={closeEditModal} disabled={saving}>✕</button>
              </div>

              {saveError && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                  {saveError}
                </div>
              )}

              <form onSubmit={saveProject} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 className="text-sm font-semibold text-field-black">Basic Info</h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-field-stone-light">Name</label>
                    <input className="input mt-1" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Location</label>
                    <input className="input mt-1" value={form.location} onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-field-stone-light">Status</label>
                    <select className="input mt-1" value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
                      {statusOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-field-stone-light">Description</label>
                    <textarea className="input mt-1 min-h-[90px]" value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                </div>

                <h3 className="text-sm font-semibold text-field-black mt-2">Pricing & ROI</h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-field-stone-light">Price per villa</label>
                    <input className="input mt-1" value={form.pricePerUnit} onChange={(e) => setForm(f => ({ ...f, pricePerUnit: e.target.value }))} placeholder="130000" />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">NET ROI range (min %)</label>
                    <input className="input mt-1" value={form.roiMin} onChange={(e) => setForm(f => ({ ...f, roiMin: e.target.value }))} placeholder="14" />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">NET ROI range (max %)</label>
                    <input className="input mt-1" value={form.roiMax} onChange={(e) => setForm(f => ({ ...f, roiMax: e.target.value }))} placeholder="21" />
                  </div>
                </div>

                <h3 className="text-sm font-semibold text-field-black mt-2">Specs</h3>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-field-stone-light">Build (sqm)</label>
                    <input className="input mt-1" value={form.buildSqm} onChange={(e) => setForm(f => ({ ...f, buildSqm: e.target.value }))} placeholder="70" />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Pool (sqm)</label>
                    <input className="input mt-1" value={form.poolSqm} onChange={(e) => setForm(f => ({ ...f, poolSqm: e.target.value }))} placeholder="8" />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Lease (years)</label>
                    <input className="input mt-1" value={form.leaseYears} onChange={(e) => setForm(f => ({ ...f, leaseYears: e.target.value }))} placeholder="25" />
                  </div>
                </div>

                <h3 className="text-sm font-semibold text-field-black mt-2">Units</h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-field-stone-light">Total units</label>
                    <input
                      className="input mt-1"
                      value={form.totalUnits}
                      onChange={(e) => {
                        const totalUnits = e.target.value
                        setForm(f => ({ ...f, totalUnits, units: syncUnitsToTotal(totalUnits, f.units) }))
                      }}
                      placeholder="8"
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  {form.units.map((u, idx) => (
                    <div key={u.number} className="grid grid-cols-12 gap-3 items-end">
                      <div className="col-span-2">
                        <label className="text-xs text-field-stone-light">#</label>
                        <input className="input mt-1" value={u.number} disabled />
                      </div>
                      <div className="col-span-4">
                        <label className="text-xs text-field-stone-light">Status</label>
                        <select
                          className="input mt-1"
                          value={u.status}
                          onChange={(e) => {
                            const status = e.target.value
                            setForm(f => ({
                              ...f,
                              units: f.units.map((x, i) => i === idx ? { ...x, status } : x),
                            }))
                          }}
                        >
                          <option value="available">Available</option>
                          <option value="reserved">Reserved</option>
                          <option value="sold">Sold</option>
                        </select>
                      </div>
                      <div className="col-span-6">
                        <label className="text-xs text-field-stone-light">Buyer (if reserved/sold)</label>
                        <input
                          className="input mt-1"
                          value={u.buyer}
                          onChange={(e) => {
                            const buyer = e.target.value
                            setForm(f => ({
                              ...f,
                              units: f.units.map((x, i) => i === idx ? { ...x, buyer } : x),
                            }))
                          }}
                          placeholder="Buyer name…"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <h3 className="text-sm font-semibold text-field-black mt-2">Timeline</h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-field-stone-light">Planning date</label>
                    <input className="input mt-1" value={form.timeline.planning} onChange={(e) => setForm(f => ({ ...f, timeline: { ...f.timeline, planning: e.target.value } }))} placeholder="Dec 2025" />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Pre-construction date</label>
                    <input className="input mt-1" value={form.timeline.preConstruction} onChange={(e) => setForm(f => ({ ...f, timeline: { ...f.timeline, preConstruction: e.target.value } }))} placeholder="Jan 2026" />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Construction date</label>
                    <input className="input mt-1" value={form.timeline.construction} onChange={(e) => setForm(f => ({ ...f, timeline: { ...f.timeline, construction: e.target.value } }))} placeholder="Mar 2026" />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Completion date</label>
                    <input className="input mt-1" value={form.timeline.completion} onChange={(e) => setForm(f => ({ ...f, timeline: { ...f.timeline, completion: e.target.value } }))} placeholder="Nov 2026" />
                  </div>
                </div>

                <h3 className="text-sm font-semibold text-field-black mt-2">Payment Structure</h3>
                <div className="space-y-3">
                  {(form.paymentStructure.length ? form.paymentStructure : [{ description: '', percentage: '' }]).map((p, idx) => (
                    <div key={idx} className="grid sm:grid-cols-12 gap-3 items-end">
                      <div className="sm:col-span-8">
                        <label className="text-xs text-field-stone-light">Description</label>
                        <input
                          className="input mt-1"
                          value={p.description}
                          onChange={(e) => setForm(f => ({
                            ...f,
                            paymentStructure: f.paymentStructure.map((x, i) => i === idx ? { ...x, description: e.target.value } : x),
                          }))}
                          placeholder="Deposit upon signing…"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="text-xs text-field-stone-light">%</label>
                        <input
                          className="input mt-1"
                          value={p.percentage}
                          onChange={(e) => setForm(f => ({
                            ...f,
                            paymentStructure: f.paymentStructure.map((x, i) => i === idx ? { ...x, percentage: e.target.value } : x),
                          }))}
                          placeholder="20"
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <button
                          type="button"
                          className="btn-secondary w-full"
                          onClick={() => setForm(f => ({ ...f, paymentStructure: f.paymentStructure.filter((_, i) => i !== idx) }))}
                          disabled={form.paymentStructure.length <= 1}
                        >
                          –
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setForm(f => ({ ...f, paymentStructure: [...(f.paymentStructure || []), { description: '', percentage: '' }] }))}
                  >
                    + Add milestone
                  </button>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button type="button" className="btn-secondary" onClick={closeEditModal} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  )
}

import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { projects } from '../data'
import clsx from 'clsx'

const getStatusLabel = (status) => {
  const labels = {
    pre_construction: 'Pre-Construction',
    construction: 'Construction',
    complete: 'Completed',
  }
  return labels[status] || status
}

const getStatusColor = (status) => {
  const colors = {
    pre_construction: 'bg-field-gold text-white',
    construction: 'bg-amber-500 text-white',
    complete: 'bg-green-600 text-white',
  }
  return colors[status] || 'bg-gray-400 text-white'
}

export default function Projects() {
  const activeProjects = projects.filter(p => p.isActive)
  const completedProjects = projects.filter(p => !p.isActive)

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-semibold text-field-black tracking-tight">Projects</h1>
          <p className="text-field-stone mt-1">Villa developments</p>
        </div>
        <button className="btn-primary">+ New Project</button>
      </div>

      {/* Active Projects */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-field-stone uppercase tracking-wider mb-4">Active Projects</h2>
        <div className="grid md:grid-cols-2 gap-6">
          {activeProjects.map((project, i) => (
            <Link 
              key={project.id}
              to={`/projects/${project.slug}`}
              className="card overflow-hidden group animate-fade-in"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              {/* Cover Image */}
              <div className="relative h-48 lg:h-56 overflow-hidden">
                <img 
                  src={project.coverImage} 
                  alt={project.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                <span className={clsx(
                  "absolute top-4 right-4 px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide",
                  getStatusColor(project.status)
                )}>
                  {getStatusLabel(project.status)}
                </span>
              </div>

              {/* Content */}
              <div className="p-5">
                <h3 className="font-display text-2xl font-semibold text-field-black mb-1">{project.name}</h3>
                <p className="text-sm text-field-stone mb-4">
                  {project.location} · {project.totalUnits} Units · {project.buildSize}
                </p>

                {/* Progress Bar */}
                <div className="mb-3">
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-field-gold rounded-full transition-all duration-500"
                      style={{ width: `${project.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-field-stone mt-1">{project.progress}% complete</p>
                </div>

                {/* Footer */}
                <div className="flex justify-between items-end pt-4 border-t border-gray-100">
                  <div>
                    <p className="text-xs text-field-stone">Completion</p>
                    <p className="font-semibold">{project.completion}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-field-stone">Per Unit</p>
                    <p className="font-display text-xl font-semibold">{project.priceDisplay}</p>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-2 mt-4 py-2.5 bg-field-sand rounded-lg text-sm font-medium group-hover:bg-field-black group-hover:text-white transition-colors">
                  View Details <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Completed Projects */}
      {completedProjects.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-field-stone uppercase tracking-wider mb-4">Sold Out / Completed</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {completedProjects.map((project, i) => (
              <Link 
                key={project.id}
                to={`/projects/${project.slug}`}
                className="card overflow-hidden group opacity-75 hover:opacity-100 transition-opacity animate-fade-in"
                style={{ animationDelay: `${(activeProjects.length + i) * 100}ms` }}
              >
                <div className="relative h-36 overflow-hidden">
                  <img 
                    src={project.coverImage} 
                    alt={project.name}
                    className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
                  />
                  <div className="absolute inset-0 bg-black/30" />
                  <span className={clsx(
                    "absolute top-3 right-3 px-2.5 py-1 rounded-lg text-[11px] font-semibold uppercase tracking-wide",
                    getStatusColor(project.status)
                  )}>
                    Sold Out
                  </span>
                </div>
                <div className="p-4">
                  <h3 className="font-display text-lg font-semibold">{project.name}</h3>
                  <p className="text-xs text-field-stone">{project.location} · {project.totalUnits} Units · Completed {project.completion}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

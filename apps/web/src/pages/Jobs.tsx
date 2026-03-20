import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import type { ProcessingJob } from '@/lib/types';
import './Jobs.css';

type JobFilter = 'all' | 'queued' | 'running' | 'done' | 'failed' | 'dead';

export function JobsPage() {
  const [filter, setFilter] = useState<JobFilter>('all');

  const { data: jobsData, isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.get<{ jobs: ProcessingJob[]; total: number }>('/jobs?limit=500'),
    refetchInterval: 3000, // Auto-refresh every 3s
  });

  const allJobs = jobsData?.jobs ?? [];
  // Sort newest first
  const jobs = [...allJobs].sort((a, b) => b.created_at - a.created_at);
  const filteredJobs = jobs
    .filter((job) => {
      if (filter === 'all') return true;
      return job.status === filter;
    })
    .slice(0, 50);

  const queuedCount = jobs.filter((j) => j.status === 'queued').length;
  const runningCount = jobs.filter((j) => j.status === 'running').length;
  const doneCount = jobs.filter((j) => j.status === 'done').length;
  const failedCount = jobs.filter((j) => j.status === 'failed').length;
  const deadCount = jobs.filter((j) => j.status === 'dead').length;

  return (
    <div className="jobs-page">
      <div className="jobs-page__header">
        <h1>Jobs</h1>
        <div className="jobs-page__meta">
          <span className="text-muted">Auto-refreshing every 3s</span>
        </div>
      </div>

      <div className="jobs-page__status panel">
        <div className="worker-status">
          <h3 className="worker-status__title">Worker Status</h3>
          <div className="worker-status__grid">
            <div className="worker-stat">
              <span className="worker-stat__label">Mode</span>
              <span className="worker-stat__value">Idle</span>
            </div>
            <div className="worker-stat">
              <span className="worker-stat__label">Queued</span>
              <span className="worker-stat__value gold">{queuedCount}</span>
            </div>
            <div className="worker-stat">
              <span className="worker-stat__label">Running</span>
              <span className="worker-stat__value" style={{ color: 'var(--success)' }}>
                {runningCount}
              </span>
            </div>
            <div className="worker-stat">
              <span className="worker-stat__label">Failed</span>
              <span className="worker-stat__value" style={{ color: 'var(--danger)' }}>
                {failedCount}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="jobs-page__controls">
        <div className="filter-chips">
          <button
            className={`filter-chip ${filter === 'all' ? 'filter-chip--active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
            <span className="filter-chip__badge">{jobs.length}</span>
          </button>
          <button
            className={`filter-chip ${filter === 'queued' ? 'filter-chip--active' : ''}`}
            onClick={() => setFilter('queued')}
          >
            Queued
            <span className="filter-chip__badge">{queuedCount}</span>
          </button>
          <button
            className={`filter-chip ${filter === 'running' ? 'filter-chip--active' : ''}`}
            onClick={() => setFilter('running')}
          >
            Running
            <span className="filter-chip__badge">{runningCount}</span>
          </button>
          <button
            className={`filter-chip ${filter === 'done' ? 'filter-chip--active' : ''}`}
            onClick={() => setFilter('done')}
          >
            Done
            <span className="filter-chip__badge">{doneCount}</span>
          </button>
          <button
            className={`filter-chip ${filter === 'failed' ? 'filter-chip--active' : ''}`}
            onClick={() => setFilter('failed')}
          >
            Failed
            <span className="filter-chip__badge">{failedCount}</span>
          </button>
          <button
            className={`filter-chip ${filter === 'dead' ? 'filter-chip--active' : ''}`}
            onClick={() => setFilter('dead')}
          >
            Dead
            <span className="filter-chip__badge">{deadCount}</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="jobs-page__loading">
          <div className="skeleton" style={{ height: '100px' }} />
          <div className="skeleton" style={{ height: '100px' }} />
          <div className="skeleton" style={{ height: '100px' }} />
        </div>
      ) : filteredJobs.length > 0 ? (
        <div className="jobs-list">
          {filteredJobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      ) : (
        <div className="jobs-page__empty">
          <div className="icon-badge">⚙️</div>
          <h2>No jobs</h2>
          <p className="text-muted">
            {filter !== 'all' ? `No ${filter} jobs` : 'No jobs in the queue'}
          </p>
        </div>
      )}
    </div>
  );
}

interface JobCardProps {
  job: ProcessingJob;
}

function JobCard({ job }: JobCardProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const requeueMutation = useMutation({
    mutationFn: (jobId: string) => api.post(`/jobs/${jobId}/requeue`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const isImageModelError =
    (job.status === 'failed' || job.status === 'dead') &&
    job.job_type === 'tag_entry' &&
    job.last_error?.includes('image_tagging');

  const isFailedOrDead = job.status === 'failed' || job.status === 'dead';

  const statusColors: Record<string, string> = {
    queued: 'var(--text-2)',
    running: 'var(--success)',
    done: 'var(--gold-1)',
    failed: 'var(--danger)',
    dead: 'var(--text-3)',
    canceled: 'var(--text-2)',
  };

  const createdDate = new Date(job.created_at).toLocaleString();
  const updatedDate = new Date(job.updated_at).toLocaleString();

  return (
    <div className="job-card panel">
      <div className="job-card__header">
        <div className="job-card__title-section">
          <h3 className="job-card__type">{job.job_type}</h3>
          <span
            className="badge"
            style={{ borderColor: statusColors[job.status], color: statusColors[job.status] }}
          >
            {job.status.toUpperCase()}
          </span>
        </div>

        {job.entry_title ? (
          <span className="job-card__entry-id text-muted">{job.entry_title}</span>
        ) : job.entry_id ? (
          <span className="job-card__entry-id text-muted">Entry: {job.entry_id.slice(0, 8)}...</span>
        ) : null}
      </div>

      <div className="job-card__meta-grid">
        <div className="job-meta">
          <span className="job-meta__label">Pot ID</span>
          <span className="job-meta__value">{job.pot_id?.slice(0, 12) || 'N/A'}...</span>
        </div>

        <div className="job-meta">
          <span className="job-meta__label">Priority</span>
          <span className="job-meta__value">{job.priority}</span>
        </div>

        <div className="job-meta">
          <span className="job-meta__label">Attempts</span>
          <span className="job-meta__value">
            {job.attempts} / {job.max_attempts}
          </span>
        </div>
      </div>

      {job.last_error && (
        <div className="job-card__error">
          <strong>Error:</strong> {job.last_error}
        </div>
      )}

      {isFailedOrDead && (
        <div className="job-card__actions" style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          {isImageModelError && (
            <button
              className="btn-secondary"
              onClick={() => navigate('/settings')}
              style={{ fontSize: '12px', padding: '4px 10px' }}
            >
              Configure Image Model
            </button>
          )}
          <button
            className="btn-secondary"
            onClick={() => requeueMutation.mutate(job.id)}
            disabled={requeueMutation.isPending}
            style={{ fontSize: '12px', padding: '4px 10px' }}
          >
            {requeueMutation.isPending ? 'Retrying...' : 'Retry Job'}
          </button>
        </div>
      )}

      <div className="job-card__footer">
        <span className="text-muted">Created {createdDate}</span>
        <span className="text-muted">Updated {updatedDate}</span>
      </div>
    </div>
  );
}

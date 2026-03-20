import './Audit.css';

export function AuditPage() {
  return (
    <div className="audit-page">
      <div className="audit-page__header">
        <h1>Audit Log</h1>
      </div>

      <div className="audit-page__placeholder panel">
        <div className="audit-placeholder">
          <div className="icon-badge">📋</div>
          <h2>Audit Log Not Available</h2>
          <p className="text-muted">
            The audit log functionality exists in the backend storage layer, but is not yet exposed via API endpoints.
          </p>
          <p className="text-muted">
            Backend functions available:
          </p>
          <ul className="audit-placeholder__list">
            <li><code>getRecentAuditEvents(limit)</code></li>
            <li><code>getAuditEventsByPot(potId)</code></li>
            <li><code>getAuditEventsByEntry(entryId)</code></li>
          </ul>
          <p className="text-muted">
            <strong>Required:</strong> Add API endpoint (e.g., <code>GET /audit</code>) to expose audit events.
          </p>
        </div>
      </div>
    </div>
  );
}

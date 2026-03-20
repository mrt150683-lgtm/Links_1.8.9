/**
 * Rejection Tracker
 *
 * Accumulates per-source yield records and aggregate rejection counts
 * across all learning filter stages and URL triage. Supports checkpoint
 * save/restore so escalator can resume mid-run.
 */

import type { Learning, RejectionSummary, SourceExtractionRecord } from '@links/core';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'deep-research:rejectionTracker' });

export class RejectionTracker {
    private summary: RejectionSummary = {
        dropped_missing_evidence: 0,
        dropped_not_2023_plus: 0,
        dropped_topic_mismatch: 0,
        dropped_duplicate: 0,
        triage_rejected_low_relevance: 0,
        triage_rejected_not_recent: 0,
        total_urls_triaged: 0,
        total_urls_ingested: 0,
        total_candidates_extracted: 0,
        total_candidates_accepted: 0,
    };

    private sourceMap = new Map<string, SourceExtractionRecord>();

    private rejectionFreq = new Map<string, number>();

    // ── Triage ──────────────────────────────────────────────────────────────

    recordTriageRejection(url: string, reason: 'low_relevance' | 'not_recent'): void {
        this.summary.total_urls_triaged++;
        if (reason === 'low_relevance') {
            this.summary.triage_rejected_low_relevance++;
        } else {
            this.summary.triage_rejected_not_recent++;
        }
        this.bumpRejectionFreq(`triage:${reason}`);
    }

    recordTriagePass(url: string): void {
        this.summary.total_urls_triaged++;
        this.summary.total_urls_ingested++;
        void url; // no-op — counted in bulk
    }

    // ── Learning-level ───────────────────────────────────────────────────────

    recordLearningCandidate(sourceId: string): void {
        this.ensureSource(sourceId);
        this.getSource(sourceId).candidates_found++;
        this.summary.total_candidates_extracted++;
    }

    recordLearningAccepted(sourceId: string, _learning: Learning): void {
        this.ensureSource(sourceId);
        this.getSource(sourceId).learnings_accepted++;
        this.summary.total_candidates_accepted++;
    }

    recordLearningRejected(sourceId: string, reason: string): void {
        this.ensureSource(sourceId);
        const rec = this.getSource(sourceId);
        rec.rejection_counts[reason] = (rec.rejection_counts[reason] ?? 0) + 1;

        // Update aggregate summary
        if (reason === 'missing_evidence') this.summary.dropped_missing_evidence++;
        else if (reason === 'not_2023_plus') this.summary.dropped_not_2023_plus++;
        else if (reason === 'topic_mismatch') this.summary.dropped_topic_mismatch++;
        else if (reason === 'duplicate') this.summary.dropped_duplicate++;

        this.bumpRejectionFreq(reason);
    }

    // ── Accessors ────────────────────────────────────────────────────────────

    getSummary(): RejectionSummary {
        return { ...this.summary };
    }

    getSourceRecords(): SourceExtractionRecord[] {
        return Array.from(this.sourceMap.values());
    }

    getTopRejectionReasons(n: number): Array<{ reason: string; count: number }> {
        return Array.from(this.rejectionFreq.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, n)
            .map(([reason, count]) => ({ reason, count }));
    }

    /**
     * Restore tracker state from a checkpoint artifact.
     * Called on resume so counters reflect previous progress.
     */
    restore(summary: RejectionSummary, records: SourceExtractionRecord[]): void {
        this.summary = { ...summary };
        this.sourceMap = new Map(records.map((r) => [r.source_id, { ...r }]));

        // Rebuild rejectionFreq from records
        this.rejectionFreq.clear();
        for (const rec of records) {
            for (const [reason, count] of Object.entries(rec.rejection_counts)) {
                this.rejectionFreq.set(reason, (this.rejectionFreq.get(reason) ?? 0) + count);
            }
        }

        logger.info({
            sources_restored: records.length,
            total_accepted: summary.total_candidates_accepted,
            msg: 'RejectionTracker restored from checkpoint',
        });
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private ensureSource(sourceId: string): void {
        if (!this.sourceMap.has(sourceId)) {
            this.sourceMap.set(sourceId, {
                source_id: sourceId,
                source_type: 'pot',
                candidates_found: 0,
                learnings_accepted: 0,
                rejection_counts: {},
            });
        }
    }

    private getSource(sourceId: string): SourceExtractionRecord {
        return this.sourceMap.get(sourceId)!;
    }

    private bumpRejectionFreq(reason: string): void {
        this.rejectionFreq.set(reason, (this.rejectionFreq.get(reason) ?? 0) + 1);
    }
}

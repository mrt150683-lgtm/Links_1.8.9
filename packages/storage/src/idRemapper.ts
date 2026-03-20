/**
 * Phase 9: ID Remapping Utilities
 *
 * Maps old IDs to new IDs during pot import.
 * Ensures no collisions and maintains referential integrity.
 *
 * Flow:
 * 1. Create remapper with oldPotId
 * 2. Register old -> new IDs as you create new records
 * 3. Query remapped IDs when updating references
 */

import { randomUUID } from 'node:crypto';

/**
 * ID mapping for a single pot import
 */
export class IdRemapper {
  private readonly oldPotId: string;
  private readonly newPotId: string;

  private readonly entryMap = new Map<string, string>();
  private readonly assetMap = new Map<string, string>();
  private readonly artifactMap = new Map<string, string>();
  private readonly linkMap = new Map<string, string>();

  constructor(oldPotId: string, newPotId?: string) {
    this.oldPotId = oldPotId;
    this.newPotId = newPotId || randomUUID();
  }

  // Pot ID getters

  getOldPotId(): string {
    return this.oldPotId;
  }

  getNewPotId(): string {
    return this.newPotId;
  }

  // Entry ID mapping

  registerEntry(oldId: string, newId: string): void {
    this.entryMap.set(oldId, newId);
  }

  remapEntry(oldId: string): string {
    const newId = this.entryMap.get(oldId);
    if (!newId) {
      throw new Error(`Entry ID not mapped: ${oldId}`);
    }
    return newId;
  }

  generateEntry(oldId?: string): string {
    const newId = randomUUID();
    if (oldId) {
      this.registerEntry(oldId, newId);
    }
    return newId;
  }

  // Asset ID mapping

  registerAsset(oldId: string, newId: string): void {
    this.assetMap.set(oldId, newId);
  }

  remapAsset(oldId: string): string | null {
    // Asset IDs can be null, so return null if not found
    return this.assetMap.get(oldId) ?? null;
  }

  remapAssetNonNull(oldId: string): string {
    const newId = this.assetMap.get(oldId);
    if (!newId) {
      throw new Error(`Asset ID not mapped: ${oldId}`);
    }
    return newId;
  }

  generateAsset(oldId?: string): string {
    const newId = randomUUID();
    if (oldId) {
      this.registerAsset(oldId, newId);
    }
    return newId;
  }

  // Artifact ID mapping

  registerArtifact(oldId: string, newId: string): void {
    this.artifactMap.set(oldId, newId);
  }

  remapArtifact(oldId: string): string {
    const newId = this.artifactMap.get(oldId);
    if (!newId) {
      throw new Error(`Artifact ID not mapped: ${oldId}`);
    }
    return newId;
  }

  generateArtifact(oldId?: string): string {
    const newId = randomUUID();
    if (oldId) {
      this.registerArtifact(oldId, newId);
    }
    return newId;
  }

  // Link ID mapping

  registerLink(oldId: string, newId: string): void {
    this.linkMap.set(oldId, newId);
  }

  remapLink(oldId: string): string {
    const newId = this.linkMap.get(oldId);
    if (!newId) {
      throw new Error(`Link ID not mapped: ${oldId}`);
    }
    return newId;
  }

  generateLink(oldId?: string): string {
    const newId = randomUUID();
    if (oldId) {
      this.registerLink(oldId, newId);
    }
    return newId;
  }

  // Statistics

  getStats(): {
    entries: number;
    assets: number;
    artifacts: number;
    links: number;
  } {
    return {
      entries: this.entryMap.size,
      assets: this.assetMap.size,
      artifacts: this.artifactMap.size,
      links: this.linkMap.size,
    };
  }

  // Bulk operations

  /**
   * Remap an entry record (mutates in place)
   */
  remapEntryRecord(entry: any): void {
    entry.pot_id = this.newPotId;
    if (entry.asset_id) {
      entry.asset_id = this.remapAsset(entry.asset_id);
    }
  }

  /**
   * Remap an artifact record (mutates in place)
   */
  remapArtifactRecord(artifact: any): void {
    artifact.pot_id = this.newPotId;
    artifact.entry_id = this.remapEntry(artifact.entry_id);
  }

  /**
   * Remap a link record (mutates in place)
   */
  remapLinkRecord(link: any): void {
    link.pot_id = this.newPotId;
    link.src_entry_id = this.remapEntry(link.src_entry_id);
    link.dst_entry_id = this.remapEntry(link.dst_entry_id);
  }

  /**
   * Remap an audit event record (mutates in place)
   */
  remapAuditRecord(audit: any): void {
    if (audit.pot_id) {
      audit.pot_id = this.newPotId;
    }
    if (audit.entry_id) {
      audit.entry_id = this.remapEntry(audit.entry_id);
    }
  }
}

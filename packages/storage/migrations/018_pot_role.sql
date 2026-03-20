-- Migration 018: Agent Roles per Pot
-- Purpose: Allow each pot to carry a custom AI role prompt that shapes all AI pipeline behavior.
-- Created: 2026-02-19

PRAGMA foreign_keys = ON;

-- Add role columns to pots table
ALTER TABLE pots ADD COLUMN role_ref TEXT;
ALTER TABLE pots ADD COLUMN role_hash TEXT;
ALTER TABLE pots ADD COLUMN role_updated_at INTEGER;

-- Add role_hash provenance column to derived_artifacts
-- Tracks which role was active when this artifact was generated.
-- Nulls indicate artifacts generated before role support was added (pre-migration behavior).
ALTER TABLE derived_artifacts ADD COLUMN role_hash TEXT;

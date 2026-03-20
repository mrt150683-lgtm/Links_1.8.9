-- Migration 005: Phase 6 - OpenRouter Integration (Model Registry)
-- Purpose: Store cached model metadata from OpenRouter API
-- Created: 2026-02-13

PRAGMA foreign_keys = ON;

-- Model registry table
-- Stores cached metadata about available AI models from OpenRouter
CREATE TABLE ai_models (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  context_length INTEGER NOT NULL,
  pricing_prompt REAL,
  pricing_completion REAL,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  supports_tools INTEGER NOT NULL DEFAULT 0,
  architecture TEXT,
  modalities TEXT,
  top_provider TEXT,
  fetched_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

-- Index for cache freshness checks
CREATE INDEX idx_models_fetched_at ON ai_models(fetched_at DESC);

-- Indices for capability filtering
CREATE INDEX idx_models_vision ON ai_models(supports_vision) WHERE supports_vision = 1;
CREATE INDEX idx_models_tools ON ai_models(supports_tools) WHERE supports_tools = 1;

import { z } from 'zod';

// Request schemas
export const CreatePotRequestSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
});

export const UpdatePotRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
});

// Response schemas
export const PotResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  security_level: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
});

export const PotListResponseSchema = z.object({
  pots: z.array(PotResponseSchema),
  total: z.number(),
});

export const DeletePotResponseSchema = z.object({
  ok: z.boolean(),
});

// Agent roles (018_pot_role)
export const SetPotRoleRequestSchema = z.object({
  text: z.string().max(12000, 'Role text must be 12000 characters or fewer'),
});

export const PotRoleResponseSchema = z.object({
  role_ref: z.string().nullable(),
  source: z.enum(['user', 'builtin', 'default']),
  text: z.string(),
  hash: z.string(),
  updated_at: z.number().nullable(),
  lint_warnings: z.array(z.string()),
});

// Types
export type CreatePotRequest = z.infer<typeof CreatePotRequestSchema>;
export type UpdatePotRequest = z.infer<typeof UpdatePotRequestSchema>;
export type PotResponse = z.infer<typeof PotResponseSchema>;
export type PotListResponse = z.infer<typeof PotListResponseSchema>;
export type DeletePotResponse = z.infer<typeof DeletePotResponseSchema>;
export type SetPotRoleRequest = z.infer<typeof SetPotRoleRequestSchema>;
export type PotRoleResponse = z.infer<typeof PotRoleResponseSchema>;

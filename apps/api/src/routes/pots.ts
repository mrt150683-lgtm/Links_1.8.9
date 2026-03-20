import type { FastifyPluginAsync } from 'fastify';
import {
  CreatePotRequestSchema,
  UpdatePotRequestSchema,
  SetPotRoleRequestSchema,
  type CreatePotRequest,
  type UpdatePotRequest,
} from '@links/core';
import {
  createPot,
  getPotById,
  listPots,
  updatePot,
  deletePot,
  countPots,
  updatePotRole,
  writeRoleFile,
  readRoleFile,
} from '@links/storage';
import { resolveEffectiveRole, lintRole } from '@links/ai';

const potsRoute: FastifyPluginAsync = async (fastify) => {
  // Create pot
  fastify.post('/pots', async (request, reply) => {
    const result = CreatePotRequestSchema.safeParse(request.body);

    if (!result.success) {
      reply.status(400).send({
        error: 'ValidationError',
        message: 'Invalid request body',
        statusCode: 400,
        request_id: request.id,
      });
      return;
    }

    const body = result.data as CreatePotRequest;

    const pot = await createPot({
      name: body.name,
      description: body.description,
    });

    reply.status(201).send(pot);
  });

  // List pots
  fastify.get('/pots', async (request) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 100;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;

    const pots = await listPots(limit, offset);
    const total = await countPots();

    return {
      pots,
      total,
    };
  });

  // Get pot by ID
  fastify.get<{ Params: { id: string } }>('/pots/:id', async (request, reply) => {
    const pot = await getPotById(request.params.id);

    if (!pot) {
      reply.status(404).send({
        error: 'NotFoundError',
        message: 'Pot not found',
        statusCode: 404,
      });
      return;
    }

    return pot;
  });

  // Update pot
  fastify.patch<{ Params: { id: string } }>('/pots/:id', async (request, reply) => {
    const body = UpdatePotRequestSchema.parse(request.body) as UpdatePotRequest;

    const pot = await updatePot(request.params.id, {
      name: body.name,
      description: body.description,
    });

    if (!pot) {
      reply.status(404).send({
        error: 'NotFoundError',
        message: 'Pot not found',
        statusCode: 404,
      });
      return;
    }

    return pot;
  });

  // Delete pot
  fastify.delete<{ Params: { id: string } }>('/pots/:id', async (request, reply) => {
    const deleted = await deletePot(request.params.id);

    if (!deleted) {
      reply.status(404).send({
        error: 'NotFoundError',
        message: 'Pot not found',
        statusCode: 404,
      });
      return;
    }

    return { ok: true };
  });

  // Get effective role for a pot
  fastify.get<{ Params: { id: string } }>('/pots/:id/role', async (request, reply) => {
    const pot = await getPotById(request.params.id);
    if (!pot) {
      reply.status(404).send({
        error: 'NotFoundError',
        message: 'Pot not found',
        statusCode: 404,
      });
      return;
    }

    const role = await resolveEffectiveRole(pot);
    const warnings = lintRole(role.text);

    return {
      role_ref: pot.role_ref,
      source: role.source,
      text: role.text,
      hash: role.hash,
      updated_at: pot.role_updated_at,
      lint_warnings: warnings,
    };
  });

  // Set user-defined role for a pot
  fastify.put<{ Params: { id: string } }>('/pots/:id/role', async (request, reply) => {
    const pot = await getPotById(request.params.id);
    if (!pot) {
      reply.status(404).send({
        error: 'NotFoundError',
        message: 'Pot not found',
        statusCode: 404,
      });
      return;
    }

    const parseResult = SetPotRoleRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400).send({
        error: 'ValidationError',
        message: parseResult.error.errors[0]?.message ?? 'Invalid request body',
        statusCode: 400,
        request_id: request.id,
      });
      return;
    }

    const { text } = parseResult.data;

    // Write user role file to disk
    writeRoleFile(pot.id, text);

    // Compute hash via resolveEffectiveRole (reads back the file we just wrote)
    const role = await resolveEffectiveRole({ id: pot.id, role_ref: 'user:' });

    // Persist role_ref + role_hash to DB
    await updatePotRole(pot.id, {
      role_ref: 'user:',
      role_hash: role.hash,
      role_updated_at: Date.now(),
    });

    const warnings = lintRole(role.text);

    return {
      role_ref: 'user:',
      source: role.source,
      text: role.text,
      hash: role.hash,
      updated_at: Date.now(),
      lint_warnings: warnings,
    };
  });
};

export default potsRoute;

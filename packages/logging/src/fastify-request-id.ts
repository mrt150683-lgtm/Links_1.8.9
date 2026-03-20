import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    id: string;
  }
}

const requestIdPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request.headers['x-request-id'] as string) ?? randomUUID();

    request.id = requestId;
    reply.header('x-request-id', requestId);

    // Bind logger with request_id
    request.log = request.log.child({ request_id: requestId });
  });
};

export default fp(requestIdPlugin, {
  name: 'request-id',
  fastify: '5.x',
});

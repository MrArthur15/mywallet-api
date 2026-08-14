import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function bankRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    await request.jwtVerify();
  });

  app.get(
    '/banks',
    {
      schema: {
        tags: ['Banks'],
        summary: 'Listar bancos suportados',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                color: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const banks = await prisma.bank.findMany({
        select: {
          id: true,
          name: true,
          color: true,
        },
        orderBy: { name: 'asc' },
      });

      return reply.status(200).send(banks);
    }
  );
}
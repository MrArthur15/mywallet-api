import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function bankRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    await request.jwtVerify();
  });

  app.get('/banks', async (request, reply) => {
    const banks = await prisma.bank.findMany({
      select: {
        id: true,
        name: true,
        color: true,
      },
      orderBy: { name: 'asc' },
    });

    return reply.status(200).send(banks);
  });
}
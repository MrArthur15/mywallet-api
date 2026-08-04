import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function bankRoutes(app: FastifyInstance) {
  // Proteção por Token JWT
  app.addHook('onRequest', async (request, reply) => {
    await request.jwtVerify();
  });

  // ===========================================================================
  // Rota GET: Retorna o catálogo de bancos cadastrados (para os <select> do app)
  // ===========================================================================
  app.get('/banks', async (request, reply) => {
    const banks = await prisma.bank.findMany({
      select: {
        id: true,
        name: true,
        color: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return reply.status(200).send(banks);
  });
}
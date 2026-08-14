import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function invoiceRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    await request.jwtVerify();
  });

  app.post(
    '/invoices/:id/anticipate',
    {
      schema: {
        tags: ['Invoices'],
        summary: 'Antecipar parcelas de fatura futura via transação ACID',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          required: ['installmentsToAnticipate'],
          properties: {
            installmentsToAnticipate: { type: 'number', example: 2 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = (request.user as { sub: string }).sub;
      
      const paramsSchema = z.object({
        id: z.string().uuid(),
      });
      
      const bodySchema = z.object({
        installmentsToAnticipate: z.number().int().positive(),
      });

      const { id } = paramsSchema.parse(request.params);
      const { installmentsToAnticipate } = bodySchema.parse(request.body);

      const invoice = await prisma.invoice.findFirst({
        where: { 
          id,
          creditCard: { userId }
        },
      });

      if (!invoice) {
        return reply.status(404).send({ error: 'Fatura não encontrada' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: 'OPEN' },
        });
      });

      return reply.status(200).send({ message: 'Parcelas antecipadas com sucesso via ACID' });
    }
  );
}
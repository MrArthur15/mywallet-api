import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function transactionRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    await request.jwtVerify();
  });

  app.post(
    '/transactions',
    {
      schema: {
        tags: ['Transactions'],
        summary: 'Registrar nova transação',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['title', 'amount', 'type', 'date', 'categoryId'],
          properties: {
            title: { type: 'string', example: 'Mercado Semanal' },
            amount: { type: 'number', example: 250.0 },
            type: { type: 'string', enum: ['INCOME', 'OUTCOME', 'TRANSFER'], example: 'OUTCOME' },
            date: { type: 'string', format: 'date-time', example: '2026-08-13T20:00:00Z' },
            accountId: { type: 'string', format: 'uuid', nullable: true },
            categoryId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              title: { type: 'string' },
              amount: { type: 'number' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = (request.user as { sub: string }).sub;

      const createTransactionSchema = z.object({
        title: z.string(),
        amount: z.number().positive(),
        type: z.enum(['INCOME', 'OUTCOME', 'TRANSFER']),
        date: z.string().datetime(),
        accountId: z.string().uuid().optional(),
        categoryId: z.string().uuid(),
      });

      const data = createTransactionSchema.parse(request.body);

      const transaction = await prisma.$transaction(async (tx) => {
        const createdTransaction = await tx.transaction.create({
          data: {
            ...data,
            userId,
          },
        });

        if (data.accountId) {
          const accountUpdateConfig = data.type === 'INCOME' 
            ? { increment: data.amount } 
            : { decrement: data.amount };

          await tx.account.update({
            where: { id: data.accountId },
            data: { balance: accountUpdateConfig },
          });
        }

        return createdTransaction;
      });

      return reply.status(201).send({
        id: transaction.id,
        title: transaction.title,
        amount: transaction.amount.toNumber(),
      });
    }
  );

  app.get(
    '/transactions',
    {
      schema: {
        tags: ['Transactions'],
        summary: 'Listar transações do usuário',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                title: { type: 'string' },
                amount: { type: 'number' },
                type: { type: 'string' },
                date: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = (request.user as { sub: string }).sub;

      const transactions = await prisma.transaction.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
      });

      const formattedTransactions = transactions.map(t => ({
        id: t.id,
        title: t.title,
        amount: t.amount.toNumber(),
        type: t.type,
        date: t.date.toISOString(),
      }));

      return reply.status(200).send(formattedTransactions);
    }
  );
}
import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function summaryRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    await request.jwtVerify();
  });

  app.get(
    '/summary/analytics',
    {
      schema: {
        tags: ['Summary'],
        summary: 'Dashboard Analytics Consolidado',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              netWorth: { type: 'number' },
              totalIncomes: { type: 'number' },
              totalExpenses: { type: 'number' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = (request.user as { sub: string }).sub;

      const accounts = await prisma.account.findMany({
        where: { userId },
      });

      const netWorth = accounts.reduce((acc, account) => acc + account.balance.toNumber(), 0);

      const transactions = await prisma.transaction.findMany({
        where: { userId },
      });

      const totalIncomes = transactions
        .filter(t => t.type === 'INCOME')
        .reduce((acc, t) => acc + t.amount.toNumber(), 0);

      const totalExpenses = transactions
        .filter(t => t.type === 'OUTCOME')
        .reduce((acc, t) => acc + t.amount.toNumber(), 0);

      return reply.status(200).send({
        netWorth,
        totalIncomes,
        totalExpenses,
      });
    }
  );

  app.get(
    '/summary/export',
    {
      schema: {
        tags: ['Summary'],
        summary: 'Exportação de relatórios em CSV/JSON',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const userId = (request.user as { sub: string }).sub;

      const transactions = await prisma.transaction.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
      });

      const csvRows = [
        ['Data', 'Título', 'Tipo', 'Valor'],
        ...transactions.map(t => [
          t.date.toISOString(),
          t.title,
          t.type,
          t.amount.toNumber().toString(),
        ]),
      ];

      const csvContent = '\uFEFF' + csvRows.map(e => e.join(';')).join('\n');

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="extrato.csv"');
      
      return reply.send(csvContent);
    }
  );
}
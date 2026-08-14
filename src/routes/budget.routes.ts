import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function budgetRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    await request.jwtVerify();
  });

  app.post(
    '/budgets',
    {
      schema: {
        tags: ['Budgets'],
        summary: 'Definir limite de orçamento mensal',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['categoryId', 'limitAmount', 'month', 'year'],
          properties: {
            categoryId: { type: 'string', format: 'uuid' },
            limitAmount: { type: 'number', example: 1000.00 },
            month: { type: 'number', example: 8 },
            year: { type: 'number', example: 2026 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              limitAmount: { type: 'number' },
            },
          },
          201: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              limitAmount: { type: 'number' },
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

      const createBudgetSchema = z.object({
        categoryId: z.string().uuid({ message: 'ID da categoria inválido' }),
        limitAmount: z.number().positive({ message: 'O valor do orçamento deve ser maior que zero' }),
        month: z.number().int().min(1).max(12),
        year: z.number().int().min(2000).max(2100),
      });

      const { categoryId, limitAmount, month, year } = createBudgetSchema.parse(request.body);

      const category = await prisma.category.findFirst({
        where: { id: categoryId, userId },
      });

      if (!category) {
        return reply.status(404).send({ error: 'Categoria não encontrada.' });
      }

      const existingBudget = await prisma.budget.findFirst({
        where: { userId, categoryId, month, year },
      });

      if (existingBudget) {
        const updated = await prisma.budget.update({
          where: { id: existingBudget.id },
          data: { limitAmount },
        });
        return reply.status(200).send({ ...updated, limitAmount: updated.limitAmount.toNumber() });
      }

      const budget = await prisma.budget.create({
        data: {
          userId,
          categoryId,
          limitAmount,
          month,
          year,
        },
      });

      return reply.status(201).send({ ...budget, limitAmount: budget.limitAmount.toNumber() });
    }
  );

  app.get(
    '/budgets',
    {
      schema: {
        tags: ['Budgets'],
        summary: 'Listar orçamentos e progresso',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            month: { type: 'number' },
            year: { type: 'number' },
          },
        },
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                limitAmount: { type: 'number' },
                spentAmount: { type: 'number' },
                percentageUsed: { type: 'number' },
                isOverBudget: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = (request.user as { sub: string }).sub;

      const querySchema = z.object({
        month: z.coerce.number().int().min(1).max(12).default(() => new Date().getUTCMonth() + 1),
        year: z.coerce.number().int().min(2000).max(2100).default(() => new Date().getUTCFullYear()),
      });

      const { month, year } = querySchema.parse(request.query);

      const budgets = await prisma.budget.findMany({
        where: { userId, month, year },
        include: {
          category: true,
        },
        orderBy: { limitAmount: 'desc' },
      });

      const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

      const budgetsWithProgress = await Promise.all(
        budgets.map(async (budget) => {
          const aggregate = await prisma.transaction.aggregate({
            where: {
              userId,
              categoryId: budget.categoryId,
              type: 'OUTCOME',
              date: {
                gte: startOfMonth,
                lte: endOfMonth,
              },
            },
            _sum: {
              amount: true,
            },
          });

          const spentAmount = Number(aggregate._sum.amount || 0);
          const targetAmount = budget.limitAmount.toNumber();

          const percentageUsed = targetAmount > 0
            ? Number(((spentAmount / targetAmount) * 100).toFixed(2))
            : 0;

          return {
            ...budget,
            limitAmount: targetAmount,
            spentAmount,
            percentageUsed,
            isOverBudget: spentAmount > targetAmount,
          };
        })
      );

      return reply.status(200).send(budgetsWithProgress);
    }
  );

  app.delete(
    '/budgets/:id',
    {
      schema: {
        tags: ['Budgets'],
        summary: 'Deletar orçamento',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          204: { type: 'null' },
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
        id: z.string().uuid({ message: 'ID do orçamento inválido' }),
      });

      const { id } = paramsSchema.parse(request.params);

      const budget = await prisma.budget.findFirst({
        where: { id, userId },
      });

      if (!budget) {
        return reply.status(404).send({ error: 'Orçamento não encontrado.' });
      }

      await prisma.budget.delete({ where: { id } });
      return reply.status(204).send();
    }
  );
}
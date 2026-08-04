import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function budgetRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    await request.jwtVerify();
  });

  // ===========================================================================
  // Rota POST: Cria ou atualiza o teto de gastos (limitAmount) para um mês/ano
  // ===========================================================================
  app.post('/budgets', async (request, reply) => {
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
        data: { limitAmount }, // <-- Atualizado para limitAmount
      });
      return reply.status(200).send(updated);
    }

    const budget = await prisma.budget.create({
      data: {
        userId,
        categoryId,
        limitAmount, // <-- Atualizado para limitAmount
        month,
        year,
      },
    });

    return reply.status(201).send(budget);
  });

  // ===========================================================================
  // Rota GET: Lista orçamentos do mês/ano calculando o gasto realizado em tempo real
  // ===========================================================================
  app.get('/budgets', async (request, reply) => {
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
      orderBy: { limitAmount: 'desc' }, // <-- Atualizado para limitAmount
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
        const targetAmount = Number(budget.limitAmount); // <-- Atualizado para limitAmount
        const percentageUsed = targetAmount > 0
          ? Number(((spentAmount / targetAmount) * 100).toFixed(2))
          : 0;

        return {
          ...budget,
          spentAmount,
          percentageUsed,
          isOverBudget: spentAmount > targetAmount,
        };
      })
    );

    return reply.status(200).send(budgetsWithProgress);
  });

  // ===========================================================================
  // Rota DELETE: Remove um orçamento mensal
  // ===========================================================================
  app.delete('/budgets/:id', async (request, reply) => {
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
  });
}
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function summaryRoutes(app: FastifyInstance) {
  // Exige Token JWT válido em todas as rotas
  app.addHook('onRequest', async (request, reply) => {
    await request.jwtVerify();
  });

  // ===========================================================================
  // Rota GET /summary: Resumo simples do mês (Entradas, Saídas e Saldo)
  // ===========================================================================
  app.get('/summary', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const getSummarySchema = z.object({
      month: z.coerce.number().min(1).max(12).default(() => new Date().getUTCMonth() + 1),
      year: z.coerce.number().min(2000).max(2100).default(() => new Date().getUTCFullYear()),
    });

    const { month, year } = getSummarySchema.parse(request.query);

    const firstDayOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const [incomeAggregate, outcomeAggregate, accounts] = await Promise.all([
      prisma.transaction.aggregate({
        where: {
          userId,
          type: 'INCOME',
          date: { gte: firstDayOfMonth, lte: lastDayOfMonth },
        },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: {
          userId,
          type: 'OUTCOME',
          date: { gte: firstDayOfMonth, lte: lastDayOfMonth },
        },
        _sum: { amount: true },
      }),
      prisma.account.findMany({
        where: { userId },
        select: { balance: true },
      }),
    ]);

    const totalIncome = Number(incomeAggregate._sum.amount || 0);
    const totalOutcome = Number(outcomeAggregate._sum.amount || 0);
    const monthlyBalance = totalIncome - totalOutcome;

    const totalAccountsBalance = accounts.reduce((acc, account) => {
      return acc + Number(account.balance);
    }, 0);

    return reply.status(200).send({
      month,
      year,
      summary: {
        totalIncome,
        totalOutcome,
        monthlyBalance,
        totalAccountsBalance,
      },
    });
  });

  // ===========================================================================
  // Rota GET /summary/analytics: Relatório Gerencial Completo e Dashboard
  // ===========================================================================
  app.get('/summary/analytics', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const getAnalyticsSchema = z.object({
      month: z.coerce.number().min(1).max(12).default(() => new Date().getUTCMonth() + 1),
      year: z.coerce.number().min(2000).max(2100).default(() => new Date().getUTCFullYear()),
    });

    const { month, year } = getAnalyticsSchema.parse(request.query);

    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    // 1. Consultas paralelas para máxima performance no banco relacional
    const [
      incomeAgg,
      outcomeAgg,
      accounts,
      goals,
      openInvoices,
      categories,
      groupedExpenses,
      budgets,
    ] = await Promise.all([
      // Total Entradas no mês
      prisma.transaction.aggregate({
        where: { userId, type: 'INCOME', date: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { amount: true },
      }),
      // Total Saídas no mês
      prisma.transaction.aggregate({
        where: { userId, type: 'OUTCOME', date: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { amount: true },
      }),
      // Todas as contas bancárias (para patrimônio)
      prisma.account.findMany({
        where: { userId },
        select: { id: true, name: true, balance: true, type: true },
      }),
      // Metas do usuário
      prisma.goal.findMany({
        where: { userId },
        select: { id: true, title: true, targetAmount: true, savedAmount: true },
      }),
      // Faturas de cartão ABERTAS no sistema
      prisma.invoice.findMany({
        where: {
          creditCard: { userId },
          status: 'OPEN',
        },
        select: { totalAmount: true },
      }),
      // Categorias para enriquecer o gráfico de gastos
      prisma.category.findMany({
        where: { userId },
        select: { id: true, name: true, color: true, icon: true },
      }),
      // Gastos do mês agrupados por categoria (Prisma groupBy)
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: {
          userId,
          type: 'OUTCOME',
          date: { gte: startOfMonth, lte: endOfMonth },
        },
        _sum: { amount: true },
      }),
      // Orçamentos cadastrados para este mês/ano
      prisma.budget.findMany({
        where: { userId, month, year },
        include: { category: true },
      }),
    ]);

    // 2. Cálculos de Fluxo de Caixa
    const totalIncome = Number(incomeAgg._sum.amount || 0);
    const totalOutcome = Number(outcomeAgg._sum.amount || 0);
    const monthlyBalance = totalIncome - totalOutcome;

    // 3. Cálculo de Patrimônio Líquido (Net Worth)
    const totalAccountsBalance = accounts.reduce((acc, c) => acc + Number(c.balance), 0);
    const totalGoalsSaved = goals.reduce((acc, g) => acc + Number(g.savedAmount), 0);
    const totalOpenInvoices = openInvoices.reduce((acc, i) => acc + Number(i.totalAmount), 0);
    const netWorth = totalAccountsBalance + totalGoalsSaved - totalOpenInvoices;

    // 4. Formatação de Gastos por Categoria (Gráfico de Pizza)
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const expensesByCategory = groupedExpenses
      .map((item) => {
        const cat = categoryMap.get(item.categoryId);
        const amount = Number(item._sum.amount || 0);
        const percentage = totalOutcome > 0
          ? Number(((amount / totalOutcome) * 100).toFixed(2))
          : 0;

        return {
          categoryId: item.categoryId,
          categoryName: cat?.name || 'Categoria Não Identificada',
          categoryColor: cat?.color || '#9E9E9E',
          categoryIcon: cat?.icon || null,
          amount,
          percentage,
        };
      })
      .sort((a, b) => b.amount - a.amount); // Ordena do maior gasto para o menor

    // 5. Mapeia gastos rápidos por categoria para comparar com os Orçamentos
    const spentByCategoryMap = new Map(
      groupedExpenses.map((item) => [item.categoryId, Number(item._sum.amount || 0)])
    );

    const budgetsReport = budgets.map((b) => {
      const spent = spentByCategoryMap.get(b.categoryId) || 0;
      const limit = Number(b.limitAmount);
      const percentageUsed = limit > 0 ? Number(((spent / limit) * 100).toFixed(2)) : 0;

      let status: 'OK' | 'WARNING' | 'EXCEEDED' = 'OK';
      if (percentageUsed >= 100) {
        status = 'EXCEEDED'; // Estourado (> 100%)
      } else if (percentageUsed >= 80) {
        status = 'WARNING';  // Quase estourando (80% a 99%)
      }

      return {
        budgetId: b.id,
        categoryName: b.category.name,
        categoryColor: b.category.color,
        limitAmount: limit,
        spentAmount: spent,
        remainingAmount: Number(Math.max(0, limit - spent).toFixed(2)),
        percentageUsed,
        status,
      };
    });

    // 6. Resumo de Progresso das Metas
    const goalsReport = goals.map((g) => {
      const saved = Number(g.savedAmount);
      const target = Number(g.targetAmount);
      const progressPercentage = target > 0 ? Number(((saved / target) * 100).toFixed(2)) : 0;

      return {
        goalId: g.id,
        title: g.title,
        savedAmount: saved,
        targetAmount: target,
        progressPercentage,
      };
    });

    // 7. Retorno Consolidado para Relatório / Dashboard
    return reply.status(200).send({
      period: {
        month,
        year,
      },
      overview: {
        totalIncome,
        totalOutcome,
        monthlyBalance,
        totalAccountsBalance,
        totalGoalsSaved,
        totalOpenInvoices,
        netWorth,
      },
      expensesByCategory,
      budgets: budgetsReport,
      goals: goalsReport,
    });
  });
}
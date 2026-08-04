import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function goalRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    await request.jwtVerify();
  });

  // ===========================================================================
  // Rota POST: Cria uma nova meta financeira
  // ===========================================================================
  app.post('/goals', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const createGoalSchema = z.object({
      title: z.string().min(2, { message: 'O título da meta deve ter pelo menos 2 caracteres' }),
      targetAmount: z.number().positive({ message: 'O valor alvo deve ser maior que zero' }),
      deadline: z.coerce.date().optional(),
    });

    const { title, targetAmount, deadline } = createGoalSchema.parse(request.body);

    const goal = await prisma.goal.create({
      data: {
        userId,
        title,              // <-- Alinhado com o schema (title)
        targetAmount,
        savedAmount: 0,     // <-- Alinhado com o schema (savedAmount)
        deadline: deadline || undefined,
      },
    });

    return reply.status(201).send(goal);
  });

  // ===========================================================================
  // Rota GET: Lista metas do usuário com porcentagem de progresso calculada
  // ===========================================================================
  app.get('/goals', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const goals = await prisma.goal.findMany({
      where: { userId },
      include: {
        deposits: true,     // <-- Inclui o histórico de aportes (GoalDeposit)
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calcula dinamicamente a porcentagem atingida de cada meta
    const goalsWithProgress = goals.map((goal) => {
      const current = Number(goal.savedAmount);
      const target = Number(goal.targetAmount);
      const progressPercentage = target > 0 ? Number(((current / target) * 100).toFixed(2)) : 0;

      return {
        ...goal,
        progressPercentage,
      };
    });

    return reply.status(200).send(goalsWithProgress);
  });

  // ===========================================================================
  // Rota POST: Aportar dinheiro na meta (Debita da Conta -> Soma na Meta)
  // ===========================================================================
  app.post('/goals/:id/deposit', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      id: z.string().uuid({ message: 'ID da meta inválido' }),
    });

    const bodySchema = z.object({
      accountId: z.string().uuid({ message: 'ID da conta bancária de origem é obrigatório' }),
      amount: z.number().positive({ message: 'O valor do aporte deve ser maior que zero' }),
    });

    const { id } = paramsSchema.parse(request.params);
    const { accountId, amount } = bodySchema.parse(request.body);

    const goal = await prisma.goal.findFirst({ where: { id, userId } });
    const account = await prisma.account.findFirst({ where: { id: accountId, userId } });

    if (!goal) return reply.status(404).send({ error: 'Meta não encontrada.' });
    if (!account) return reply.status(404).send({ error: 'Conta bancária não encontrada.' });

    if (Number(account.balance) < amount) {
      return reply.status(400).send({ error: 'Saldo insuficiente na conta bancária para este aporte.' });
    }

    // Transação ACID: Deduz da conta, cria o registro de auditoria e adiciona em savedAmount
    const updatedGoal = await prisma.$transaction(async (tx) => {
      // 1. Deduz da conta corrente
      await tx.account.update({
        where: { id: accountId },
        data: { balance: { decrement: amount } },
      });

      // 2. Registra o aporte no histórico de auditoria (GoalDeposit)
      await tx.goalDeposit.create({
        data: {
          goalId: id,
          amount,
        },
      });

      // 3. Atualiza o saldo acumulado da meta
      return tx.goal.update({
        where: { id },
        data: {
          savedAmount: { increment: amount },
        },
      });
    });
    return reply.status(200).send(updatedGoal);
  });

  // ===========================================================================
  // Rota POST: Resgatar dinheiro da meta (Deduz da Meta -> Devolve para a Conta)
  // ===========================================================================
  app.post('/goals/:id/withdraw', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      id: z.string().uuid({ message: 'ID da meta inválido' }),
    });

    const bodySchema = z.object({
      accountId: z.string().uuid({ message: 'ID da conta bancária de destino é obrigatório' }),
      amount: z.number().positive({ message: 'O valor do resgate deve ser maior que zero' }),
    });

    const { id } = paramsSchema.parse(request.params);
    const { accountId, amount } = bodySchema.parse(request.body);

    const goal = await prisma.goal.findFirst({ where: { id, userId } });
    const account = await prisma.account.findFirst({ where: { id: accountId, userId } });

    if (!goal) return reply.status(404).send({ error: 'Meta não encontrada.' });
    if (!account) return reply.status(404).send({ error: 'Conta bancária não encontrada.' });

    if (Number(goal.savedAmount) < amount) {
      return reply.status(400).send({ error: 'O valor solicitado é maior do que o saldo salvo na meta.' });
    }

    const updatedGoal = await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: accountId },
        data: { balance: { increment: amount } },
      });

      return tx.goal.update({
        where: { id },
        data: {
          savedAmount: { decrement: amount }, // <-- Usando savedAmount
        },
      });
    });

    return reply.status(200).send(updatedGoal);
  });

  // ===========================================================================
  // Rota DELETE: Remove uma meta
  // ===========================================================================
  app.delete('/goals/:id', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      id: z.string().uuid({ message: 'ID da meta inválido' }),
    });

    const { id } = paramsSchema.parse(request.params);

    const goal = await prisma.goal.findFirst({ where: { id, userId } });

    if (!goal) {
      return reply.status(404).send({ error: 'Meta não encontrada.' });
    }

    await prisma.goal.delete({ where: { id } });
    return reply.status(204).send();
  });
}
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function goalRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    await request.jwtVerify();
  });

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
        title,
        targetAmount,
        savedAmount: 0,
        deadline: deadline || undefined,
      },
    });

    return reply.status(201).send(goal);
  });

  app.get('/goals', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const goals = await prisma.goal.findMany({
      where: { userId },
      include: {
        deposits: true,
      },
      orderBy: { createdAt: 'desc' },
    });

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

    const updatedGoal = await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: accountId },
        data: { balance: { decrement: amount } },
      });

      await tx.goalDeposit.create({
        data: {
          goalId: id,
          amount,
        },
      });

      return tx.goal.update({
        where: { id },
        data: {
          savedAmount: { increment: amount },
        },
      });
    });

    return reply.status(200).send(updatedGoal);
  });

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
          savedAmount: { decrement: amount },
        },
      });
    });

    return reply.status(200).send(updatedGoal);
  });

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
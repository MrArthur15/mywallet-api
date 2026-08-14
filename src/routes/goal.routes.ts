import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function goalRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    await request.jwtVerify();
  });

  app.post(
    '/goals',
    {
      schema: {
        tags: ['Goals'],
        summary: 'Criar meta financeira',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['title', 'targetAmount'],
          properties: {
            title: { type: 'string', example: 'Comprar PC Gamer' },
            targetAmount: { type: 'number', example: 5000.00 },
            deadline: { type: 'string', format: 'date-time' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              title: { type: 'string' },
              targetAmount: { type: 'number' },
            },
          },
        },
      },
    },
    async (request, reply) => {
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

      return reply.status(201).send({
        ...goal,
        targetAmount: goal.targetAmount.toNumber(),
        savedAmount: goal.savedAmount.toNumber()
      });
    }
  );

  app.get(
    '/goals',
    {
      schema: {
        tags: ['Goals'],
        summary: 'Listar metas e auditoria de depósitos',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                title: { type: 'string' },
                targetAmount: { type: 'number' },
                savedAmount: { type: 'number' },
                progressPercentage: { type: 'number' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = (request.user as { sub: string }).sub;

      const goals = await prisma.goal.findMany({
        where: { userId },
        include: {
          deposits: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const goalsWithProgress = goals.map((goal) => {
        const current = goal.savedAmount.toNumber();
        const target = goal.targetAmount.toNumber();
        const progressPercentage = target > 0 ? Number(((current / target) * 100).toFixed(2)) : 0;

        return {
          ...goal,
          targetAmount: target,
          savedAmount: current,
          progressPercentage,
        };
      });

      return reply.status(200).send(goalsWithProgress);
    }
  );

  app.post(
    '/goals/:id/deposit',
    {
      schema: {
        tags: ['Goals'],
        summary: 'Aportar valor em uma meta (Auditoria ACID)',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          required: ['accountId', 'amount'],
          properties: {
            accountId: { type: 'string', format: 'uuid' },
            amount: { type: 'number', example: 500.00 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              savedAmount: { type: 'number' },
            },
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
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

      if (account.balance.toNumber() < amount) {
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

      return reply.status(200).send({
        ...updatedGoal,
        targetAmount: updatedGoal.targetAmount.toNumber(),
        savedAmount: updatedGoal.savedAmount.toNumber()
      });
    }
  );

  app.post(
    '/goals/:id/withdraw',
    {
      schema: {
        tags: ['Goals'],
        summary: 'Resgatar valor de uma meta (Auditoria ACID)',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          required: ['accountId', 'amount'],
          properties: {
            accountId: { type: 'string', format: 'uuid' },
            amount: { type: 'number', example: 200.00 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              savedAmount: { type: 'number' },
            },
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
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

      if (goal.savedAmount.toNumber() < amount) {
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

      return reply.status(200).send({
        ...updatedGoal,
        targetAmount: updatedGoal.targetAmount.toNumber(),
        savedAmount: updatedGoal.savedAmount.toNumber()
      });
    }
  );

  app.delete(
    '/goals/:id',
    {
      schema: {
        tags: ['Goals'],
        summary: 'Deletar meta financeira',
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
        id: z.string().uuid({ message: 'ID da meta inválido' }),
      });

      const { id } = paramsSchema.parse(request.params);

      const goal = await prisma.goal.findFirst({ where: { id, userId } });

      if (!goal) {
        return reply.status(404).send({ error: 'Meta não encontrada.' });
      }

      await prisma.goal.delete({ where: { id } });
      return reply.status(204).send();
    }
  );
}
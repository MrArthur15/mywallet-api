import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AccountType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: 'Token de autenticação inválido ou ausente.' });
    }
  });

  app.post(
    '/accounts',
    {
      schema: {
        tags: ['Accounts'],
        summary: 'Criar conta bancária',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['name', 'bankId'],
          properties: {
            name: { type: 'string', example: 'Conta Corrente Principal' },
            balance: { type: 'number', example: 1500.00 },
            type: { type: 'string', enum: ['CHECKING', 'SAVINGS', 'CASH', 'OTHER'], example: 'CHECKING' },
            bankId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              balance: { type: 'number' },
              type: { type: 'string' },
            },
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              details: { type: 'object', additionalProperties: true },
            },
          },
          500: {
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

      const createAccountSchema = z.object({
        name: z.string().min(2, { message: 'O nome da conta deve ter pelo menos 2 caracteres' }),
        balance: z.number().default(0),
        type: z.nativeEnum(AccountType).default(AccountType.CHECKING),
        bankId: z.string().uuid({ message: 'ID do banco inválido' }),
      });

      const result = createAccountSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({
          error: 'Dados da conta inválidos',
          details: result.error.format(),
        });
      }

      const { name, balance, type, bankId } = result.data;

      try {
        const account = await prisma.account.create({
          data: {
            userId,
            name,
            balance,
            type,
            bankId,
          },
        });

        return reply.status(201).send({
          ...account,
          balance: account.balance.toNumber(),
        });
      } catch (error) {
        return reply.status(500).send({ error: 'Erro ao cadastrar conta bancária.' });
      }
    }
  );

  app.get(
    '/accounts',
    {
      schema: {
        tags: ['Accounts'],
        summary: 'Listar contas bancárias',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                balance: { type: 'number' },
                type: { type: 'string' },
                bank: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    color: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = (request.user as { sub: string }).sub;

      const accounts = await prisma.account.findMany({
        where: { userId },
        include: {
          bank: {
            select: { name: true, color: true },
          },
        },
        orderBy: { name: 'asc' },
      });

      const formattedAccounts = accounts.map(account => ({
        ...account,
        balance: account.balance.toNumber(),
      }));

      return reply.status(200).send(formattedAccounts);
    }
  );

  app.delete(
    '/accounts/:id',
    {
      schema: {
        tags: ['Accounts'],
        summary: 'Deletar conta bancária',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          204: { type: 'null' },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
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
        id: z.string().uuid({ message: 'ID da conta bancária inválido' }),
      });

      const { id } = paramsSchema.parse(request.params);

      const account = await prisma.account.findFirst({
        where: { id, userId },
        include: {
          _count: {
            select: { transactions: true },
          },
        },
      });

      if (!account) {
        return reply.status(404).send({ error: 'Conta bancária não encontrada.' });
      }

      if (account._count.transactions > 0) {
        return reply.status(400).send({
          error: 'Exclusão bloqueada por integridade.',
          message: `Esta conta possui ${account._count.transactions} transações no histórico. Estorne ou exclua as movimentações antes de removê-la.`,
        });
      }

      await prisma.account.delete({ where: { id } });
      return reply.status(204).send();
    }
  );
}
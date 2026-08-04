import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AccountType } from '@prisma/client'; // <-- 1. Importamos o Enum nativo do Prisma
import { prisma } from '../lib/prisma.js';

export async function accountRoutes(app: FastifyInstance) {
  // Exige Token JWT válido em todas as rotas deste arquivo
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: 'Token de autenticação inválido ou ausente.' });
    }
  });

  // ===========================================================================
  // Rota POST: Cria uma nova conta bancária ou carteira para o usuário logado
  // ===========================================================================
  app.post('/accounts', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    // 1. Como bankId é obrigatório no seu banco, removemos o .optional() aqui:
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
          bankId, // <-- 2. Passamos direto, pois é garantido que existe
        },
      });

      return reply.status(201).send(account);
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Erro ao cadastrar conta bancária.' });
    }
  });

  // ===========================================================================
  // Rota GET: Lista todas as contas do usuário logado
  // ===========================================================================
  app.get('/accounts', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const accounts = await prisma.account.findMany({
      where: {
        userId,
      },
      include: {
        bank: {
          select: {
            name: true,
            color: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    return reply.status(200).send(accounts);
  });
  // ===========================================================================
  // Rota DELETE: Exclui conta apenas se não possuir movimentações atreladas
  // ===========================================================================
  app.delete('/accounts/:id', async (request, reply) => {
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
        message: `Esta conta possui ${account._count.transactions} transação(ões) no histórico. Estorne ou exclua as movimentações antes de removê-la.`,
      });
    }

    await prisma.account.delete({ where: { id } });
    return reply.status(204).send();
  });
}
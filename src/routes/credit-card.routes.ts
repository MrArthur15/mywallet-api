import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function creditCardRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    await request.jwtVerify();
  });

  app.post('/credit-cards', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const createCreditCardSchema = z.object({
      name: z.string().min(2, { message: 'O nome do cartão deve ter pelo menos 2 caracteres' }),
      limit: z.number().positive({ message: 'O limite deve ser maior que zero' }),
      closingDay: z.number().int().min(1).max(31, { message: 'Dia de fechamento deve ser entre 1 e 31' }),
      dueDay: z.number().int().min(1).max(31, { message: 'Dia de vencimento deve ser entre 1 e 31' }),
      bankId: z.string().uuid({ message: 'ID do banco inválido' }),
    });

    const { name, limit, closingDay, dueDay, bankId } = createCreditCardSchema.parse(request.body);

    const creditCard = await prisma.creditCard.create({
      data: {
        userId,
        name,
        limit,
        closingDay,
        dueDay,
        bankId,
      },
    });

    return reply.status(201).send(creditCard);
  });

  app.get('/credit-cards', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const creditCards = await prisma.creditCard.findMany({
      where: { userId },
      include: {
        bank: {
          select: { name: true, color: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return reply.status(200).send(creditCards);
  });

  app.delete('/credit-cards/:id', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      id: z.string().uuid({ message: 'ID do cartão inválido' }),
    });

    const { id } = paramsSchema.parse(request.params);

    const card = await prisma.creditCard.findFirst({
      where: { id, userId },
      include: {
        _count: {
          select: { invoices: true },
        },
      },
    });

    if (!card) {
      return reply.status(404).send({ error: 'Cartão de crédito não encontrado.' });
    }

    if (card._count.invoices > 0) {
      return reply.status(400).send({
        error: 'Exclusão bloqueada por integridade.',
        message: 'Este cartão possui faturas geradas no sistema. Exclua o histórico antes de removê-lo.',
      });
    }

    await prisma.creditCard.delete({ where: { id } });

    return reply.status(204).send();
  });
}
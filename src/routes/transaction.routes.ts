import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { calculateInvoiceDates } from './invoice.routes.js';

export async function transactionRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    await request.jwtVerify();
  });

  app.post('/transactions', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const createTransactionSchema = z
      .object({
        title: z.string().min(2, { message: 'Título deve ter pelo menos 2 caracteres' }),
        amount: z.number().positive({ message: 'O valor deve ser maior que zero' }),
        type: z.enum(['INCOME', 'OUTCOME']),
        date: z.coerce.date().default(() => new Date()),
        categoryId: z.string().uuid({ message: 'ID da categoria inválido' }),
        accountId: z.string().uuid().optional(),
        creditCardId: z.string().uuid().optional(),
        installments: z.number().int().min(1).max(72).default(1),
        isRecurring: z.boolean().default(false),
        recurrenceMonths: z.number().int().min(2).max(36).default(12),
      })
      .refine(
        (data) => (data.accountId && !data.creditCardId) || (!data.accountId && data.creditCardId),
        {
          message: 'Informe exatamente um destino: accountId (conta bancária) OU creditCardId (cartão de crédito).',
        }
      )
      .refine(
        (data) => !(data.installments > 1 && data.isRecurring),
        {
          message: 'Uma transação não pode ser parcelada e recorrente ao mesmo tempo.',
        }
      );

    const {
      title,
      amount,
      type,
      date,
      categoryId,
      accountId,
      creditCardId,
      installments,
      isRecurring,
      recurrenceMonths,
    } = createTransactionSchema.parse(request.body);

    if (accountId) {
      const account = await prisma.account.findFirst({
        where: { id: accountId, userId },
      });

      if (!account) {
        return reply.status(404).send({ error: 'Conta bancária não encontrada.' });
      }

      if (isRecurring) {
        const createdTransactions = await prisma.$transaction(async (tx) => {
          const results = [];

          for (let i = 0; i < recurrenceMonths; i++) {
            const occurrenceDate = new Date(date);
            occurrenceDate.setUTCMonth(occurrenceDate.getUTCMonth() + i);

            const isFirstMonth = i === 0;

            const created = await tx.transaction.create({
              data: {
                userId,
                accountId,
                categoryId,
                title,
                amount,
                type,
                date: occurrenceDate,
                isRecurring: true,
                isPaid: isFirstMonth,
              },
            });

            if (isFirstMonth) {
              const balanceChange = type === 'INCOME' ? amount : -amount;
              await tx.account.update({
                where: { id: accountId },
                data: { balance: { increment: balanceChange } },
              });
            }

            results.push(created);
          }

          return results;
        });

        return reply.status(201).send(createdTransactions);
      }

      const transaction = await prisma.$transaction(async (tx) => {
        const created = await tx.transaction.create({
          data: {
            userId,
            accountId,
            categoryId,
            title,
            amount,
            type,
            date,
            isPaid: true,
          },
        });

        const balanceChange = type === 'INCOME' ? amount : -amount;
        await tx.account.update({
          where: { id: accountId },
          data: { balance: { increment: balanceChange } },
        });

        return created;
      });

      return reply.status(201).send(transaction);
    }

    if (creditCardId) {
      const card = await prisma.creditCard.findFirst({
        where: { id: creditCardId, userId },
      });

      if (!card) {
        return reply.status(404).send({ error: 'Cartão de crédito não encontrado.' });
      }

      const totalOccurrences = isRecurring ? recurrenceMonths : installments;
      const installmentGroupId = installments > 1 ? randomUUID() : undefined;
      const occurrenceAmount = installments > 1
        ? Number((amount / installments).toFixed(2))
        : amount;

      const createdTransactions = await prisma.$transaction(async (tx) => {
        const resultTransactions = [];

        for (let i = 0; i < totalOccurrences; i++) {
          const purchaseDate = new Date(date);

          let targetMonth = purchaseDate.getUTCMonth() + 1 + i;
          let targetYear = purchaseDate.getUTCFullYear();

          if (purchaseDate.getUTCDate() >= card.closingDay) {
            targetMonth += 1;
          }

          while (targetMonth > 12) {
            targetMonth -= 12;
            targetYear += 1;
          }

          let invoice = await tx.invoice.findFirst({
            where: { creditCardId, month: targetMonth, year: targetYear },
          });

          if (!invoice) {
            const { closingDate, dueDate } = calculateInvoiceDates(
              targetYear,
              targetMonth,
              card.closingDay,
              card.dueDay
            );

            invoice = await tx.invoice.create({
              data: {
                creditCardId,
                month: targetMonth,
                year: targetYear,
                closingDate,
                dueDate,
                status: 'OPEN',
                totalAmount: 0,
              },
            });
          }

          const parcelTitle = installments > 1
            ? `${title} (${i + 1}/${installments})`
            : title;

          const transaction = await tx.transaction.create({
            data: {
              userId,
              invoiceId: invoice.id,
              categoryId,
              title: parcelTitle,
              amount: occurrenceAmount,
              type: 'OUTCOME',
              date: purchaseDate,
              isRecurring,
              installmentGroup: installmentGroupId,
            },
          });

          await tx.invoice.update({
            where: { id: invoice.id },
            data: { totalAmount: { increment: occurrenceAmount } },
          });

          resultTransactions.push(transaction);
        }

        return resultTransactions;
      });

      return reply
        .status(201)
        .send(totalOccurrences === 1 ? createdTransactions[0] : createdTransactions);
    }
  });

  app.patch('/transactions/:id/pay', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      id: z.string().uuid({ message: 'ID da transação inválido' }),
    });

    const { id } = paramsSchema.parse(request.params);

    const transaction = await prisma.transaction.findFirst({
      where: { id, userId },
    });

    if (!transaction) {
      return reply.status(404).send({ error: 'Transação não encontrada.' });
    }

    if (transaction.isPaid) {
      return reply.status(400).send({ error: 'Esta transação já está marcada como paga.' });
    }

    if (!transaction.accountId) {
      return reply.status(400).send({
        error: 'Apenas transações em conta corrente precisam de baixa manual (cartões são liquidados ao pagar a fatura).',
      });
    }

    const accountId = transaction.accountId;

    const updated = await prisma.$transaction(async (tx) => {
      const balanceChange =
        transaction.type === 'INCOME'
          ? Number(transaction.amount)
          : -Number(transaction.amount);

      await tx.account.update({
        where: { id: accountId },
        data: { balance: { increment: balanceChange } },
      });

      return tx.transaction.update({
        where: { id },
        data: { isPaid: true },
      });
    });

    return reply.status(200).send(updated);
  });

  app.get('/transactions', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const querySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      month: z.coerce.number().int().min(1).max(12).optional(),
      year: z.coerce.number().int().min(2000).max(2100).optional(),
      type: z.enum(['INCOME', 'OUTCOME']).optional(),
      accountId: z.string().uuid().optional(),
      creditCardId: z.string().uuid().optional(),
      categoryId: z.string().uuid().optional(),
      query: z.string().optional(),
    });

    const {
      page,
      limit,
      month,
      year,
      type,
      accountId,
      creditCardId,
      categoryId,
      query,
    } = querySchema.parse(request.query);

    const where: any = { userId };

    if (type) where.type = type;
    if (accountId) where.accountId = accountId;
    if (categoryId) where.categoryId = categoryId;

    if (creditCardId) {
      where.invoice = {
        creditCardId,
      };
    }

    if (month && year) {
      const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
      where.date = {
        gte: startDate,
        lte: endDate,
      };
    } else if (year) {
      const startDate = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
      const endDate = new Date(Date.UTC(year, 12, 0, 23, 59, 59, 999));
      where.date = {
        gte: startDate,
        lte: endDate,
      };
    }

    if (query) {
      where.title = {
        contains: query,
        mode: 'insensitive',
      };
    }

    const [totalCount, transactions] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        include: {
          category: true,
          account: true,
          invoice: {
            include: {
              creditCard: true,
            },
          },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return reply.status(200).send({
      data: transactions,
      meta: {
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  });

  app.delete('/transactions/:id', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      id: z.string().uuid({ message: 'ID da transação inválido' }),
    });

    const { id } = paramsSchema.parse(request.params);

    const transaction = await prisma.transaction.findFirst({
      where: { id, userId },
    });

    if (!transaction) {
      return reply.status(404).send({ error: 'Transação não encontrada.' });
    }

    await prisma.$transaction(async (tx) => {
      if (transaction.accountId && transaction.isPaid) {
        const reversalAmount =
          transaction.type === 'OUTCOME'
            ? Number(transaction.amount)
            : -Number(transaction.amount);

        await tx.account.update({
          where: { id: transaction.accountId },
          data: {
            balance: {
              increment: reversalAmount,
            },
          },
        });
      }

      if (transaction.invoiceId) {
        await tx.invoice.update({
          where: { id: transaction.invoiceId },
          data: {
            totalAmount: {
              decrement: Number(transaction.amount),
            },
          },
        });
      }

      await tx.transaction.delete({
        where: { id },
      });
    });

    return reply.status(204).send();
  });
}
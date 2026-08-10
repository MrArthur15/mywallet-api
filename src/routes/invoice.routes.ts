import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export function calculateInvoiceDates(year: number, month: number, closingDay: number, dueDay: number) {
  const closingDate = new Date(Date.UTC(year, month - 1, closingDay));
  let dueMonth = month;
  let dueYear = year;

  if (dueDay <= closingDay) {
    dueMonth += 1;
    if (dueMonth > 12) {
      dueMonth = 1;
      dueYear += 1;
    }
  }

  const dueDate = new Date(Date.UTC(dueYear, dueMonth - 1, dueDay));
  return { closingDate, dueDate };
}

export async function invoiceRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    await request.jwtVerify();
  });

  app.post('/invoices', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const createInvoiceSchema = z.object({
      creditCardId: z.string().uuid({ message: 'ID do cartão inválido' }),
      month: z.number().int().min(1).max(12),
      year: z.number().int().min(2000).max(2100),
    });

    const { creditCardId, month, year } = createInvoiceSchema.parse(request.body);

    const card = await prisma.creditCard.findFirst({
      where: { id: creditCardId, userId },
    });

    if (!card) {
      return reply.status(404).send({ error: 'Cartão de crédito não encontrado.' });
    }

    const { closingDate, dueDate } = calculateInvoiceDates(year, month, card.closingDay, card.dueDay);

    const invoice = await prisma.invoice.create({
      data: {
        creditCardId,
        month,
        year,
        closingDate,
        dueDate,
        status: 'OPEN',
        totalAmount: 0,
      },
    });

    return reply.status(201).send(invoice);
  });

  app.get('/credit-cards/:creditCardId/invoices', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      creditCardId: z.string().uuid({ message: 'ID do cartão inválido' }),
    });

    const { creditCardId } = paramsSchema.parse(request.params);

    const cardExists = await prisma.creditCard.findFirst({
      where: { id: creditCardId, userId },
    });

    if (!cardExists) {
      return reply.status(404).send({ error: 'Cartão não encontrado.' });
    }

    const invoices = await prisma.invoice.findMany({
      where: { creditCardId },
      include: {
        transactions: {
          orderBy: { date: 'desc' },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    return reply.status(200).send(invoices);
  });

  app.post('/invoices/:id/pay', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      id: z.string().uuid({ message: 'ID da fatura inválido' }),
    });

    const bodySchema = z.object({
      accountId: z.string().uuid({ message: 'ID da conta bancária para débito é obrigatório' }),
      amountPaid: z.number().positive({ message: 'O valor pago deve ser maior que zero' }),
    });

    const { id } = paramsSchema.parse(request.params);
    const { accountId, amountPaid } = bodySchema.parse(request.body);

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { creditCard: true },
    });

    if (!invoice || invoice.creditCard.userId !== userId) {
      return reply.status(404).send({ error: 'Fatura não encontrada.' });
    }

    if (invoice.status === 'PAID') {
      return reply.status(400).send({ error: 'Esta fatura já está paga.' });
    }

    const updatedInvoice = await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: accountId },
        data: {
          balance: { decrement: amountPaid },
        },
      });

      const paidInvoice = await tx.invoice.update({
        where: { id },
        data: { status: 'PAID' },
      });

      return paidInvoice;
    });

    return reply.status(200).send(updatedInvoice);
  });

  app.post('/invoices/:id/anticipate', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      id: z.string().uuid({ message: 'ID da fatura de destino inválido' }),
    });

    const bodySchema = z.object({
      installmentGroup: z.string().uuid({ message: 'ID do grupo de parcelamento é obrigatório' }),
      quantity: z.number().int().positive().optional(),
    });

    const { id: targetInvoiceId } = paramsSchema.parse(request.params);
    const { installmentGroup, quantity } = bodySchema.parse(request.body);

    const targetInvoice = await prisma.invoice.findFirst({
      where: {
        id: targetInvoiceId,
        status: 'OPEN',
        creditCard: { userId },
      },
    });

    if (!targetInvoice) {
      return reply.status(404).send({
        error: 'Fatura de destino não encontrada ou já está fechada/paga.',
      });
    }

    const futureInstallments = await prisma.transaction.findMany({
      where: {
        userId,
        installmentGroup,
        invoice: {
          OR: [
            { year: { gt: targetInvoice.year } },
            { year: targetInvoice.year, month: { gt: targetInvoice.month } },
          ],
        },
      },
      orderBy: { date: 'asc' },
    });

    if (futureInstallments.length === 0) {
      return reply.status(400).send({
        error: 'Não há parcelas futuras disponíveis para antecipação neste grupo.',
      });
    }

    const installmentsToAnticipate = quantity
      ? futureInstallments.slice(0, quantity)
      : futureInstallments;

    const result = await prisma.$transaction(async (tx) => {
      let totalAnticipatedAmount = 0;

      for (const item of installmentsToAnticipate) {
        const amount = Number(item.amount);
        totalAnticipatedAmount += amount;

        if (item.invoiceId) {
          await tx.invoice.update({
            where: { id: item.invoiceId },
            data: { totalAmount: { decrement: amount } },
          });
        }

        await tx.transaction.update({
          where: { id: item.id },
          data: {
            invoiceId: targetInvoice.id,
            title: `${item.title} [Antecipada]`,
          },
        });
      }

      const updatedInvoice = await tx.invoice.update({
        where: { id: targetInvoice.id },
        data: { totalAmount: { increment: totalAnticipatedAmount } },
      });

      return {
        targetInvoice: updatedInvoice,
        anticipatedCount: installmentsToAnticipate.length,
        totalAnticipatedAmount,
      };
    });

    return reply.status(200).send(result);
  });
}
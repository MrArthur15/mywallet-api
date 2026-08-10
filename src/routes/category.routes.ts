import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function categoryRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    await request.jwtVerify();
  });

  app.post('/categories', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const createCategorySchema = z.object({
      name: z.string().min(2, { message: 'O nome deve ter pelo menos 2 caracteres' }),
      icon: z.string().optional(),
      color: z.string().min(4, { message: 'A cor é obrigatória' }),
    });

    const { name, icon, color } = createCategorySchema.parse(request.body);

    const category = await prisma.category.create({
      data: {
        userId,
        name,
        icon,
        color,
      },
    });

    return reply.status(201).send(category);
  });

  app.get('/categories', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const categories = await prisma.category.findMany({
      where: { userId },
      include: {
        subcategories: {
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return reply.status(200).send(categories);
  });

  app.delete('/categories/:id', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      id: z.string().uuid({ message: 'ID da categoria inválido' }),
    });

    const { id } = paramsSchema.parse(request.params);

    const category = await prisma.category.findFirst({
      where: { id, userId },
      include: {
        _count: {
          select: { transactions: true },
        },
      },
    });

    if (!category) {
      return reply.status(404).send({ error: 'Categoria não encontrada.' });
    }

    if (category._count.transactions > 0) {
      return reply.status(400).send({
        error: 'Exclusão bloqueada por integridade.',
        message: `Esta categoria possui ${category._count.transactions} transação(ões) vinculada(s). Exclua ou reclassifique os gastos antes de apagá-la.`,
      });
    }

    await prisma.category.delete({ where: { id } });

    return reply.status(204).send();
  });

  app.post('/categories/:categoryId/subcategories', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      categoryId: z.string().uuid({ message: 'ID da categoria pai inválido' }),
    });

    const bodySchema = z.object({
      name: z.string().min(2, { message: 'O nome deve ter pelo menos 2 caracteres' }),
    });

    const { categoryId } = paramsSchema.parse(request.params);
    const { name } = bodySchema.parse(request.body);

    const parentCategory = await prisma.category.findFirst({
      where: { id: categoryId, userId },
    });

    if (!parentCategory) {
      return reply.status(404).send({ error: 'Categoria pai não encontrada.' });
    }

    const subcategory = await prisma.subcategory.create({
      data: {
        categoryId,
        name,
      },
    });

    return reply.status(201).send(subcategory);
  });

  app.delete('/subcategories/:id', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      id: z.string().uuid({ message: 'ID da subcategoria inválido' }),
    });

    const { id } = paramsSchema.parse(request.params);

    const subcategory = await prisma.subcategory.findFirst({
      where: {
        id,
        category: {
          userId,
        },
      },
    });

    if (!subcategory) {
      return reply.status(404).send({ error: 'Subcategoria não encontrada.' });
    }

    await prisma.subcategory.delete({ where: { id } });

    return reply.status(204).send();
  });
}
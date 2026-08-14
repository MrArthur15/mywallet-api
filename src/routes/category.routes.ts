import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function categoryRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    await request.jwtVerify();
  });

  app.post(
    '/categories',
    {
      schema: {
        tags: ['Categories'],
        summary: 'Criar categoria',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['name', 'color'],
          properties: {
            name: { type: 'string', example: 'Alimentação' },
            color: { type: 'string', example: '#FF5733' },
            icon: { type: 'string', example: 'food-icon' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
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
    }
  );

  app.get(
    '/categories',
    {
      schema: {
        tags: ['Categories'],
        summary: 'Listar categorias',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                color: { type: 'string' },
                subcategories: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      name: { type: 'string' },
                    },
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
    }
  );

  app.delete(
    '/categories/:id',
    {
      schema: {
        tags: ['Categories'],
        summary: 'Deletar categoria',
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
          message: `Esta categoria possui ${category._count.transactions} transações) vinculada(s). Exclua ou reclassifique os gastos antes de apagá-la.`,
        });
      }

      await prisma.category.delete({ where: { id } });
      return reply.status(204).send();
    }
  );

  app.post(
    '/categories/:categoryId/subcategories',
    {
      schema: {
        tags: ['Categories'],
        summary: 'Criar subcategoria',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            categoryId: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', example: 'Restaurantes' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
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
    }
  );

  app.delete(
    '/subcategories/:id',
    {
      schema: {
        tags: ['Categories'],
        summary: 'Deletar subcategoria',
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
    }
  );
}
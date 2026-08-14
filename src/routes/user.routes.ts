import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash, compare } from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

export async function userRoutes(app: FastifyInstance) {
  app.get(
    '/users',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Listar todos os usuários',
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                email: { type: 'string', format: 'email' },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
      });
      return reply.status(200).send(users);
    }
  );

  app.post(
    '/users',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Criar nova conta de usuário',
        body: {
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string', example: 'Arthur Pires' },
            email: { type: 'string', format: 'email', example: 'arthur@mywallet.com' },
            password: { type: 'string', example: 'senha123456' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              email: { type: 'string' },
            },
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              details: { type: 'object', additionalProperties: true },
            },
          },
          409: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const createUserSchema = z.object({
        name: z.string().min(2, { message: 'Nome deve ter no mínimo 2 caracteres' }),
        email: z.string().email({ message: 'E-mail inválido' }),
        password: z.string().min(6, { message: 'A senha deve ter no mínimo 6 caracteres' }),
      });

      const result = createUserSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({
          error: 'Dados inválidos',
          details: result.error.format(),
        });
      }

      const { name, email, password } = result.data;
      const userExists = await prisma.user.findUnique({
        where: { email },
      });

      if (userExists) {
        return reply.status(409).send({ error: 'Este e-mail já está em uso.' });
      }

      const passwordHash = await hash(password, 8);
      const user = await prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });

      return reply.status(201).send(user);
    }
  );

  app.post(
    '/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Autenticar usuário (Login)',
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'arthur@mywallet.com' },
            password: { type: 'string', example: 'senha123456' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              token: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                },
              },
            },
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              details: { type: 'object', additionalProperties: true },
            },
          },
          401: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const loginSchema = z.object({
        email: z.string().email({ message: 'E-mail inválido' }),
        password: z.string().min(1, { message: 'A senha é obrigatória' }),
      });

      const result = loginSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({
          error: 'Dados de login inválidos',
          details: result.error.format(),
        });
      }

      const { email, password } = result.data;
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        return reply.status(401).send({ error: 'E-mail ou senha incorretos.' });
      }

      const isPasswordValid = await compare(password, user.passwordHash);
      if (!isPasswordValid) {
        return reply.status(401).send({ error: 'E-mail ou senha incorretos.' });
      }

      const token = app.jwt.sign(
        {
          name: user.name,
          email: user.email,
        },
        {
          sub: user.id,
          expiresIn: '7d',
        }
      );

      return reply.status(200).send({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      });
    }
  );
}
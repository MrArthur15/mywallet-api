import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash, compare } from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

export async function userRoutes(app: FastifyInstance) {
  // ===========================================================================
  // Rota GET: Lista todos os usuários (apenas para teste/debug)
  // ===========================================================================
  app.get('/users', async (request, reply) => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });

    return reply.status(200).send(users);
  });

  // ===========================================================================
  // Rota POST: Cadastra novo usuário com senha criptografada
  // ===========================================================================
  app.post('/users', async (request, reply) => {
    const createUserSchema = z.object({
      name: z.string().min(2, { message: "Nome deve ter no mínimo 2 caracteres" }),
      email: z.string().email({ message: "E-mail inválido" }),
      password: z.string().min(6, { message: "A senha deve ter no mínimo 6 caracteres" }),
    });

    const result = createUserSchema.safeParse(request.body);

    if (!result.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
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

    // Criptografa a senha com custo computacional 8 (rápido e seguro para APIs)
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
  });

  // ===========================================================================
  // Rota POST: Autenticação / Login (Gera o Token JWT)
  // ===========================================================================
  app.post('/login', async (request, reply) => {
    const loginSchema = z.object({
      email: z.string().email({ message: "E-mail inválido" }),
      password: z.string().min(1, { message: "A senha é obrigatória" }),
    });

    const result = loginSchema.safeParse(request.body);

    if (!result.success) {
      return reply.status(400).send({
        error: "Dados de login inválidos",
        details: result.error.format(),
      });
    }

    const { email, password } = result.data;

    // 1. Busca o usuário pelo e-mail
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return reply.status(401).send({ error: "E-mail ou senha incorretos." });
    }

    // 2. Compara a senha digitada com o hash salvo no banco
    const isPasswordValid = await compare(password, user.passwordHash);

    if (!isPasswordValid) {
      return reply.status(401).send({ error: "E-mail ou senha incorretos." });
    }

    // 3. Gera o token JWT guardando o ID do usuário no "sub" (subject)
    const token = app.jwt.sign(
      {
        name: user.name,
        email: user.email,
      },
      {
        sub: user.id,
        expiresIn: '7d', // Token expira em 7 dias
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
  });
}
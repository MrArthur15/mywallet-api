import { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

type FastifyErrorHandler = FastifyInstance['errorHandler'];

export const errorHandler: FastifyErrorHandler = (error, request, reply) => {
  // 1. Intercepta erros de validação do ZOD
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: 'Erro de validação nos dados enviados.',
      details: error.format(),
    });
  }

  // 2. Intercepta erros nativos do Fastify/JWT (ex: Token inválido ou expirado)
  const fastifyError = error as { statusCode?: number; message?: string };
  if (fastifyError.statusCode === 401) {
    return reply.status(401).send({
      error: 'Não autorizado.',
      message: fastifyError.message || 'Token de autenticação inválido ou ausente.',
    });
  }

  // 3. Loga o erro real no console para depuração (mas não expõe dados sensíveis ao cliente)
  request.log.error(error as any);

  // 4. Retorno padrão para erros inesperados de servidor (500)
  return reply.status(500).send({
    error: 'Erro interno do servidor.',
    message: 'Ocorreu uma falha inesperada ao processar sua requisição.',
  });
};
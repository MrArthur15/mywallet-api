import { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

type FastifyErrorHandler = FastifyInstance['errorHandler'];

export const errorHandler: FastifyErrorHandler = (error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: 'Erro de validação nos dados enviados.',
      details: error.format(),
    });
  }

  const fastifyError = error as { statusCode?: number; message?: string };

  if (fastifyError.statusCode === 401) {
    return reply.status(401).send({
      error: 'Não autorizado.',
      message: fastifyError.message || 'Token de autenticação inválido ou ausente.',
    });
  }

  request.log.error(error as any);

  return reply.status(500).send({
    error: 'Erro interno do servidor.',
    message: 'Ocorreu uma falha inesperada ao processar sua requisição.',
  });
};
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiProblem } from '@rodasoft/domain';
import { InvalidTransitionError } from '@rodasoft/domain';
import type { Request, Response } from 'express';

/** Todas las respuestas de error tienen la forma ApiProblem { status, code, message, details }. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const problem = this.toProblem(exception);
    problem.traceId = (req as any).id;
    if (problem.status >= 500) this.logger.error(`${req.method} ${req.url}`, exception as Error);
    res.status(problem.status).json(problem);
  }

  private toProblem(e: unknown): ApiProblem {
    if (e instanceof HttpException) {
      const body = e.getResponse() as any;
      const message = Array.isArray(body?.message) ? 'Datos inválidos' : (body?.message ?? e.message);
      return {
        status: e.getStatus(),
        code: body?.code ?? HttpStatus[e.getStatus()] ?? 'ERROR',
        message,
        details: Array.isArray(body?.message) ? body.message : body?.details,
      };
    }
    if (e instanceof InvalidTransitionError) {
      return { status: 409, code: 'INVALID_TRANSITION', message: e.message, details: { from: e.from, event: e.event } };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') return { status: 409, code: 'DUPLICATE', message: 'El registro ya existe', details: e.meta };
      if (e.code === 'P2025') return { status: 404, code: 'NOT_FOUND', message: 'Registro no encontrado' };
    }
    return { status: 500, code: 'INTERNAL', message: 'Error interno. Intenta de nuevo o avisa a soporte.' };
  }
}

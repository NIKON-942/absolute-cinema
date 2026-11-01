import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { STATUS_CODES } from 'http';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const base: Record<string, unknown> =
        typeof body === 'string' ? { message: body } : { ...(body as Record<string, unknown>) };
      // structured payloads (e.g. code: 'DEVICE_LIMIT') are passed through so
      // clients can branch on more than the status code
      const { statusCode: _sc, message: _msg, error: _err, ...extras } = base;
      response.status(status).json({
        statusCode: status,
        message: (base.message as string | string[] | undefined) ?? exception.message,
        error: STATUS_CODES[status] ?? 'Error',
        ...extras,
      });
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
  }
}

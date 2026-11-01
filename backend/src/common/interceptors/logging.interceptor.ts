import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const { method, originalUrl } = req;
    // Video requests carry a JWT in the query string; never persist it in logs.
    const pathname = originalUrl.split('?')[0];
    const start = Date.now();
    return next.handle().pipe(
      tap(() =>
        this.logger.log(`${method} ${pathname} -> ${Date.now() - start}ms`),
      ),
    );
  }
}

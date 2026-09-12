/**
 * @file Interceptor: aplica una política transversal al ciclo HTTP.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de interceptors sin introducir reglas de un dominio específico.
 */
import { StreamableFile } from '@nestjs/common';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

type RequestWithCorrelationId = {
  correlationId?: string;
};

type ApiResponse<T> = {
  requestId: string | undefined;
  data: T;
  timestamp: string;
};

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<RequestWithCorrelationId>();
    return next.handle().pipe(
      map((data) => {
        /*
         * Un BINARIO no se envuelve.
         *
         * El sobre `{ requestId, data, timestamp }` es lo correcto para una respuesta de datos, pero
         * aplicado a un `StreamableFile` serializa el objeto a JSON y lo que llega al navegador es
         * un texto que empieza por `{"requestId"…` con la cabecera `image/png` puesta: la imagen
         * sale rota y el error no se parece a su causa —parece un fallo del almacenamiento—.
         *
         * Medido sobre el carnet del expediente: 548 KB de PNG salian como 1,9 MB de JSON.
         */
        if (data instanceof StreamableFile || Buffer.isBuffer(data)) return data as unknown as ApiResponse<T>;
        return {
          requestId: request.correlationId,
          data,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}

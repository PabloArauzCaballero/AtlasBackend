import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser, RequestWithAuth } from '../types/auth.types.js';

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
  const request = context.switchToHttp().getRequest<RequestWithAuth>();
  return request.user;
});

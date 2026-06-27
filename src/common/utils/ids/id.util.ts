import { BadRequestException } from '@nestjs/common';

const positiveIntegerPattern = /^[1-9][0-9]*$/;

export function parsePositiveId(value: string, fieldName: string): string {
  if (!positiveIntegerPattern.test(value)) {
    throw new BadRequestException(`${fieldName} debe ser un entero positivo representado como texto.`);
  }
  return value;
}

export function parseOptionalPositiveId(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  return parsePositiveId(value, fieldName);
}

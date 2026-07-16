/**
 * Genera un hash Argon2id para una contraseña, usando la MISMA capa que la app
 * (`src/common/utils/crypto/password.util.ts`). Útil para rotar la contraseña del usuario admin de
 * desarrollo (`pablo@atlas.internal`) sin escribirla en texto plano en el repo: se pega solo el HASH
 * resultante en el seeder `development/20260704121500-seed-pablo-admin-user.ts`.
 *
 * Uso:
 *   yarn hash-password 'MiContraseñaDeDev1!'
 *
 * Valida la política mínima (≥10 caracteres, con al menos una letra y un dígito o símbolo) antes de
 * hashear, para no generar un hash de una contraseña que el login luego rechazaría.
 */
import { hashPassword, isPasswordStrongEnough } from '../src/common/utils/crypto/password.util.js';

async function main(): Promise<void> {
  const password = process.argv[2];
  if (!password) {
    console.error("Uso: yarn hash-password '<contraseña>'");
    process.exit(1);
  }

  if (!isPasswordStrongEnough(password)) {
    console.error('La contraseña no cumple la política: mínimo 10 caracteres, con al menos una letra y un dígito o símbolo.');
    process.exit(1);
  }

  const hash = await hashPassword(password);
  console.log(hash);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

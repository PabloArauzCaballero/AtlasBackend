/**
 * @file Utilidad: enmascara un correo para ENSEÑÁRSELO a su dueño.
 * @business La persona necesita reconocer a qué correo se mandó un código sin que la pantalla lo exponga entero: una captura, un teléfono prestado o un hombro curioso no deben bastar para leerlo.
 * @system función pura; conserva el dominio (es lo que permite reconocer «es mi gmail») y los primeros caracteres de la parte local.
 */

/**
 * `pablo.arauz@gmail.com` → `pa***@gmail.com`.
 *
 * Con una parte local corta (≤ 3 caracteres) sólo se deja el primero: dejar dos de tres es enseñar casi todo.
 * Lo que no parece un correo (sin `@` o sin parte local) devuelve `null`: mejor no enseñar nada que enseñar basura.
 */
export function maskEmailForDisplay(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.length <= 3 ? 1 : 2;
  return `${local.slice(0, visible)}***@${domain}`;
}

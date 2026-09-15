/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El rubro del comercio pasa a ser un catálogo cerrado, no texto libre.
 * @system normaliza `partner.partner_profiles.business_category` a su forma canónica.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('partner_profiles')}.partner_profiles`;

/**
 * El rubro estaba guardado de tres formas distintas: `retail`, `RETAIL` y `EDUCATION`.
 *
 * No es un problema de presentación. `LoanSpendingService` agrupa el gasto del cliente por este
 * valor, asi que `retail` y `RETAIL` salen como dos rubros separados en el mismo informe, cada uno
 * con una parte del gasto; y las reglas de comisión que segmentan por categoría dejan de encajar
 * con el comercio en cuanto el rubro se escribió con otra caja. Desde ahora el borde sólo acepta
 * los valores del catálogo, y esto arregla lo que ya estaba escrito.
 *
 * El mapa cubre exactamente lo que hay o hubo en la base. Un valor que no esté aquí se deja INTACTO
 * en vez de convertirse en `OTRO`: si aparece un rubro que nadie previó, quiero verlo y decidir,
 * no que se disuelva en un cajón de sastre donde ya no se distingue de una elección deliberada.
 */
const CANONICO: Readonly<Record<string, string>> = {
  RETAIL: 'RETAIL',
  EDUCATION: 'EDUCACION',
  EDUCACION: 'EDUCACION',
  SERVICES: 'SERVICIOS',
  SERVICIOS: 'SERVICIOS',
  HEALTH: 'SALUD',
  SALUD: 'SALUD',
  FOOD: 'ALIMENTOS',
  ALIMENTOS: 'ALIMENTOS',
  TECHNOLOGY: 'TECNOLOGIA',
  TECNOLOGIA: 'TECNOLOGIA',
  HOME: 'HOGAR',
  HOGAR: 'HOGAR',
  APPAREL: 'VESTIMENTA',
  CLOTHING: 'VESTIMENTA',
  VESTIMENTA: 'VESTIMENTA',
  AUTOMOTIVE: 'AUTOMOTOR',
  AUTOMOTOR: 'AUTOMOTOR',
  CONSTRUCTION: 'CONSTRUCCION',
  CONSTRUCCION: 'CONSTRUCCION',
  TOURISM: 'TURISMO',
  TURISMO: 'TURISMO',
  OTHER: 'OTRO',
  OTRO: 'OTRO',
};

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  for (const [escrito, canonico] of Object.entries(CANONICO)) {
    await queryInterface.sequelize.query(
      `UPDATE ${TABLE} SET business_category = :canonico
        WHERE upper(trim(business_category)) = :escrito AND business_category <> :canonico`,
      { replacements: { canonico, escrito } },
    );
  }
}

/**
 * La vuelta atrás no existe, y es lo correcto.
 *
 * `retail` y `RETAIL` se convirtieron los dos en `RETAIL`: la información de cómo estaba escrito
 * cada uno se perdió al unificarlos, y no hay forma de repartirlos de nuevo. Un `down` que se
 * inventara esa distribución dejaría la base peor que antes de revertir. La migración es segura de
 * aplicar precisamente porque lo que quita es ruido.
 */
export async function down(): Promise<void> {
  return Promise.resolve();
}

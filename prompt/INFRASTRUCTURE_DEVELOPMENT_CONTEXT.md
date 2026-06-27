# Infrastructure Development Context — Atlas AWS

## 1. Estrategia

Atlas arranca con infraestructura pragmática para MVP, pero con bases de producción:

- Bajo costo inicial.
- Seguridad desde el día uno.
- Backups y recuperación.
- Observabilidad.
- CI/CD reproducible.
- Terraform como fuente de verdad.
- Capacidad de escalar sin rediseñar todo.

No construir Kubernetes ni microservicios al inicio salvo que el usuario lo apruebe explícitamente.

## 2. Stack AWS objetivo

- VPC con subnets públicas/privadas.
- Application Load Balancer.
- ECS Fargate para API y workers.
- RDS PostgreSQL.
- ElastiCache Redis.
- S3 para documentos/contratos/evidencias permitidas.
- CloudFront para web estática si aplica.
- WAF para protección básica.
- KMS para cifrado.
- Secrets Manager para secretos.
- CloudWatch Logs/Metrics/Alarms.
- CloudTrail para auditoría de cuenta.
- Route 53 para DNS si aplica.
- GitHub Actions para CI/CD.
- Terraform para infraestructura.

## 3. Ambientes

Mínimo:

- `local`
- `staging`
- `production`

Para MVP, producción puede empezar pequeña, pero no debe mezclar datos reales con staging.

## 4. Costos MVP

El objetivo inicial es mantener infraestructura liviana. Una arquitectura mínima puede rondar un costo operativo bajo si se usan tamaños pequeños y sin alta disponibilidad completa. No prometer costos exactos sin cotización actualizada de AWS.

Criterio:

- MVP/piloto: costo mínimo, backups activos, monitoreo básico.
- Producción real con usuarios: RDS más robusto, snapshots, alarms y WAF.
- Escala: Multi-AZ, autoscaling, colas más robustas, observabilidad avanzada.

## 5. Terraform

Estructura recomendada:

```txt
infra/terraform/
├── environments/
│   ├── staging/
│   └── production/
├── modules/
│   ├── networking/
│   ├── ecs/
│   ├── rds/
│   ├── redis/
│   ├── s3/
│   ├── cloudfront/
│   ├── security/
│   └── observability/
└── README.md
```

Reglas:

- No usar recursos creados manualmente sin importarlos/documentarlos.
- No guardar secrets en Terraform state si se puede evitar.
- State remoto cifrado.
- Variables por ambiente.
- Plan antes de apply.

## 6. CI/CD

GitHub Actions debe incluir:

Backend:

- install
- lint
- type-check
- test
- build
- docker build
- migration check si aplica

Web:

- install
- lint
- type-check
- build

Mobile:

- install
- lint
- type-check
- test si existe
- EAS build cuando corresponda

Infra:

- terraform fmt
- terraform validate
- terraform plan

## 7. Secrets

- No `.env` real en repo.
- Usar `.env.example`.
- Producción en Secrets Manager.
- Rotar JWT secrets, DB passwords y provider keys.
- Separar credenciales por ambiente.

## 8. Backups y recuperación

- RDS snapshots automáticos.
- Retención definida por ambiente.
- Procedimiento de restauración documentado.
- Pruebas periódicas de restore.
- S3 versioning para documentos críticos si aplica.

## 9. Observabilidad

Mínimo:

- Logs estructurados JSON.
- Request ID.
- Correlation ID para workers/eventos.
- Métricas de latencia/error.
- Alarmas de CPU/memoria/API 5xx/RDS/Redis.
- Auditoría de acciones administrativas y financieras a nivel aplicación.

## 10. Seguridad

- TLS obligatorio.
- WAF en endpoints públicos cuando aplique.
- Security groups restrictivos.
- RDS en subnets privadas.
- Redis privado.
- S3 privado por defecto.
- KMS para cifrado.
- IAM mínimo privilegio.
- CloudTrail activo.

## 11. Prohibido

- Subir credenciales al repo.
- Usar una sola base para staging y producción.
- Crear recursos manuales sin documentar.
- Exponer RDS/Redis públicamente.
- Desactivar backups en producción real.
- Desplegar sin rollback plan básico.

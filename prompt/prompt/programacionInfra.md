# Prompt infraestructura Atlas — AWS + Terraform

Usa Terraform y AWS.

## MVP

- ECS Fargate.
- RDS PostgreSQL.
- Redis.
- S3.
- CloudFront/WAF cuando aplique.
- Secrets Manager.
- KMS.
- CloudWatch/CloudTrail.
- GitHub Actions.

## Reglas

- No Kubernetes de inicio.
- No recursos manuales sin documentar.
- No secrets en repo.
- RDS/Redis privados.
- Backups activos.
- Logs y métricas básicas.

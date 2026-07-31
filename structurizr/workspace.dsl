/*
 * Modelo de arquitectura de Atlas Backend en Structurizr DSL.
 *
 * Es la fuente de verdad ESTRUCTURAL: define elementos, responsabilidades, protocolos y límites de
 * confianza una sola vez, y de ahí salen los cuatro niveles del C4. Los diagramas Mermaid de
 * docs/architecture/c4-model.md son la representación que se renderiza dentro del portal; este
 * archivo es lo que impide que esa representación derive de lo que el sistema realmente es.
 *
 * Render:  structurizr-cli export -workspace structurizr/workspace.dsl -format plantuml
 */
workspace "Atlas Backend" "Identidad, onboarding KYC, elegibilidad, credito, riesgo y operacion." {

    model {
        cliente = person "Cliente" "Persona que solicita credito. Opera desde la app movil o web publica."
        operador = person "Operador interno" "Analista de back office: revisa identidad, cumplimiento y fraude."
        administrador = person "Administrador" "Configura catalogos, proveedores, politicas y usuarios internos."

        atlas = softwareSystem "Atlas Backend" "Orquesta el recorrido crediticio de punta a punta y conserva la evidencia de cada decision." {

            api = container "API" "Atiende el trafico HTTP de negocio. No ejecuta trabajo de fondo." "Node 22 / NestJS 11 / APP_ROLE=api" {
                middleware = component "Cadena de entrada" "Correlacion, throttling, autenticacion JWT, tenant, rol, validacion Zod e idempotencia."
                controllers = component "Controllers" "46 adaptadores HTTP delgados: validan, autorizan y delegan."
                services = component "Services" "Reglas de negocio de los 27 modulos de dominio."
                repositories = component "Repositories" "Persistencia. No contienen reglas de negocio."
                responseEnvelope = component "ResponseInterceptor" "Envuelve toda respuesta 2xx en requestId/data/timestamp."
                exceptionFilter = component "HttpExceptionFilter" "Traduce cualquier fallo al sobre ApiError, con PII redactada."
                outbox = component "OutboxInterceptor" "Escribe el evento en la MISMA transaccion que el cambio de negocio."
                docs = component "Referencia de API" "Scalar, Swagger UI y el contrato OpenAPI que genera este proceso."
            }

            worker = container "Worker" "Ejecuta el trabajo de fondo. No monta ninguna ruta de negocio." "Node 22 / NestJS 11 / APP_ROLE=worker" {
                scheduler = component "RuntimeJobsSchedulerService" "8 jobs con eleccion de lider por Redis SET NX PX."
                probe = component "Sonda" "node:http minimo: /health/liveness, /health/readiness y /metrics."
                healthMonitor = component "SystemsHealthMonitorService" "Vigila las herramientas criticas y avisa al staff interno."
                logSync = component "ArchivoLogMongoSyncService" "Sincroniza el archivo de log de ESTE proceso. Corre tambien en la API."
            }

            migrate = container "Job de migraciones" "One-shot: aplica migraciones y seeders con identidad DDL propia, y termina." "Node 22 / Umzug / APP_ROLE=all"

            postgres = container "PostgreSQL" "Fuente de verdad: 138 tablas en 12 esquemas, outbox, auditoria y evidencia." "PostgreSQL 16" "Database"
            redis = container "Redis" "Rate limiting, locks de lider y cache. Estado efimero y reconstruible." "Redis 7" "Database"
            mongo = container "MongoDB" "Visor de logs. Opcional: sin el, el backend arranca igual." "MongoDB 7" "Database"
        }

        segip = softwareSystem "SEGIP" "Registro civil. Verificacion de identidad contra fuente autoritativa." "External"
        infocenter = softwareSystem "InfoCenter" "Buro crediticio. Proveedor costoso, bloqueado por politica salvo aprobacion." "External"
        telco = softwareSystem "Telco / WhatsApp" "Antiguedad de linea, actividad, SIM swap y contactabilidad." "External"
        banca = softwareSystem "Banca / QR" "Generacion de QR de cobro." "External"
        mailsender = softwareSystem "MailSender" "Microservicio de mensajeria transaccional." "External"
        prometheus = softwareSystem "Prometheus" "Scrape de metricas y evaluacion de alertas." "External"

        cliente -> api "Solicita credito y aporta sus datos" "HTTPS / JWT propio"
        operador -> api "Revisa y decide" "HTTPS / JWT + RBAC interno"
        administrador -> api "Configura la plataforma" "HTTPS / JWT + RBAC interno"

        api -> postgres "Lee y escribe" "SQL / rol atlas_app_rw, sin DDL"
        api -> redis "Throttling y cache" "RESP"
        api -> mongo "Sincroniza su propio log" "TCP"
        worker -> postgres "Procesa outbox, eventos, retencion y notificaciones" "SQL / rol atlas_app_rw"
        worker -> redis "Toma el lock de lider de cada job" "RESP / SET NX PX"
        worker -> mongo "Sincroniza su propio log" "TCP"
        migrate -> postgres "Aplica migraciones y seeders" "SQL / rol atlas_migrator, con DDL"

        migrate -> api "Debe terminar con exito antes de que arranque" "Orquestacion"
        migrate -> worker "Debe terminar con exito antes de que arranque" "Orquestacion"

        api -> segip "Verifica identidad" "HTTPS / idempotente, con circuit breaker"
        api -> infocenter "Consulta buro" "HTTPS / costoso, requiere aprobacion"
        api -> telco "Consulta senales y envia OTP" "HTTPS"
        api -> banca "Genera QR de cobro" "HTTPS"
        worker -> mailsender "Entrega notificaciones" "HTTPS / API key"

        prometheus -> api "Scrape" "HTTP /metrics"
        prometheus -> worker "Scrape" "HTTP :3006/metrics"

        produccion = deploymentEnvironment "Produccion" {
            deploymentNode "Red privada" {
                deploymentNode "Plano de aplicacion" {
                    deploymentNode "Replicas de API" "Escalan por trafico" {
                        containerInstance api
                    }
                    deploymentNode "Worker" "1 replica basta; mas solo por tolerancia a fallos" {
                        containerInstance worker
                    }
                }
                deploymentNode "Plano de datos" "Servicios gestionados, no contenedores efimeros" {
                    containerInstance postgres
                    containerInstance redis
                }
            }
        }
    }

    views {
        systemContext atlas "Contexto" {
            include *
            autolayout lr
            description "Quien usa Atlas y con que sistemas externos habla."
        }

        container atlas "Contenedores" {
            include *
            autolayout tb
            description "Los tres roles de proceso salen de UNA sola imagen; cambia el comando, no el codigo."
        }

        component api "ComponentesApi" {
            include *
            autolayout lr
            description "Recorrido de una peticion: primero si entra, luego si es valida, luego si ya se ejecuto, y solo entonces el dominio."
        }

        component worker "ComponentesWorker" {
            include *
            autolayout tb
            description "El worker no registra ninguna ruta de negocio: solo su sonda."
        }

        deployment atlas produccion "Despliegue" {
            include *
            autolayout lr
            description "El worker no cuelga del balanceador: su puerto expone /metrics sin autenticacion."
        }

        styles {
            element "Person" { shape person background "#08427b" color "#ffffff" }
            element "Container" { background "#438dd5" color "#ffffff" }
            element "Component" { background "#85bbf0" color "#000000" }
            element "Database" { shape cylinder background "#2d6a4f" color "#ffffff" }
            element "External" { background "#999999" color "#ffffff" }
        }
    }
}

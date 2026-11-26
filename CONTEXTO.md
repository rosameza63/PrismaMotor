# Prisma Motor — continuidad del desarrollo

Última revisión: 2026-11-26. El proyecto está publicado en el repositorio GitHub público `rosameza63/PrismaMotor`, rama `main`. La carpeta `supabase/.temp/` está excluida. La persona confirma que en Supabase de Prisma Motor están aplicadas las migraciones hasta `20261118000200_client_portal_payment_summary.sql` y que la prueba de pagos funcionó correctamente.

Este archivo conserva el contexto para continuar en otro chat sin depender del historial de conversación. Antes de modificar el proyecto, leer también `README.md` y revisar el código vigente.

## Qué es

PWA para administrar un taller de mecánica y pintura. El frontend está hecho con HTML, CSS y JavaScript sin framework, y usa Supabase para autenticación, datos, almacenamiento privado y funciones del servidor. Es un proyecto independiente de `C:\rmeza\Condominio`.

## Avance que ya está en el código

- Inicio de sesión con perfiles y vistas según rol.
- Recepción de vehículos con checklist, novedades, firma y fotos privadas; permite guardar recepciones sin conexión y sincronizarlas después.
- Agenda y flujo de órdenes desde recepción y diagnóstico hasta entrega, con historial de estados.
- Cotizaciones por conceptos en COP, vigencia e impuestos; el cliente puede aprobar o rechazar cada concepto mediante un enlace privado.
- La decisión del cliente controla el estado de la orden. Las actividades operativas son tareas distintas de los conceptos comerciales.
- Asignación de tareas a técnicos por oficio, prerequisitos entre tareas y progreso desde Mi Bahía.
- Mi Bahía muestra al técnico el contexto de recepción e inspección (solicitud, kilometraje, checklist, daños y fotos) y permite guardar evidencia fotográfica del avance en el almacenamiento privado existente. El técnico solo actualiza sus tareas; el flujo de estados de la orden sigue en manos de recepción/propietario.
- Invitación y administración del personal desde una Edge Function protegida.
- La lista de técnicos está organizada como tabla adaptable con nombre, correo, especialidad, estado de acceso y acciones. El correo se consulta mediante `create-team-member`, desplegada en Supabase de Prisma Motor el 2026-11-24 con autorización expresa; no se subió nada a GitHub ni se ejecutó SQL. Las versiones de `app.js`, `roles.css` y el caché del service worker se incrementan al editar la interfaz para que la app local cargue el código actual.
- Catálogo de repuestos e insumos, existencias y movimientos de compra, consumo y ajuste; los consumos pueden asociarse a una orden y concepto aprobado.
- Inventario, movimientos, tarifas y otras secciones tabulares se muestran como tablas con desplazamiento horizontal en móvil; sus barras admiten gesto táctil y arrastre con mouse. El alta de catálogo y el registro de movimientos usan tablas horizontales compactas con los campos en columnas y desplazamiento en móvil. El catálogo resume producto/código, tipo, existencia/unidad, mínimo, estado del saldo y del catálogo, costo promedio/base, precio de venta y margen unitario/porcentual; el historial reúne fecha, producto, tipo, orden/concepto, cantidad, costo unitario, total y nota. La edición de producto queda desplegable desde la fila. El porcentaje de margen usa el precio de venta como base y no descuenta gastos generales.
- Se identificó que la función SQL de inventario insertaba compras con `quantity_change` negativo, aunque el CHECK requiere valor positivo. La migración local `20261125000100_fix_inventory_purchase_movement_sign.sql` corrige el registro usando el delta calculado; está pendiente de ejecución manual por la persona en Supabase de Prisma Motor.
- Módulo financiero en la interfaz para pagos, costos por hora, ingresos, costos registrados y margen bruto.
- El alta/consulta de tarifas internas por hora de mecánica, latonería, pintura, ensamble, control de calidad y otros oficios se administra en **Repuestos e insumos**; Finanzas las sigue usando para calcular costo de mano de obra y margen. La tabla mantiene sus columnas en móvil y permite desplazamiento horizontal por gesto táctil o arrastre con mouse.
- El propietario puede eliminar una orden desde Torre de control o desde el detalle de la orden. La migración `20261125000200_delete_work_order_bundle.sql` realiza el borrado transaccional de recepción, tareas, cotizaciones, decisiones, pagos y consumos; repone en saldo las unidades consumidas y elimina el vehículo/cliente solo si no siguen asociados a otras órdenes/vehículos. Los archivos del bucket se limpian con Storage API. La migración `20261125000200_delete_work_order_bundle.sql` fue aplicada en Supabase de Prisma Motor el 2026-11-25 y se verificó la función. No se borró ninguna orden durante la aplicación.

Los detalles funcionales están en `README.md`; el código es la fuente de verdad si hay diferencias con la documentación.

## Migraciones y siguiente revisión

Las migraciones están en `supabase/migrations/` y deben ejecutarse solamente en el proyecto Supabase independiente de Prisma Motor, nunca en Condominio.

La secuencia más reciente es:

1. `20261118000100_owner_financial_dashboard.sql` — pagos, costos internos de mano de obra y asociación de consumos a conceptos.
2. `20261118000200_client_portal_payment_summary.sql` — expone al portal del cliente los importes, medios y fechas de pago.

La persona confirmó el 2026-11-24 que ambas migraciones están aplicadas en el proyecto Supabase de Prisma Motor y que la prueba de pagos pasó. No volver a pedir que las aplique. Si se trabaja en otro entorno, comprobar ese entorno antes de ejecutar SQL.

## Limitaciones conocidas

- El tablero financiero calcula margen bruto con pagos, costos de inventario y costo de mano de obra registrados. No incluye gastos generales, impuestos ni costos fijos; no presentarlo como utilidad neta.
- El tablero del propietario conserva partes ilustrativas; confirmar qué datos son reales antes de ampliar reportes.
- Los enlaces de cliente generados en `localhost` o `file://` son solo para pruebas locales; para clientes se necesita HTTPS público.
- El repositorio Git local se inicializó y sincronizó con GitHub el 2026-11-26; el historial comienza con una instantánea del estado actual, sin reconstruir cambios anteriores.

## Forma de retomar

Al empezar una sesión nueva, abrir la carpeta `C:\rmeza\PrismaMotor` como proyecto en Codex y pedir: “Lee `AGENTS.md`, `CONTEXTO.md` y `README.md`; dime el estado actual y continúa desde el siguiente pendiente”. Actualizar este archivo al completar una fase importante.

## Siguiente paso comprobable

La persona confirma que `20261125000100_fix_inventory_purchase_movement_sign.sql` ya estaba aplicada; `20261125000200_delete_work_order_bundle.sql` se aplicó en el proyecto Prisma Motor el 2026-11-25. La función quedó verificada. Siguiente paso: recargar la app local y probar el borrado desde el rol propietario solo con una orden creada para pruebas. No se eliminó ningún registro durante esta sesión. Las migraciones previas se aplicaron manualmente y Supabase CLI muestra vacío su historial remoto; no usar `db push` sin reconciliar primero ese historial. Después continuar la prueba general de extremo a extremo: usar una orden, aprobar cotización, asignar tareas con prerequisitos, iniciar/pausar/reanudar e informar bloqueo desde Mi Bahía, cargar foto de avance, terminar tareas, avanzar por control de calidad y entrega, y confirmar progreso/pagos en el portal.


## Publicación en GitHub

- Se creó `https://github.com/rosameza63/PrismaMotor` como repositorio público con autorización expresa de la persona. El código está publicado y sincronizado en `main`; último commit de publicación: `75e4577` (documentación del despliegue).
- GitHub Pages está activado para `main`/raíz. La app ya se comprobó en `https://rosameza63.github.io/PrismaMotor/` y muestra el inicio de sesión por HTTPS.
- La persona aclara el 2026-11-26 que toda la información existente en la base de datos de Prisma Motor es de pruebas y no hay información operativa. Por eso, para esta ronda pública se puede usar el Supabase actual de Prisma Motor; no hace falta crear otra base. La app usa una clave publishable en el cliente y las políticas RLS para datos autenticados; nunca publicar la `service_role`. En Supabase → Authentication → URL Configuration se agregó `https://rosameza63.github.io/PrismaMotor/**` a Redirect URLs y Site URL se cambió a `https://rosameza63.github.io/PrismaMotor/`; se conservó `http://localhost:4173/**` para trabajo local. Supabase confirmó ambos guardados.
- Siguiente paso: iniciar sesión en la app publicada, comprobar los flujos de invitación y acceso, y preparar cuentas de prueba para los roles necesarios. La aplicación solo permite iniciar sesión; el propietario activo invita técnicos desde la app.
